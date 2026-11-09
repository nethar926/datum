import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,
 cavitationInceptionKn,bladeRate,
} from '../src/index.js';

describe('cavitation taxonomy (cavitation number + optional BR/PSR flags)',()=>{
 it('onset speed rises with depth and changes with temperature',()=>{
  const p=catalog.classes[0].params;
  const shallow=cavitationInceptionKn(p,10,15,35),deep=cavitationInceptionKn(p,200,15,35);
  expect(deep).toBeGreaterThan(shallow);
  const cold=cavitationInceptionKn(p,50,5,35),warm=cavitationInceptionKn(p,50,25,35);
  expect(cold).not.toBeCloseTo(warm,3);
  // Warmer → higher vapour pressure → lower inception speed
  expect(warm).toBeLessThan(cold);
 });
 it('BR = PSR × blades; reinforceBr1 boosts BR1 when flagged',()=>{
  const flagged=catalog.classes.find(c=>c.reinforceBr1)!;
  const plain=catalog.classes.find(c=>!c.reinforceBr1&&c.plant===flagged.plant)!;
  expect(flagged).toBeTruthy();
  for(const c of [flagged,plain]){
   const mode=c.plant==='nuclear'?'NUC' as const:'SNORK' as const;
   const s=deriveSignature(c,'base',{speedKn:10,depthM:40,mode});
   configurePropulsion(s,2,c.id,mode);updateDerivedSignature(s,effectiveParams(c),10,40,mode);
   const psr=s.tonals!.find(l=>l.lineFamily==='PSR'&&l.harmonic===1)!;
   const br1=s.tonals!.find(l=>l.lineFamily==='BR'&&l.harmonic===1)!;
   expect(br1.hz).toBeCloseTo(psr.hz*c.params.blades,10);
   expect(bladeRate(s)).toBeCloseTo(psr.hz*c.params.blades,10);
  }
  const a=deriveSignature(flagged,'base',{speedKn:10,depthM:40,mode:flagged.plant==='nuclear'?'NUC':'SNORK'});
  configurePropulsion(a,2,flagged.id,a.propulsion!.mode);updateDerivedSignature(a,effectiveParams(flagged),10,40,flagged.plant==='nuclear'?'NUC':'SNORK');
  const b=deriveSignature(plain,'base',{speedKn:10,depthM:40,mode:plain.plant==='nuclear'?'NUC':'SNORK'});
  configurePropulsion(b,2,plain.id,b.propulsion!.mode);updateDerivedSignature(b,effectiveParams(plain),10,40,plain.plant==='nuclear'?'NUC':'SNORK');
  const brA=a.tonals!.find(l=>l.lineFamily==='BR'&&l.harmonic===1)!.power;
  const brB=b.tonals!.find(l=>l.lineFamily==='BR'&&l.harmonic===1)!.power;
  expect(brA/brB).toBeCloseTo(1.6,5);
 });
 it('psrHarmonicsStopAtBlades zeroes PSR harmonics above blade count when flagged',()=>{
  const c=catalog.classes.find(x=>x.psrHarmonicsStopAtBlades)!;
  const mode=c.plant==='nuclear'?'NUC' as const:'SNORK' as const;
  const s=deriveSignature(c,'base',{speedKn:10,depthM:40,mode});
  configurePropulsion(s,4,c.id,mode);updateDerivedSignature(s,effectiveParams(c),10,40,mode);
  const blades=c.params.blades;
  for(const l of s.tonals!.filter(x=>x.lineFamily==='PSR')){
   if((l.harmonic??0)>blades)expect(l.power).toBe(0);
   else if(l.harmonic===1)expect(l.power).toBeGreaterThan(0);
  }
 });
});
