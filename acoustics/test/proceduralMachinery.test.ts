import {describe,it,expect} from 'vitest';
import {generateScenario,presetToParams,clampParams,AcousticEngine,catalog,effectiveParams} from '../src/index.js';
const scan=(difficulty:'regular'|'difficult',disabled=false)=>{
 let on=0,off=0,surf=0,snork=0;
 for(let seed=0;seed<48;seed++){
  const p=presetToParams(difficulty,seed);if(disabled)p.opState.shallowDieselProb=0;
  const s=generateScenario(p);
  for(const c of s.contacts.filter(c=>c.category!=='surface')){
   const k=catalog.classes.find(k=>k.id===c.catalogRef!.classId)!;
   if(k.plant!=='diesel')continue;
   if(c.operatingMode==='SURF'||c.operatingMode==='SNORK'){
    on++;if(c.operatingMode==='SURF'){surf++;expect(c.depth).toBe(0);}else{snork++;expect(c.depth).toBeGreaterThan(0);expect(c.depth).toBeLessThanOrEqual(k.snorkelDepthM);}
   }else off++;
   if(disabled)expect(c.depth).toBeGreaterThanOrEqual(Math.min(p.opState.depthM[0],effectiveParams(k,c.catalogRef!.variantId).depthM[1]));
  }
 }
 return {on,off,surf,snork};
};
describe('explicit procedural shallow-machinery mixture',()=>{
 it.each(['regular','difficult'] as const)('%s includes running and engine-off diesel states',d=>{
  const x=scan(d);expect(x.on).toBeGreaterThan(0);expect(x.off).toBeGreaterThan(x.on);expect(x.surf).toBeGreaterThan(0);expect(x.snork).toBeGreaterThan(0);
 });
 it.each(['regular','difficult'] as const)('%s mixture can be disabled to retain deep patrol range',d=>{expect(scan(d,true).on).toBe(0);});
 it('is explicit, clamped, deterministic and traffic-independent',()=>{
  expect(clampParams({}).opState.shallowDieselProb).toBeUndefined();
  expect(clampParams({opState:{shallowDieselProb:2}}).opState.shallowDieselProb).toBe(1);
  const p=presetToParams('regular',2);expect(generateScenario(p)).toEqual(generateScenario(p));
  const subs=(traffic:number)=>generateScenario({...p,surfaceTraffic:traffic}).contacts.filter(c=>c.category!=='surface');
  expect(subs(0)).toEqual(subs(1));
 });
 it('battery machinery stays silent while independent auxiliaries remain',()=>{
  for(let seed=0;seed<12;seed++){
   const e=new AcousticEngine(generateScenario(presetToParams('difficult',seed)));
   for(const c of e.scenario.contacts)if(c.operatingMode==='BATT'){
    expect(c.params.propulsion!.engines.every(x=>!x.running)).toBe(true);
    expect(c.params.tonals!.filter(x=>['CSR','CFR','EFR','EDA'].includes(x.lineFamily??'')).every(x=>x.power===0)).toBe(true);
    expect(c.params.tonals!.some(x=>x.lineFamily==='AUX'&&x.power>0)).toBe(true);
   }
  }
 });
});
