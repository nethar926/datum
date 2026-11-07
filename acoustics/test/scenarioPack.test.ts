import {describe,it,expect} from 'vitest';
import {
  SCENARIO_PACK,SCENARIO_CUTS,CUT_SCENARIO_KINDS,validateScenarioPack,
  renderCut,SIM_STREAM_SET,cutStreamSet,catalog,
} from '../src/index.js';

describe('15-min scenario cut pack',()=>{
 it('validates: 16 kinds × 900 s, unique ids, modelVersion',()=>{
  expect(()=>validateScenarioPack(SCENARIO_PACK)).not.toThrow();
  expect(SCENARIO_CUTS).toHaveLength(CUT_SCENARIO_KINDS.length);
  expect(SCENARIO_PACK.cuts.every(c=>c.durationS===900)).toBe(true);
  expect(new Set(SCENARIO_PACK.cuts.map(c=>c.scenario)).size).toBe(CUT_SCENARIO_KINDS.length);
 });

 it('no-hydp cut uses a class without HYDP; hydp-masked uses one with HYDP',()=>{
  const no=SCENARIO_PACK.cuts.find(c=>c.scenario==='no-hydp')!;
  const masked=SCENARIO_PACK.cuts.find(c=>c.scenario==='hydp-masked')!;
  const noCls=catalog.classes.find(c=>c.id===no.classId)!;
  const maskCls=catalog.classes.find(c=>c.id===masked.classId)!;
  expect(noCls.hydp).toBeUndefined();
  expect(maskCls.hydp).toBeTruthy();
 });

 it('renderCut builds a session with full stream set and 900 s duration (hash-stable seed)',()=>{
  const cut=SCENARIO_PACK.cuts.find(c=>c.scenario==='battery')!;
  const a=renderCut(cut),b=renderCut(cut);
  expect(a.cut.durationS).toBe(900);
  expect(a.streamSet).toEqual(SIM_STREAM_SET);
  expect(cutStreamSet()).toEqual(SIM_STREAM_SET);
  expect(a.checksumFirstRows(4)).toBe(b.checksumFirstRows(4));
  expect(a.checksumFirstRows(4)).not.toBe(0);
  a.dispose();b.dispose();
 });

 it('scenario overlays inject motion/transients for maneuver kinds',()=>{
  const lloyd=renderCut(SCENARIO_PACK.cuts.find(c=>c.scenario==='lloyd-maneuver')!);
  const contact=lloyd.engine.scenario.contacts[0];
  expect(contact.motion.length).toBeGreaterThan(1);
  expect((contact.transients??[]).some(t=>t.kind==='swath'||t.kind==='hydp')).toBe(true);
  lloyd.dispose();
 });
});
