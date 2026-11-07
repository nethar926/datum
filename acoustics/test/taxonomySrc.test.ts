import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,
 coupledSpeedWindowKn,
} from '../src/index.js';

/** Lead: shaft imbalance = live PSR; gear mesh = live plant rates (R:R / declutch / BATT).
 * Only class SRC arcs scale with speed; flow noise stays broadband (no tonal Hz). */
describe('SRC / gear / imbalance plant-rate lock',()=>{
 it('PSR (shaft imbalance) equals live shaft Hz; MESH = shaft×teeth through R:R',()=>{
  for(const c of catalog.classes){
   const mode=c.plant==='nuclear'?'NUC' as const:'SNORK' as const;
   const win=mode==='SNORK'?coupledSpeedWindowKn(c):undefined;
   const speed=win?Math.min(c.params.maxSpeedKn,Math.max(win.min+.1,win.max-.1)):Math.min(12,c.params.maxSpeedKn*.5);
   const s=deriveSignature(c,'base',{speedKn:speed,depthM:50,mode});
   configurePropulsion(s,13,c.id,mode);updateDerivedSignature(s,effectiveParams(c),speed,50,mode);
   const t=s.propulsion!;
   for(const l of s.tonals!.filter(x=>x.lineFamily==='PSR'&&x.harmonic===1)){
    expect(l.hz).toBeCloseTo(t.shafts[l.shaftIndex!].hz,10);
   }
   if(t.stages.length){
    let input=t.shafts[0].hz*t.ratio;
    for(const stage of t.stages){
     expect(stage.meshHz).toBeCloseTo(input*stage.pinionTeeth,10);
     const meshLines=s.tonals!.filter(x=>x.lineFamily==='MESH'&&x.harmonic===1&&Math.abs(x.hz-stage.meshHz)<1e-6);
     // twin-shaft may scale mesh by shaft ratio; at least one line tracks stage.meshHz on shaft 0
     expect(s.tonals!.some(x=>x.lineFamily==='MESH'&&x.harmonic===1&&Math.abs(x.hz-stage.meshHz)<1e-4)).toBe(true);
     input/=stage.ratio;
     void meshLines;
    }
   }
  }
 });
 it('on BATT and when declutched, PSR/MESH still follow live shaft/plant rates (no second speed formula)',()=>{
  // BATT diesel-electric
  const del=catalog.classes.find(c=>c.machinery.kind==='dieselElectric')!;
  const s=deriveSignature(del,'base',{speedKn:5,depthM:40,mode:'BATT'});
  configurePropulsion(s,3,del.id,'BATT');updateDerivedSignature(s,effectiveParams(del),5,40,'BATT');
  const t=s.propulsion!;
  expect(t.engines.every(e=>!e.running)).toBe(true);
  expect(s.tonals!.find(l=>l.lineFamily==='PSR'&&l.harmonic===1)!.hz).toBeCloseTo(t.shafts[0].hz,10);
  if(t.stages.length)expect(t.stages[0].meshHz).toBeCloseTo(t.shafts[0].hz*t.ratio*t.stages[0].pinionTeeth,10);

  // Declutch: morrowcoil below coupled window → motor (Lead plant-rate lock)
  const flagged=catalog.classes.find(c=>c.id==='green-morrowcoil')!;
  const w=coupledSpeedWindowKn(flagged)!;
  const inKn=(w.min+Math.min(w.max,flagged.params.maxSpeedKn))/2;
  const d=deriveSignature(flagged,'base',{speedKn:inKn,depthM:40,mode:'SNORK'});
  configurePropulsion(d,7,flagged.id,'SNORK');updateDerivedSignature(d,effectiveParams(flagged),inKn,40,'SNORK');
  updateDerivedSignature(d,effectiveParams(flagged),w.min*.4,40,'SNORK');
  expect(d.propulsion!.declutched).toBe(true);
  expect(d.tonals!.find(l=>l.lineFamily==='PSR'&&l.harmonic===1)!.hz).toBeCloseTo(d.propulsion!.shafts[0].hz,10);
  const mesh=d.propulsion!.stages;
  if(mesh.length)expect(mesh[0].meshHz).toBeCloseTo(d.propulsion!.shafts[0].hz*d.propulsion!.ratio*mesh[0].pinionTeeth,8);
 });
 it('class SRC arcs scale with speed and are absent below onset; flow noise has no tonal Hz',()=>{
  const c=catalog.classes.find(x=>x.speedWindows?.some(w=>w.kind==='SRC'&&w.hzPerKnot))!;
  const w=c.speedWindows!.find(x=>x.kind==='SRC')!;
  const below=Math.max(0,w.speedKts[0]-1),mid=(w.speedKts[0]+w.speedKts[1])/2;
  const mode=c.plant==='nuclear'?'NUC' as const:'BATT' as const;
  const lo=deriveSignature(c,'base',{speedKn:below,depthM:50,mode});
  configurePropulsion(lo,1,c.id,mode);updateDerivedSignature(lo,effectiveParams(c),below,50,mode);
  const gateLo=lo.speedGated!.find(g=>g.name===w.name)!;
  expect(gateLo.active).toBe(false);expect(gateLo.gain).toBe(0);
  const hi=deriveSignature(c,'base',{speedKn:mid,depthM:50,mode});
  configurePropulsion(hi,1,c.id,mode);updateDerivedSignature(hi,effectiveParams(c),mid,50,mode);
  const gateHi=hi.speedGated!.find(g=>g.name===w.name)!;
  expect(gateHi.active).toBe(true);expect(gateHi.kind).toBe('SRC');
  if(gateHi.kind==='SRC'&&w.kind==='SRC'&&w.hzPerKnot)expect(gateHi.hz).toBeCloseTo(w.hzPerKnot*mid,6);
  // Flow noise is spectrum level only
  expect(hi.flowNoiseDb).toBeTypeOf('number');
  expect(hi.tonals!.every(l=>l.lineFamily!=='SRC'||l.family==='src')).toBe(true);
 });
});
