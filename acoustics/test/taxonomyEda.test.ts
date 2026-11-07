import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,
 edaFrequencyHz,coupledSpeedWindowKn,dieselHarmonicGain,pickDieselRichness,
} from '../src/index.js';

describe('EDA taxonomy (CFR × multiplier, per-component harmonics)',()=>{
 it('EDA Hz = CFR × cfrMultiple for every catalog harmonic (fractional multipliers OK)',()=>{
  for(const c of catalog.classes.filter(c=>c.plant==='diesel')){
   const win=coupledSpeedWindowKn(c),speedKn=win?Math.min(c.params.maxSpeedKn,Math.max(8,win.min+.05)):8;
   const s=deriveSignature(c,'base',{speedKn,depthM:10,mode:'SNORK'});
   configurePropulsion(s,11,c.id,'SNORK');updateDerivedSignature(s,effectiveParams(c),speedKn,10,'SNORK');
   const richness=pickDieselRichness(11,c.id);
   for(const e of c.edas)for(const h of e.harmonics){
    const lines=s.tonals!.filter(l=>l.lineFamily==='EDA'&&l.eda?.name===e.name&&l.harmonic===h);
    expect(lines.length).toBeGreaterThan(0);
    for(const l of lines){
     const eng=s.propulsion!.engines[l.engineIndex!];
     expect(l.eda!.cfrMultiple).toBe(e.cfrMultiple);
     expect(l.fundamentalHz).toBeCloseTo(edaFrequencyHz(eng.cfrHz,e.cfrMultiple),10);
     expect(l.hz).toBeCloseTo(edaFrequencyHz(eng.cfrHz,e.cfrMultiple)*h,10);
     // Power follows engine running × diesel richness fade (slots stay at 0 above live band).
     if(!eng.running||dieselHarmonicGain(richness,h)===0)expect(l.power).toBe(0);
     else expect(l.power).toBeGreaterThan(0);
    }
   }
  }
 });
 it('each EDA has 0–5 harmonics; fleet median of counts is 1 or 2',()=>{
  const counts=catalog.classes.filter(c=>c.plant==='diesel').flatMap(c=>c.edas.map(e=>e.harmonics.length));
  expect(counts.every(n=>n>=0&&n<=5)).toBe(true);
  expect(new Set(counts).size).toBeGreaterThan(1);
  const sorted=[...counts].sort((a,b)=>a-b),mid=sorted[Math.floor(sorted.length/2)];
  expect(mid).toBeGreaterThanOrEqual(1);expect(mid).toBeLessThanOrEqual(2);
  const lop=catalog.classes.find(c=>c.id==='blue-brindleflux')!.edas.find(e=>e.name==='LOP')!;
  expect(lop.cfrMultiple).toBe(27.75);expect(lop.harmonics).toEqual([1,2]);
 });
 it('EDA power drops to zero when engines stop (BATT)',()=>{
  const c=catalog.classes.find(x=>x.id==='blue-brindleflux')!;
  const s=deriveSignature(c,'base',{speedKn:6,depthM:40,mode:'BATT'});
  configurePropulsion(s,3,c.id,'BATT');updateDerivedSignature(s,effectiveParams(c),6,40,'BATT');
  expect(s.tonals!.filter(l=>l.lineFamily==='EDA').every(l=>l.power===0)).toBe(true);
 });
});
