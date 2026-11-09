/**
 * DEMON tuning sweep: propulsion-line contrast for starter cuts + seeded live SIM cases
 * under candidate background normalizers and carrier bands.
 * Run: node_modules/.bin/tsx bench/demonTune.bench.ts [variant...]
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {DEMON_CASES,measureCase,DEMON_BINS,type DisplayFn,type CaseResult} from './demonContrast.js';
import {SplitWindowNormalizer} from '../src/cuts/norm.js';

let CEIL=65;const FLOOR=0,CLAMP=-5;
function clip(d:Float32Array){for(let i=0;i<d.length;i++){const v=d[i];if(v===v)d[i]=v>CEIL?CEIL:v<FLOOR?FLOOR:v;}}
function clampIn(src:Float32Array,dst:Float32Array){for(let i=0;i<src.length;i++){const v=src[i];dst[i]=v===v?Math.max(CLAMP,v):NaN;}}
function meanSW(w:number,g:number):DisplayFn{const nz=new SplitWindowNormalizer(DEMON_BINS,w,g);return (s,d)=>{clampIn(s,d);nz.apply(d,0,d,0);clip(d);};}
function medianSW(w:number,g:number):DisplayFn{const buf=new Float64Array(2*w),tmp=new Float32Array(DEMON_BINS);return (s,d)=>{clampIn(s,tmp);
 for(let i=0;i<DEMON_BINS;i++){const v=tmp[i];if(v!==v){d[i]=NaN;continue;}let n=0;
  for(let j=Math.max(0,i-g-w);j<Math.max(0,i-g);j++)if(tmp[j]===tmp[j])buf[n++]=tmp[j];
  for(let j=Math.min(DEMON_BINS,i+g+1);j<Math.min(DEMON_BINS,i+g+1+w);j++)if(tmp[j]===tmp[j])buf[n++]=tmp[j];
  if(!n){d[i]=0;continue;}const a=buf.subarray(0,n).sort();d[i]=v-(n&1?a[n>>1]:.5*(a[n/2-1]+a[n/2]));}
 clip(d);};}
const raw:DisplayFn=(s,d)=>{clampIn(s,d);clip(d);};

const withCeil=(c:number,f:()=>DisplayFn)=>()=>{const g=f();return (s:Float32Array,d:Float32Array)=>{const o=CEIL;CEIL=c;g(s,d);CEIL=o;};};
export const VARIANTS:Record<string,{fn:()=>DisplayFn;band?:[number,number]}>={
 'mean24/3 c65 [1-2k]':{fn:()=>meanSW(24,3),band:[1000,2000]},
 'mean24/3 c65 [1-4k]':{fn:()=>meanSW(24,3),band:[1000,4000]},
 'mean24/3 c20 [1-4k]':{fn:withCeil(20,()=>meanSW(24,3)),band:[1000,4000]},
 'raw c20 [1-4k]':{fn:withCeil(20,()=>raw),band:[1000,4000]},
 'mean64/6 c20 [1-4k]':{fn:withCeil(20,()=>meanSW(64,6)),band:[1000,4000]},
 'median24/3 c20 [1-4k]':{fn:withCeil(20,()=>medianSW(24,3)),band:[1000,4000]},
 'median48/3 c20 [1-4k]':{fn:withCeil(20,()=>medianSW(48,3)),band:[1000,4000]},
 'median48/3 c20 [1-2k]':{fn:withCeil(20,()=>medianSW(48,3)),band:[1000,2000]},
 'median48/3 c20 [1-2.4k]':{fn:withCeil(20,()=>medianSW(48,3)),band:[1000,2400]},
 'median96/4 c20 [1-4k]':{fn:withCeil(20,()=>medianSW(96,4)),band:[1000,4000]},
};
const fmt=(x:number|null)=>x===null?'  n/a':(x>=0?' ':'')+x.toFixed(1).padStart(4);
const pick=process.argv.slice(2);
const out:Record<string,CaseResult[]>={};
for(const [name,v] of Object.entries(VARIANTS)){
 if(pick.length&&!pick.some(p=>name.includes(p)))continue;
 console.log(`\n== ${name}`);console.log('case                     sh.Hz  bl  mod   | shaft    BR   BR2   BR3 | false traffic');
 const res:CaseResult[]=[];
 for(const c of DEMON_CASES){
  // cuts default band is the cut's own [1000,2000]; only re-subscribe when variant differs.
  const band=v.band;
  const r=measureCase(c,v.fn(),band);res.push(r);
  console.log(`${r.id.padEnd(24)} ${r.shaftHz.toFixed(2).padStart(5)} ${String(r.blades).padStart(3)} ${r.modulation.toFixed(2)} | ${fmt(r.shaft.contrastDb)} ${fmt(r.br.contrastDb)} ${fmt(r.br2.contrastDb)} ${fmt(r.br3.contrastDb)} | ${String(r.falseLines).padStart(5)} ${String(r.trafficLines).padStart(7)}`);
 }
 out[name]=res;
}
mkdirSync('bench/results',{recursive:true});writeFileSync('bench/results/demon-tune.json',JSON.stringify(out,null,1));
