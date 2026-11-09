/**
 * DEMON lesson pack + answer-key expectations (cut metadata / reveal only) + LOFAR goldens for the
 * new 900 s cavitating diesel cuts. All classes fictional.
 */
import {describe,it,expect} from 'vitest';
import {
 STARTER_CUTS,STARTER_PACK,DEMON_LESSON_PACK,DEMON_CUTS,DEMON_LESSON_CUT_IDS,getCutSeed,listDemonLessonCuts,renderCut,
 cutDemonExpectation,scenarioDemonAnswerKey,validateDemonLessonPack,DEMON_REASONS,
 AcousticEngine,cpaScenario,WorkerRuntime,loadScenario,
} from '../src/index.js';
import {getClass} from '../src/catalog/derive.js';
import {modeSpeedCap} from '../src/maneuver.js';
import {DEMON_CUT_IDS} from '../bench/demonContrast.js';
import type {Command,WorkerResponse} from '../src/protocol.js';

const LEAK=/demonExpected|demonReason/;
/** Deep key/value scan (typed arrays carry no fields). */
function leaks(v:unknown,seen=new Set<unknown>()):string[]{
 if(v===null||typeof v!=='object'||seen.has(v)||ArrayBuffer.isView(v)||v instanceof ArrayBuffer)return typeof v==='string'&&LEAK.test(v)?[v]:[];
 seen.add(v);const out:string[]=[];
 const entries=v instanceof Map?[...v.entries()]:Object.entries(v as object);
 for(const [k,x] of entries){if(typeof k==='string'&&LEAK.test(k))out.push(k);out.push(...leaks(x,seen));}
 return out;
}

describe('DEMON lesson pack',()=>{
 it('cut-cinderlilt-cav is a starter cut and the main DEMON lesson, first in every DEMON starter order',()=>{
  const main=STARTER_CUTS.find(c=>c.id==='cut-cinderlilt-cav')!;
  expect(main).toBeDefined();
  expect(DEMON_LESSON_PACK.mainLessonCutId).toBe('cut-cinderlilt-cav');
  expect(DEMON_LESSON_CUT_IDS).toEqual(['cut-cinderlilt-cav','cut-brindleflux-cav','cut-gloamspiral-cav']);
  expect(DEMON_CUT_IDS[0]).toBe('cut-cinderlilt-cav');
  expect(DEMON_CUT_IDS.slice(1)).toEqual(['cut-brindleflux-snork','cut-emberbraid-ssma','cut-gloamspiral-aip','cut-orbelune-msr','cut-mistacorn-batt']);
  expect(main.lessonNote).toMatch(/Main DEMON lesson/);
  expect(main.classifyingLines[0].label).toMatch(/main DEMON example/);
  expect(listDemonLessonCuts().map(c=>c.id)).toEqual([...DEMON_LESSON_CUT_IDS]);
  expect(STARTER_PACK.cuts.length).toBeLessThanOrEqual(10);
 });
 it('new cuts: 900 s, seeded, surfaced diesel under the class cap, resolvable by id, frozen',()=>{
  expect(DEMON_CUTS.map(c=>c.id)).toEqual(['cut-brindleflux-cav','cut-gloamspiral-cav']);
  for(const c of DEMON_CUTS){
   expect(c.durationS).toBe(900);expect(c.mode).toBe('SURF');expect(c.depthM).toBe(0);
   const k=getClass(c.classId);expect(k.plant).not.toBe('nuclear');
   expect(c.speedKn).toBeLessThanOrEqual(modeSpeedCap(k,'SURF'));
   expect(getCutSeed(c.id)).toBe(c);expect(Object.isFrozen(c)).toBe(true);
   expect(new Set([...STARTER_CUTS,...DEMON_CUTS].map(x=>x.seed)).size).toBe(STARTER_CUTS.length+DEMON_CUTS.length);
  }
  expect(()=>validateDemonLessonPack(DEMON_LESSON_PACK,STARTER_CUTS)).not.toThrow();
  const fast={...DEMON_CUTS[0],speedKn:14}; // inside class envelope, above the 13.5 kn surfaced cap
  expect(()=>validateDemonLessonPack({...DEMON_LESSON_PACK,cuts:[fast,DEMON_CUTS[1]]},STARTER_CUTS)).toThrow(/cap/);
 });
 it('LOFAR goldens for the new cuts (deterministic, seeded)',()=>{
  const GOLD:Record<string,[number,number]>={'cut-brindleflux-cav':[3259499233,2247615570],'cut-gloamspiral-cav':[662601379,1084524737]};
  for(const [id,[a,b]] of Object.entries(GOLD)){const s=renderCut(id);expect(s.checksumFirstRows(16)).toBe(a);s.seekTo(450);expect(s.checksumFirstRows(4)).toBe(b);s.dispose();}
 },60000);
});

describe('DEMON expectations derived from the cavitation model (answer key only)',()=>{
 it('five legacy starters report not-cavitating; the three cav cuts report cavitating',()=>{
  for(const id of ['cut-brindleflux-snork','cut-emberbraid-ssma','cut-gloamspiral-aip','cut-orbelune-msr','cut-mistacorn-batt']){
   const e=cutDemonExpectation(getCutSeed(id)!);
   expect(e.demonExpected,id).toBe(false);expect(e.demonReason).toBe('not-cavitating');
  }
  for(const id of DEMON_LESSON_CUT_IDS){
   const e=cutDemonExpectation(getCutSeed(id)!);
   expect(e.demonExpected,id).toBe(true);expect(e.demonReason).toBe('cavitating');
   expect(e.pastInceptionPct!).toBeGreaterThan(20);expect(e.pastInceptionFraction).toBe(1);
  }
 });
 it('barely-incepting snort cuts are honest: past inception by <1 %, cavitation <2 % of the modulated mix',()=>{
  for(const id of ['cut-brindleflux-snork','cut-emberbraid-ssma']){const e=cutDemonExpectation(getCutSeed(id)!);expect(e.pastInceptionPct!).toBeGreaterThanOrEqual(0);expect(e.pastInceptionPct!).toBeLessThan(1);expect(e.modulatedFraction).toBeLessThan(.02);}
 });
 it('per-contact rows cover target + seeded traffic and use only the two reasons',()=>{
  const e=cutDemonExpectation(getCutSeed('cut-brindleflux-cav')!);
  expect(e.contacts.filter(c=>c.classificationTarget)).toHaveLength(1);
  for(const c of e.contacts)expect(DEMON_REASONS).toContain(c.demonReason);
  expect(Object.isFrozen(e)).toBe(true);
 });
 it('scenario reveal answer key is a fresh array and does not mutate the scenario',()=>{
  const s=loadScenario(cpaScenario()),before=JSON.stringify(s);
  const key=scenarioDemonAnswerKey(s);
  expect(key.length).toBe(s.contacts.filter(c=>c.active!==false).length);
  expect(JSON.stringify(s)).toBe(before);expect(leaks(s)).toEqual([]);
 });
});

describe('no answer leak on the live / subscription path',()=>{
 it('engine: subscribe result, configs, DEMON rows, tactical and live contacts carry no demonExpected/demonReason',()=>{
  const e=new AcousticEngine(cpaScenario());const id=e.subscribe({kind:'demon',buoyId:1});
  expect(typeof id).toBe('number');
  e.advance(6);const row=new Float32Array(512);expect(e.rowsReady(id)).toBeGreaterThan(0);e.writeRow(id,row,0);
  // compute an answer key mid-play: must not attach anything to live state
  scenarioDemonAnswerKey(e.scenario);
  expect(leaks(e.configs())).toEqual([]);expect(leaks(e.tactical())).toEqual([]);expect(leaks(e.scenario)).toEqual([]);
 });
 it('cut session (played like live): subscribe configs, rows and engine state carry no field',()=>{
  const s=renderCut('cut-cinderlilt-cav');cutDemonExpectation(s.cut);
  const lofar=new Float32Array(s.lofar.bins);for(let k=0;k<40&&s.engine.rowsReady(s.demonStreamId)===0;k++)s.writeLofarRow(lofar);
  expect(leaks(s.engine.configs())).toEqual([]);expect(leaks(s.engine.tactical())).toEqual([]);expect(leaks(s.engine.scenario)).toEqual([]);expect(leaks(s.cut)).toEqual([]);
  s.dispose();
 });
 it('worker: gramConfig / gramRows / tactical messages carry no field',()=>{
  const messages:WorkerResponse[]=[],r=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));
  const send=(m:Command)=>r.command({...m,v:1,simT:r.simT});
  send({type:'init',seed:42,scenarioId:'m1-cpa-pass'} as Command);send({type:'subscribe',kind:'demon',buoyId:1} as Command);
  for(let i=0;i<8;i++)r.tick(.25);
  expect(messages.some(m=>m.type==='gramConfig')).toBe(true);expect(messages.some(m=>m.type==='gramRows')).toBe(true);
  expect(leaks(messages)).toEqual([]);
 });
});
