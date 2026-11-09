import {describe,it,expect} from 'vitest';
import {catalog,generateScenario,presetToParams,AcousticEngine} from '../src/index.js';
import {buildClassProfiles,buildEngineProducts} from '../src/catalog/profiles.js';
import {isDeniedOperator} from '../src/catalog/nations.js';
const profiles=buildClassProfiles(),products=buildEngineProducts();
const ordered=(x:[number,number])=>expect(x[0]).toBeLessThanOrEqual(x[1]);
describe('class profiles (manual / reveal)',()=>{
 it('cover every class, fictional names and nations only',()=>{
  expect(profiles.map(p=>p.id)).toEqual(catalog.classes.map(c=>c.id));
  for(const p of profiles){expect(p.name.startsWith('Fictional ')).toBe(true);for(const n of [p.operatorNation,...p.alliedNations,...p.engineSharedWithNations])expect(isDeniedOperator(n)).toBe(false);}
 });
 it('acoustic figures are ordered ranges or maximums derived from the catalog',()=>{
  for(const p of profiles){const c=catalog.classes.find(c=>c.id===p.id)!;
   expect(p.shaft.psrHzMax).toBeCloseTo(c.maxPsrpm/60,3);expect(p.shaft.brHzMax).toBeCloseTo(c.maxPsrpm/60*c.propeller.blades,2);
   ordered(p.shaft.psrHzQuiet);ordered(p.shaft.brHzQuiet);expect(p.shaft.psrHzQuiet[1]).toBeLessThanOrEqual(p.shaft.psrHzMax+1e-9);
   const diesels=p.primeMovers.filter(m=>m.kind==='diesel') as Extract<typeof p.primeMovers[number],{kind:'diesel'}>[];
   for(const e of diesels){ordered(e.csrHz);ordered(e.cfrHz);ordered(e.efrHz);expect(e.efrHz[1]).toBeGreaterThan(e.cfrHz[1]);}
   for(const e of p.edas){ordered(e.cfrMultiple);ordered(e.hzRange);const d=c.edas.find(x=>x.name===e.name)!;expect(d.cfrMultiple).toBeGreaterThanOrEqual(e.cfrMultiple[0]);expect(d.cfrMultiple).toBeLessThanOrEqual(e.cfrMultiple[1]);}
   if(p.plant==='diesel')expect(diesels.length).toBeGreaterThan(0);else expect(p.primeMovers.every(m=>m.kind==='turbine')).toBe(true);
   expect(p.depthM.test).toBeGreaterThanOrEqual(p.depthM.maxOperating);
  }
 });
 it('engine products are shared where sheets match and list every user',()=>{
  for(const pr of products)for(const id of pr.usedByClassIds)expect(profiles.find(p=>p.id===id)!.primeMovers.some(e=>e.kind==='diesel'&&e.productId===pr.productId)).toBe(true);
  expect(new Set(products.map(p=>p.productName)).size).toBe(products.length);
 });
 it('live generated contacts stay inside their class profile ranges',()=>{
  let checked=0;
  for(const d of ['easy','regular','difficult'] as const)for(let seed=0;seed<16;seed++){
   const e=new AcousticEngine(generateScenario(presetToParams(d,seed)));
   for(const c of e.scenario.contacts){if(!c.catalogRef)continue;const p=profiles.find(p=>p.id===c.catalogRef!.classId);if(!p)continue;const t=c.params.propulsion!;
    for(const s of t.shafts??[])expect(s.rpm/60).toBeLessThanOrEqual(p.shaft.psrHzMax*(1+1e-6));
    for(const en of t.engines??[])if(en.running){const band=p.primeMovers.find(x=>x.kind==='diesel'&&en.cfrHz>=x.cfrHz[0]-1e-3&&en.cfrHz<=x.cfrHz[1]+1e-3);expect(band,`${p.id} cfr ${en.cfrHz}`).toBeDefined();checked++;}
   }
  }
  expect(checked).toBeGreaterThan(0);
 });
 it('fictional hull forms are deterministic and physically sane',()=>{
  for(const p of profiles){const h=p.hullForm;expect(h.fictional).toBe(true);expect(h.lengthM/h.beamM).toBeGreaterThan(6.5);expect(h.lengthM/h.beamM).toBeLessThan(12);
   expect(h.sail.fromBowFrac).toBeGreaterThan(.2);expect(h.sail.fromBowFrac+h.sail.lengthM/h.lengthM).toBeLessThan(.6);
   if(p.aip)expect(h.aipPlugM).toBeGreaterThan(0);
   const d=p.hull.propellerDrawing;expect(d.blades).toBe(p.hull.propeller.blades);expect(d.catalogType).toBe(p.hull.propeller.type);expect(d.pitch).toBe(d.catalogType==='cpp'?'controllable':'fixed');if(d.bladeForm==='skewed')expect(d.skewDeg).toBeGreaterThanOrEqual(25);else expect(d.skewDeg).toBeLessThan(16);expect(d.diameterM).toBeLessThan(h.beamM);}
  expect(buildClassProfiles()).toEqual(profiles);
 });
 it('operators: origin separate from exports; each hull has exactly one operator; scenario pool unchanged',()=>{
  for(const p of profiles){const c=catalog.classes.find(c=>c.id===p.id)!,o=p.operators;
   expect(o.designOriginNationId).toBe(c.operatorNationId);
   for(const h of o.hulls)expect(o.operators.filter(x=>x.hullIds.includes(h.id)).length).toBe(1);
   expect(o.hulls.filter(h=>h.inScenarioPool).map(h=>h.id)).toEqual(c.hulls.map(h=>h.id));
   for(const h of o.hulls.filter(h=>h.inScenarioPool))expect(h.operatorNationId).toBe(c.operatorNationId);}
  const g=profiles.find(p=>p.id==='red-gloamspiral')!;expect(g.operators.operatorNames).toEqual(['Kaelun Republic','Dorhan Commonwealth']);
 });
});
