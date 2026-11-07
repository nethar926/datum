import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,
 coupledSpeedWindowKn,writePlantTonals,
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
     // twin-shaft may scale mesh by shaft ratio; at least one line tracks stage.meshHz on shaft 0
     expect(s.tonals!.some(x=>x.lineFamily==='MESH'&&x.harmonic===1&&Math.abs(x.hz-stage.meshHz)<1e-4)).toBe(true);
     input/=stage.ratio;
    }
   }
  }
 });
 it('on BATT and when declutched, PSR/MESH still follow live shaft/plant rates (no second speed formula)',()=>{
  const del=catalog.classes.find(c=>c.machinery.kind==='dieselElectric')!;
  const s=deriveSignature(del,'base',{speedKn:5,depthM:40,mode:'BATT'});
  configurePropulsion(s,3,del.id,'BATT');updateDerivedSignature(s,effectiveParams(del),5,40,'BATT');
  const t=s.propulsion!;
  expect(t.engines.every(e=>!e.running)).toBe(true);
  expect(s.tonals!.find(l=>l.lineFamily==='PSR'&&l.harmonic===1)!.hz).toBeCloseTo(t.shafts[0].hz,10);
  if(t.stages.length)expect(t.stages[0].meshHz).toBeCloseTo(t.shafts[0].hz*t.ratio*t.stages[0].pinionTeeth,10);

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
  expect(hi.flowNoiseDb).toBeTypeOf('number');
  expect(hi.tonals!.every(l=>l.lineFamily!=='SRC'||l.family==='src')).toBe(true);
 });
 it('speed-window SRC is sole emitter when present; legacy srcHzPerKn is fallback-only; no duplicate Hz',()=>{
  // Pre-fix: every class had BOTH paths → 4 powered SRC lines (window h=1,2 + 2 legacy rates).
  for(const c of catalog.classes){
   expect(c.speedWindows?.some(w=>w.kind==='SRC')).toBe(true);
   const mode=c.plant==='nuclear'?'NUC' as const:'SNORK' as const;
   const w=c.speedWindows!.find(x=>x.kind==='SRC')!;
   const mid=(w.speedKts[0]+w.speedKts[1])/2,speed=Math.min(c.params.maxSpeedKn,Math.max(w.speedKts[0]+.05,mid));
   const s=deriveSignature(c,'base',{speedKn:speed,depthM:50,mode});
   configurePropulsion(s,2,c.id,mode);updateDerivedSignature(s,effectiveParams(c),speed,50,mode);
   const powered=s.tonals!.filter(l=>l.lineFamily==='SRC'&&l.power>0);
   const keys=powered.map(l=>l.hz.toFixed(6));
   expect(new Set(keys).size).toBe(keys.length);
   for(const rate of c.params.srcHzPerKn){
    const legacy=speed*rate,windowHit=(s.speedGated??[]).some(g=>g.kind==='SRC'&&g.gain>0&&(Math.abs(g.hz-legacy)<1e-6||Math.abs(g.hz*2-legacy)<1e-6));
    if(!windowHit)expect(powered.some(l=>Math.abs(l.hz-legacy)<1e-6)).toBe(false);
   }
   const gate=s.speedGated!.find(g=>g.name===w.name)!;
   if(gate.kind==='SRC'&&gate.gain>0){
    expect(powered.some(l=>l.harmonic===1&&Math.abs(l.hz-gate.hz)<1e-6)).toBe(true);
    expect(powered.filter(l=>l.harmonic===1).length).toBe((s.speedGated??[]).filter(g=>g.kind==='SRC'&&g.gain>0).length);
   }
  }
  // Fallback: strip window SRC → legacy rates emit once each
  const c=catalog.classes[0]!,mode=c.plant==='nuclear'?'NUC' as const:'SNORK' as const,speed=5;
  const s=deriveSignature(c,'base',{speedKn:speed,depthM:40,mode});
  configurePropulsion(s,4,c.id,mode);updateDerivedSignature(s,effectiveParams(c),speed,40,mode);
  const windows=s.plantSpec!.speedWindows;s.plantSpec!.speedWindows=windows?.filter(w=>w.kind!=='SRC');
  s.speedGated=(s.speedGated??[]).filter(g=>g.kind!=='SRC');
  writePlantTonals(s,mode,c.params.electricalHarmonics,c.params.srcHzPerKn,speed);
  if(windows)s.plantSpec!.speedWindows=windows;
  const legacyLines=s.tonals!.filter(l=>l.lineFamily==='SRC'&&l.power>0&&l.harmonic===1);
  expect(legacyLines.length).toBe(c.params.srcHzPerKn.length);
  for(const rate of c.params.srcHzPerKn)expect(legacyLines.some(l=>Math.abs(l.hz-speed*rate)<1e-6)).toBe(true);
  expect(new Set(legacyLines.map(l=>l.hz.toFixed(6))).size).toBe(legacyLines.length);
 });
});
