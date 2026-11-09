/**
 * Render one DEMON gram (60 s, 0–100 Hz) to PNG through the FE display pipeline.
 * Run: node_modules/.bin/tsx bench/demonGramPng.ts <caseId> <ceilDb> <out.png> [label]
 */
import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {DEMON_CASES,DEMON_BINS} from './demonContrast.js';
import {SplitWindowNormalizer,normalizeDemonRow,DEMON_NORM} from '../src/cuts/norm.js';

const [id,ceilArg,out]=process.argv.slice(2);const ceil=Number(ceilArg);const ROWS=240,SCALE_X=2;
const spec=DEMON_CASES.find(c=>c.id===id);if(!spec)throw new Error('unknown case '+id);
const {pull,target}=spec.make();const nz=new SplitWindowNormalizer(DEMON_BINS,DEMON_NORM.window,DEMON_NORM.guard);
const raw=new Float32Array(DEMON_BINS),d=new Float32Array(DEMON_BINS);const W=DEMON_BINS*SCALE_X,H=ROWS;
const px=Buffer.alloc((W*3+1)*H);
// green phosphor ramp
const ramp=(t:number):[number,number,number]=>[Math.round(255*Math.max(0,t-.6)/.4),Math.round(255*Math.min(1,t*1.25)),Math.round(60*t)];
for(let r=0;r<ROWS;r++){
 if(!pull(raw))break;normalizeDemonRow(raw,0,d,0,DEMON_BINS,DEMON_NORM,true,nz);
 const y=ROWS-1-r,o=y*(W*3+1);px[o]=0;
 for(let i=0;i<DEMON_BINS;i++){const v=d[i];const t=v===v?Math.min(1,Math.max(0,v/ceil)):0;const [R,G,B]=ramp(t);for(let s=0;s<SCALE_X;s++){const p=o+1+(i*SCALE_X+s)*3;px[p]=R;px[p+1]=G;px[p+2]=B;}}
}
// propulsion tick marks on the top row (truth, for review only)
const sh=target.params.propulsion?.shafts?.[0]?.hz??target.params.shaftHz,br=sh*target.params.blades;
for(const f of [sh,br,2*br,3*br])if(f<100){const x=Math.round(f/(100/511))*SCALE_X;for(let y=0;y<4;y++){const p=y*(W*3+1)+1+x*3;px[p]=255;px[p+1]=60;px[p+2]=60;}}
function chunk(type:string,data:Buffer){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);let c=~0;for(const b of td){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}const crc=Buffer.alloc(4);crc.writeUInt32BE((~c)>>>0);return Buffer.concat([len,td,crc]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(px)),chunk('IEND',Buffer.alloc(0))]));
console.log('wrote',out,'shaft',sh.toFixed(2),'BR',br.toFixed(2));
