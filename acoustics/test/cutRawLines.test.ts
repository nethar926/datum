import {describe,it,expect} from 'vitest';
import {STARTER_CUTS,renderCut,CUT_BINS,CUT_FMAX} from '../src/cuts/index.js';
// Raw (pre-normalizer) readability of starter cuts. KNOWN BUG (2026-11-08): rows are non-empty but no
// line stands > ~2.3 dB above its local background even averaged over 30 s, so the normalizer has nothing to keep.
// it.fails pins the bug; flip to it() when the source-level/bin fix lands.
const df=CUT_FMAX/(CUT_BINS-1);
function maxLocalContrast(id:string,rows=120,fMaxHz=600){
 const s=renderCut(id),b=new Float32Array(CUT_BINS),acc=new Float64Array(CUT_BINS);let n=0;
 while(n<rows&&s.writeLofarRow(b)>=0){for(let i=0;i<CUT_BINS;i++)acc[i]+=b[i];n++;}s.dispose();
 const m=Array.from(acc,v=>v/n);let best=-Infinity;
 for(let i=8;i*df<fMaxHz;i++){const nb=[...m.slice(i-8,i-2),...m.slice(i+3,i+9)].sort((x,y)=>x-y);best=Math.max(best,m[i]-nb[6]);}
 return {n,best};
}
describe('starter cuts: raw engine rows',()=>{
 it.each(STARTER_CUTS.map(c=>c.id))('%s produces finite, non-flat rows',id=>{
  const s=renderCut(id),b=new Float32Array(CUT_BINS);let n=0;
  while(n<20&&s.writeLofarRow(b)>=0){expect(b.every(Number.isFinite)).toBe(true);expect(Math.max(...b)-Math.min(...b)).toBeGreaterThan(1);n++;}
  s.dispose();expect(n).toBe(20);
 });
 const OK=new Set(['cut-morrowcoil-hydp-masked']); // only cut with lines (94.8 Hz +9.5 dB, 122 Hz +8.4 dB)
 it.each([...OK])('%s (control) has a line >= 6 dB above local background',id=>{expect(maxLocalContrast(id).best).toBeGreaterThanOrEqual(6);});
 it.fails.each(STARTER_CUTS.map(c=>c.id).filter(id=>!OK.has(id)))('%s has at least one line >= 6 dB above local background (0-600 Hz, 30 s mean)',id=>{
  expect(maxLocalContrast(id).best).toBeGreaterThanOrEqual(6);
 });
});
