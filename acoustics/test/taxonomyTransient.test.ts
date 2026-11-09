import {describe,it,expect} from 'vitest';
import {
 catalog,AcousticEngine,cpaScenario,knotsToMps,maneuverTransients,planBehaviour,
} from '../src/index.js';

describe('taxonomy transients (swath flashes + class TRANSIENT)',()=>{
 it('manoeuvre schedule emits short broadband swath events',()=>{
  const legs=planBehaviour({kind:'patrol',seed:42,durationS:3600,holdS:100,start:{course:0,speed:knotsToMps(6),depth:60},limits:{maxSpeedKn:12,depthM:[20,120]}});
  const tr=maneuverTransients(legs,{},()=>.5);
  const swaths=tr.filter(t=>t.kind==='swath');
  expect(swaths.length).toBeGreaterThan(0);
  for(const s of swaths){
   expect(Number(s.params.durationS)).toBeLessThanOrEqual(2);
   expect(Number(s.params.hiHz)).toBeGreaterThan(Number(s.params.loHz));
  }
 });
 it('AcousticEngine arms eventSwaths as brief broadband flashes',()=>{
  const c=catalog.classes[0];
  const sc=cpaScenario();
  sc.contacts=[{...sc.contacts[0],id:'sw-1',catalogRef:{classId:c.id},operatingMode:c.plant==='nuclear'?'NUC':'SNORK',speed:knotsToMps(8),depth:40,
   motion:[{at:0,course:0,speed:knotsToMps(8),depth:40},{at:50,course:1,speed:knotsToMps(8),depth:40}],
   transients:[{at:50,kind:'swath',params:{durationS:.5,loHz:80,hiHz:400}}]}];
  const e=new AcousticEngine(sc);
  expect(e.scenario.contacts[0].params.eventSwaths?.length).toBe(1);
  expect(e.scenario.contacts[0].params.eventSwaths![0].gain).toBe(0);
  e.advance(50.1);
  expect(e.scenario.contacts[0].params.eventSwaths![0].gain).toBe(1);
  e.advance(1);
  expect(e.scenario.contacts[0].params.eventSwaths![0].gain).toBe(0);
 });
 it('class-specific TRANSIENT lines exist on a subset and pulse with duration',()=>{
  const withTr=catalog.classes.filter(c=>c.classTransients?.length);
  expect(withTr.length).toBeGreaterThanOrEqual(3);
  const c=withTr[0],sc=cpaScenario();
  sc.contacts=[{...sc.contacts[0],id:'tr-1',catalogRef:{classId:c.id},operatingMode:c.plant==='nuclear'?'NUC':'SNORK',speed:knotsToMps(8),depth:40,
   motion:[{at:0,course:0,speed:knotsToMps(8),depth:40}],
   transients:[{at:10,kind:'transient',params:{durationS:1,hz:c.classTransients![0].hz,harmonics:1}}]}];
  const e=new AcousticEngine(sc);
  const line=()=>e.scenario.contacts[0].params.tonals!.find(l=>l.lineFamily==='TRANSIENT')!;
  expect(line().power).toBe(0);
  e.advance(10.2);expect(line().power).toBeGreaterThan(0);
  e.advance(2);expect(line().power).toBe(0);
 });
});
