/** Documents: coarse Welch-frame prefixes fail ≤0.01 dB and/or the 50 MB budget. */
import {describe,it,expect} from 'vitest';
import {resParams,RES_FRAME_S,TILE_BINS} from '../src/res.js';
import {HISTORY_FRAMES} from '../src/stateHistory.js';

const p=resParams(2),T=p.integrationS,hop=p.hopS,K=p.averages,f=RES_FRAME_S;
const span=T+(K-1)*hop,spanF=Math.round(span/f);
function frameWeight(ts:number,tEnd:number){
  let w=0;for(let q=0;q<8;q++){const t=ts-f+(q+.5)*f/8;for(let m=0;m<K;m++){const x=(t-(tEnd-m*hop-T))/T;if(x>0&&x<1){const s=Math.sin(Math.PI*x);w+=s*s*s*s;}}}return w;
}
function synthP(frame:number,bin:number,L:number){return 1e-12+(bin===100?1e-8*(1+.2*Math.sin(frame*.1)):0)+1e-11*(.5+.5*Math.cos(2*Math.PI*(bin/L)*3+frame*.05));}
function exact(tEndFrame:number,L:number){const tEnd=tEndFrame*f;let wsum=0;const P=new Float64Array(L);
  for(let j=0;j<spanF;j++){const w=frameWeight((tEndFrame-j)*f,tEnd);if(!(w>0))continue;wsum+=w;for(let i=0;i<L;i++)P[i]+=w*synthP(tEndFrame-j,i,L);}
  for(let i=0;i<L;i++)P[i]!/=wsum;return P;}
function block(tEndFrame:number,L:number,step:number){const tEnd=tEndFrame*f;let wsum=0;const P=new Float64Array(L);
  for(let b0=0;b0<spanF;b0+=step){const b1=Math.min(spanF,b0+step),blockP=new Float64Array(L);
    for(let j=b0;j<b1;j++)for(let i=0;i<L;i++)blockP[i]+=synthP(tEndFrame-j,i,L);
    let bw=0;for(let j=b0;j<b1;j++)bw+=frameWeight((tEndFrame-j)*f,tEnd);const n=b1-b0,scale=bw/n;wsum+=bw;
    for(let i=0;i<L;i++)P[i]+=scale*blockP[i]!;}
  for(let i=0;i<L;i++)P[i]!/=wsum;return P;}
function maxDb(a:Float64Array,b:Float64Array){let m=0;for(let i=0;i<a.length;i++){const d=Math.abs(10*Math.log10(b[i]!/a[i]!));if(Number.isFinite(d))m=Math.max(m,d);}return m;}

describe('coarse Welch-frame prefix reuse (investigation)',()=>{
  it('Hann⁴ weight peak-to-trough ≫ 1 over a RES2 span',()=>{
    const tEnd=200*f;const ws=Array.from({length:spanF},(_,j)=>frameWeight((200-j)*f,tEnd)).filter(w=>w>0);
    expect(Math.max(...ws)/Math.min(...ws)).toBeGreaterThan(1e5);
  });
  it('uniform block step≥4 exceeds 0.01 dB on a mild time-varying spectrum',()=>{
    const L=256,ref=exact(200,L);
    expect(maxDb(ref,block(200,L,1))).toBeLessThanOrEqual(1e-12);
    expect(maxDb(ref,block(200,L,2))).toBeLessThanOrEqual(0.01); // borderline pass on synth
    expect(maxDb(ref,block(200,L,4))).toBeGreaterThan(0.01);
    expect(maxDb(ref,block(200,L,32))).toBeGreaterThan(1);
  });
  it('32×8 P-only prefixes at any accuracy-passing stride exceed 3.5 MB headroom',()=>{
    const headroom=3.5*1024*1024;
    for(const step of [1,2]){ // only strides that can clear 0.01 dB on synth
      const bytes=Math.ceil(HISTORY_FRAMES/step)*TILE_BINS*4*32*8;
      expect(bytes).toBeGreaterThan(headroom);
    }
  });
});
