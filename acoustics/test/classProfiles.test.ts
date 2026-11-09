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
   for(const e of p.engines){ordered(e.csrHz);ordered(e.cfrHz);ordered(e.efrHz);expect(e.efrHz[1]).toBeGreaterThan(e.cfrHz[1]);}
   for(const e of p.edas){ordered(e.cfrMultiple);ordered(e.hzRange);const d=c.edas.find(x=>x.name===e.name)!;expect(d.cfrMultiple).toBeGreaterThanOrEqual(e.cfrMultiple[0]);expect(d.cfrMultiple).toBeLessThanOrEqual(e.cfrMultiple[1]);}
   if(p.plant==='diesel')expect(p.engines.length).toBeGreaterThan(0);else expect(p.turbines).toBeDefined();
   expect(p.depthM.test).toBeGreaterThanOrEqual(p.depthM.maxOperating);
  }
 });
 it('engine products are shared where sheets match and list every user',()=>{
  for(const pr of products)for(const id of pr.usedByClassIds)expect(profiles.find(p=>p.id===id)!.engines.some(e=>e.productId===pr.productId)).toBe(true);
  expect(new Set(products.map(p=>p.productName)).size).toBe(products.length);
 });
 it('live generated contacts stay inside their class profile ranges',()=>{
  let checked=0;
  for(const d of ['easy','regular','difficult'] as const)for(let seed=0;seed<16;seed++){
   const e=new AcousticEngine(generateScenario(presetToParams(d,seed)));
   for(const c of e.scenario.contacts){if(!c.catalogRef)continue;const p=profiles.find(p=>p.id===c.catalogRef!.classId);if(!p)continue;const t=c.params.propulsion!;
    for(const s of t.shafts??[])expect(s.rpm/60).toBeLessThanOrEqual(p.shaft.psrHzMax*(1+1e-6));
    for(const en of t.engines??[])if(en.running){const band=p.engines.find(x=>en.cfrHz>=x.cfrHz[0]-1e-3&&en.cfrHz<=x.cfrHz[1]+1e-3);expect(band,`${p.id} cfr ${en.cfrHz}`).toBeDefined();checked++;}
   }
  }
  expect(checked).toBeGreaterThan(0);
 });
});
