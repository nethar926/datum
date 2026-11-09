import {describe,it,expect} from 'vitest';
import {
  createSurfacePool,SURFACE_EVENT_RATE,countDynamicEvents,surfaceTypes,
  catalog,SURFACE_VS_SUB_LEVEL_DB,deriveSignature,mpsToKnots,
} from '../src/index.js';

describe('surface event rates + louder surfaces',()=>{
 it('rate ordering: sub ≫ fishing ≫ other ≫ 0',()=>{
  expect(SURFACE_EVENT_RATE.subPerHour).toBeGreaterThan(SURFACE_EVENT_RATE.fishingPerHour);
  expect(SURFACE_EVENT_RATE.fishingPerHour).toBeGreaterThan(SURFACE_EVENT_RATE.otherPerHour);
  expect(SURFACE_EVENT_RATE.otherPerHour).toBeGreaterThan(0);
 });

 it('across seeds, fishing contacts carry more events than other surface (both nonzero)',()=>{
  let fish=0,other=0,fishN=0,otherN=0;
  for(let seed=1;seed<=80;seed++){
   for(const c of createSurfacePool(seed)){
    const n=countDynamicEvents(c);
    const kind=surfaceTypes.find(t=>t.id===c.surface!.type)!.kind;
    if(kind==='fishing'){fish+=n;fishN++;}else{other+=n;otherN++;}
   }
  }
  expect(fishN).toBeGreaterThan(0);expect(otherN).toBeGreaterThan(0);
  const fishRate=fish/fishN,otherRate=other/otherN;
  expect(fishRate).toBeGreaterThan(otherRate);
  expect(other).toBeGreaterThan(0); // rare but nonzero
 });

 it('surface level sits well above a quiet sub at equal teaching speed',()=>{
  const klass=catalog.classes[2]!;
  for(const c of createSurfacePool(11)){
   const sub=deriveSignature(klass,'base',{speedKn:mpsToKnots(c.speed),depthM:50,mode:'quiet'});
   expect(c.params.levelDb).toBeGreaterThan(sub.levelDb+SURFACE_VS_SUB_LEVEL_DB);
  }
 });
});
