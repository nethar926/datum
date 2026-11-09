import {it,expect} from 'vitest';
import {catalog,generateScenario,presetToParams,clampParams,resolveReference,isNuclearClass,isComingSoonClass,scenarioPoolWeights,rarityWeights,rarityOrder} from '../src/index.js';

it('isComingSoonClass / isNuclearClass flag exactly the nuclear plant classes',()=>{
 const nuclear=catalog.classes.filter(c=>c.plant==='nuclear');
 const diesel=catalog.classes.filter(c=>c.plant==='diesel');
 expect(nuclear.length).toBeGreaterThan(0);
 expect(diesel.length).toBeGreaterThan(0);
 expect(nuclear.every(isNuclearClass)).toBe(true);
 expect(nuclear.every(isComingSoonClass)).toBe(true);
 expect(diesel.every(c=>!isNuclearClass(c))).toBe(true);
 expect(diesel.every(c=>!isComingSoonClass(c))).toBe(true);
 expect(catalog.classes.every(c=>isComingSoonClass(c)===isNuclearClass(c))).toBe(true);
 // Catalog entries remain intact for the Compendium.
 expect(catalog.classes.some(c=>c.plant==='nuclear')).toBe(true);
});

it('scenario pool weights zero nuclear buckets and never empty',()=>{
 const z=scenarioPoolWeights(rarityWeights);
 expect(z.nuclearGearReduction).toBe(0);
 expect(z.nuclearElectric).toBe(0);
 expect(rarityOrder.some(k=>z[k]>0)).toBe(true);
 expect(scenarioPoolWeights({dieselDirect:0,dieselGearReduction:0,dieselElectric:0,aip:0,nuclearGearReduction:99,nuclearElectric:99}).dieselElectric).toBeGreaterThan(0);
 const p=clampParams({rarityWeights:{nuclearGearReduction:80,nuclearElectric:20}});
 expect(p.rarityWeights.nuclearGearReduction).toBe(0);
 expect(p.rarityWeights.nuclearElectric).toBe(0);
 expect(rarityOrder.some(k=>p.rarityWeights[k]>0)).toBe(true);
});

it('seed sweep: procedural scenarios never draw nuclear / coming-soon contacts',()=>{
 const difficulties=['easy','regular','difficult'] as const;
 let checked=0;
 for(let seed=0;seed<220;seed++)for(const d of difficulties){
  const p=presetToParams(d,seed),s=generateScenario(p);
  const subsurface=s.contacts.filter(c=>c.category!=='surface');
  expect(subsurface.length).toBeGreaterThan(0);
  expect(subsurface.length).toBe(p.subCount);
  for(const c of subsurface){
   const {klass}=resolveReference(c.catalogRef!);
   expect(isNuclearClass(klass)).toBe(false);
   expect(isComingSoonClass(klass)).toBe(false);
   expect(klass.plant).toBe('diesel');
   checked++;
  }
  if(seed%40===0)expect(generateScenario(p)).toEqual(s);
 }
 expect(checked).toBeGreaterThan(200);
},30_000);
