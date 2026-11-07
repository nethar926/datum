import {describe,it,expect} from 'vitest';
import {
  placeContactSpawn,fadeInRangeM,broadbandSnrDb,FADE_IN_SNR_DB,FADE_IN_MAX_S,
  spawnLevelDb,generateScenario,presetToParams,catalog,deriveSignature,knotsToMps,
} from '../src/index.js';

const env={seaState:3,shipping:'moderate' as const,soundSpeed:1500,spreading:'spherical' as const,transition:1000};

describe('spawn geometry fade-in',()=>{
 it('outside placement reaches fade-in SNR within ≤180 s',()=>{
  const level=130;
  const rFade=fadeInRangeM(level,env);
  expect(broadbandSnrDb(level,rFade,100,env)).toBeGreaterThanOrEqual(FADE_IN_SNR_DB-0.2);
  for(let seed=1;seed<=40;seed++){
   const place=placeContactSpawn({
    seed,contactId:`c${seed}`,speed:knotsToMps(8),depth:60,levelDb:level,env,inside:false,
   });
   expect(place.inside).toBe(false);
   expect(place.fadeInS).toBeLessThanOrEqual(FADE_IN_MAX_S*1.05);
   expect(place.startRangeM).toBeGreaterThan(rFade);
  }
 });

 it('inside placement starts already above threshold',()=>{
  const place=placeContactSpawn({
   seed:9,contactId:'in',speed:knotsToMps(6),depth:40,levelDb:128,env,inside:true,
  });
  expect(place.inside).toBe(true);
  expect(place.fadeInS).toBe(0);
  expect(broadbandSnrDb(128,place.startRangeM,100,env)).toBeGreaterThanOrEqual(FADE_IN_SNR_DB-1);
 });

 it('generateScenario places subs with finite coords and uses spawnLevelDb',()=>{
  const p=presetToParams('regular',404);p.subCount=3;p.surfaceTraffic=0;
  const s=generateScenario(p);
  for(const c of s.contacts.filter(x=>x.category==='subsurface')){
   expect(Number.isFinite(c.x)&&Number.isFinite(c.y)).toBe(true);
   expect(c.speed).toBeGreaterThan(0);
   const klass=catalog.classes.find(k=>k.id===c.catalogRef!.classId)!;
   const sig=deriveSignature(klass,'base',{speedKn:8,depthM:50,mode:c.operatingMode??'BATT'});
   expect(spawnLevelDb(sig,c.speed,c.depth)).toBeGreaterThan(100);
  }
 });
});
