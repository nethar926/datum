import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const j=(n:string)=>JSON.parse(readFileSync(new URL('../bench/results/'+n,import.meta.url),'utf8'));
describe('manual teaching plates (seeded, checked-in data)',()=>{
 it('Lloyd plate: tightest fringes at CPA, far-field spacing within 0.5%, depth recovered within 1%',()=>{
  const p=j('lloyd-plate.json'),f=p.nulls.map((n:any)=>n.exactHz[0]),iMin=f.indexOf(Math.min(...f));
  expect(p.axes.tS[iMin]).toBe(p.truth.tCpaS);
  expect(Math.abs(p.atCpa.firstNullHzFarField/p.atCpa.firstNullHzExact-1)).toBeLessThan(.005);
  expect(Math.abs(p.fit.zsM/p.truth.srcDepthM-1)).toBeLessThan(.01);
  expect(p.gramDb.length).toBe(p.axes.tS.length);expect(p.gramDb[0].length).toBe(p.axes.freqHz.length);
 });
 it('harmonic plate: shift scales with n and ratio stays n',()=>{
  const p=j('harmonic-doppler-plate.json'),s1=p.perHarmonic[0].totalShiftHz;
  for(const h of p.perHarmonic){expect(h.totalShiftHz/h.n).toBeCloseTo(s1,9);expect(h.ratioToFundamentalAtStart).toBeCloseTo(h.n,9);}
 });
});
