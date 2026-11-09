import {describe,it,expect} from 'vitest';
import {
 renderCut,CUT_BINS,CUT_VISIBILITY_WINDOW as W,cutVisibilityIds,meanRawRow,bestLine,lessonLineContrasts,
 type LessonContrast,
} from '../src/cuts/index.js';
// Raw (pre-normalizer) readability of shipped starter cuts on the shared window.
// Physics fix (2026-11-08): absolute tonalRefDb + effective source depth + SNORK boost;
// lesson lines scored (not just any peak). HYDP uses a burst-moment window.
//
// No cut rendering at module scope. bestFor/lessonsFor memoize per cut id on first
// use inside a test so parallel suites (esp. FE 150 ms warm-seek) are not starved
// by import-time CutSession work.
//
// Lead (2026-11-08): nuclear classes are "Coming soon". velvetshoal/twilightweft stay
// in the registry but are pinned it.fails / skipped here — do not block diesel/AIP.
const ids=cutVisibilityIds();
const NUCLEAR=new Set(['cut-velvetshoal-nuc','cut-twilightweft-nuc']);
const dieselIds=ids.filter(id=>!NUCLEAR.has(id));
const nuclearIds=ids.filter(id=>NUCLEAR.has(id));
const bestById=new Map<string,ReturnType<typeof bestLine>>();
const lessonsById=new Map<string,LessonContrast[]>();
function bestFor(id:string){
 if(!bestById.has(id))bestById.set(id,bestLine(meanRawRow(id)));
 return bestById.get(id)!;
}
function lessonsFor(id:string){
 if(!lessonsById.has(id))lessonsById.set(id,lessonLineContrasts(id));
 return lessonsById.get(id)!;
}
describe('starter cuts: raw engine rows (shared window)',()=>{
 it('ships exactly the 10 registry cuts',()=>{expect(ids.length).toBe(10);});
 it.each(ids)('%s produces finite, non-flat rows',id=>{
  const s=renderCut(id),b=new Float32Array(CUT_BINS);let n=0;
  while(n<20&&s.writeLofarRow(b)>=0){expect(b.every(Number.isFinite)).toBe(true);expect(Math.max(...b)-Math.min(...b)).toBeGreaterThan(1);n++;}
  s.dispose();expect(n).toBe(20);
 });
 it('records current baseline (diesel/AIP focus)',()=>{console.log(JSON.stringify(dieselIds.map(id=>{const r=bestFor(id);return [id,+r.hz.toFixed(1),+r.contrastDb.toFixed(2)];})));},30_000);
 it.each(dieselIds)('%s has a line >= %s dB at mid-cut (any peak)',id=>{
  expect(bestFor(id).contrastDb).toBeGreaterThanOrEqual(W.minContrastDb);
 },15_000);
 // Nuclear coming soon (Lead 2026-11-08) — skip until Lead/FE remove from pack.
 // (Physics fix may already clear 6 dB; do not treat as diesel/AIP success criteria.)
 it.skip.each(nuclearIds)('%s (nuclear coming soon) visibility not required',id=>{
  expect(bestFor(id).contrastDb).toBeGreaterThanOrEqual(W.minContrastDb);
 });
});
describe('starter cuts: lesson-line contrast (diesel/AIP)',()=>{
 it.each(dieselIds)('%s lesson lines meet teaching thresholds',id=>{
  const rows=lessonsFor(id);
  console.log(id,JSON.stringify(rows.map(r=>({fam:r.line.lineFamily,n:r.line.n,beh:r.line.behaviour,hz:r.hz,peak:r.peakHz,C:r.contrastDb===undefined?null:+r.contrastDb!.toFixed(2),win:r.window,mask:r.expectMasked,in:r.inWindow}))));
  const scored=rows.filter(r=>r.inWindow&&r.window!=='broadband-skip'&&r.window!=='demon-skip');
  expect(scored.length).toBeGreaterThan(0);
  for(const r of scored){
   expect(r.contrastDb).toBeTypeOf('number');
   if(r.expectMasked)expect(r.contrastDb!).toBeLessThan(W.minContrastDb);
   else expect(r.contrastDb!).toBeGreaterThanOrEqual(W.minContrastDb);
  }
  expect(scored.some(r=>!r.expectMasked&&(r.contrastDb??0)>=W.minContrastDb)).toBe(true);
 },20_000);
 it.skip.each(nuclearIds)('%s lesson lines (nuclear coming soon — skipped)',id=>{
  const rows=lessonsFor(id);
  const scored=rows.filter(r=>r.inWindow&&r.window!=='broadband-skip'&&r.window!=='demon-skip'&&!r.expectMasked);
  expect(scored.every(r=>(r.contrastDb??0)>=W.minContrastDb)).toBe(true);
 });
 it('morrowcoil HYDP fundamental stays masked while h2 clears',()=>{
  const rows=lessonsFor('cut-morrowcoil-hydp-masked');
  const h1=rows.find(r=>r.line.lineFamily==='HYDP'&&r.line.n===1)!;
  const h2=rows.find(r=>r.line.lineFamily==='HYDP'&&r.line.n===2)!;
  expect(h1.expectMasked).toBe(true);
  expect(h1.contrastDb!).toBeLessThan(W.minContrastDb);
  expect(h2.contrastDb!).toBeGreaterThanOrEqual(W.minContrastDb);
 },15_000);
});
