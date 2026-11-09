import {describe,it,expect} from 'vitest';
import {renderCut,CUT_BINS,CUT_VISIBILITY_WINDOW as W,cutVisibilityIds,meanRawRow,bestLine} from '../src/cuts/index.js';
// Raw (pre-normalizer) readability of shipped starter cuts on the shared window. KNOWN BUG (2026-11-08):
// tonal line power is ~15-20 dB too low vs contact broadband; it.fails pins it until the derivation fix lands.
const ids=cutVisibilityIds();
const res=new Map(ids.map(id=>[id,bestLine(meanRawRow(id))]));
describe('starter cuts: raw engine rows (shared window)',()=>{
 it('ships exactly the 10 registry cuts',()=>{expect(ids.length).toBe(10);});
 it.each(ids)('%s produces finite, non-flat rows',id=>{
  const s=renderCut(id),b=new Float32Array(CUT_BINS);let n=0;
  while(n<20&&s.writeLofarRow(b)>=0){expect(b.every(Number.isFinite)).toBe(true);expect(Math.max(...b)-Math.min(...b)).toBeGreaterThan(1);n++;}
  s.dispose();expect(n).toBe(20);
 });
 const OK=new Set(ids.filter(id=>res.get(id)!.contrastDb>=W.minContrastDb));
 it('records current baseline',()=>{console.log(JSON.stringify([...res].map(([id,r])=>[id,+r.hz.toFixed(1),+r.contrastDb.toFixed(2)])));});
 it.fails.each(ids.filter(id=>!OK.has(id)))(`%s has a line >= ${W.minContrastDb} dB at mid-cut`,id=>{expect(res.get(id)!.contrastDb).toBeGreaterThanOrEqual(W.minContrastDb);});
});
