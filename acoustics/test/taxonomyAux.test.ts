import {describe,it,expect} from 'vitest';
import {catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion} from '../src/index.js';

describe('continuous aux taxonomy (AC/DC/SSMA)',()=>{
 it('AC aux stay stable+discrete; DC wander-tagged unstable; not engine-proportional',()=>{
  for(const c of catalog.classes){
   for(const a of c.aux.filter(x=>x.duty==='continuous')){
    if(a.kind==='electrical'||a.kind==='acPump'||a.kind==='acvr'){expect(a.stability).toBe('stable');expect(a.width).toBe('discrete');}
    if(a.kind==='dcvr'){expect(a.stability).toBe('unstable');expect(a.width).toBe('discrete');}
   }
   if(c.plant==='diesel')expect(c.aux.some(a=>a.kind==='dcvr'&&a.duty==='continuous')).toBe(true);
  }
 });
 it('seeded SSMA classes emit fixed AUX Hz (not CFR-locked); some omit the fundamental',()=>{
  const withSsma=catalog.classes.filter(c=>c.aux.some(a=>a.kind==='ssma'));
  expect(withSsma.length).toBeGreaterThanOrEqual(5);
  expect(withSsma.length).toBeLessThan(catalog.classes.length);
  expect(withSsma.some(c=>c.aux.some(a=>a.kind==='ssma'&&!a.harmonics.includes(1)))).toBe(true);
  for(const c of withSsma.filter(c=>c.plant==='diesel')){
   const sheet=c.aux.find(a=>a.kind==='ssma')!;
   const snap=(speed:number)=>{const s=deriveSignature(c,'base',{speedKn:speed,depthM:40,mode:'SNORK'});configurePropulsion(s,5,c.id,'SNORK');updateDerivedSignature(s,effectiveParams(c),speed,40,'SNORK');
    return {cfr:s.propulsion!.engines.find(e=>e.running)?.cfrHz??0,ssma:s.tonals!.filter(l=>l.lineFamily==='AUX'&&sheet.harmonics.includes(l.harmonic!)&&Math.abs(l.hz-sheet.fHz*l.harmonic!)<1e-6).map(l=>l.hz)};};
   const a=snap(Math.min(8,c.params.maxSpeedKn*.4)),b=snap(Math.min(14,c.params.maxSpeedKn*.7));
   expect(a.ssma.length).toBe(sheet.harmonics.length);expect(b.ssma).toEqual(a.ssma); // fixed Hz
   if(a.cfr>0&&b.cfr>0&&Math.abs(b.cfr-a.cfr)>1e-6)expect(a.ssma[0]/a.cfr).not.toBeCloseTo(b.ssma[0]/b.cfr,6); // not CFR-ratio locked
  }
 });
});
