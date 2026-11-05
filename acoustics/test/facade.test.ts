import {it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,loadScenario,ScenarioError,exampleScenarios} from '../src/index.js';
import type {LogEvent,Confidence,LogEventType,GramConfig,GramRows,Tactical,Command,WorkerRequest,WorkerResponse} from '../src/contract.js';
it('loadScenario validates and reports precise paths in ScenarioError',()=>{
  const valid=cpaScenario();expect(loadScenario(valid)).toBe(valid);
  const invalid=cpaScenario();invalid.contacts[0].params.shaftHz=NaN;
  try{loadScenario(invalid);throw new Error('should reject');}catch(e){expect(e).toBeInstanceOf(ScenarioError);expect((e as ScenarioError).path).toBe('$.contacts[0].params.shaftHz');}
  try{loadScenario(null);}catch(e){expect(e).toBeInstanceOf(ScenarioError);expect((e as ScenarioError).path).toBe('$');}
  const motion=cpaScenario();motion.contacts[0].motion[0].speed=-1;
  try{loadScenario(motion);}catch(e){expect((e as ScenarioError).path).toBe('$.contacts[0].motion[0].speed');}
});
it('named examples include M1 single contact and separate benchmark field',()=>{expect(exampleScenarios['m1-cpa-pass'].contacts).toHaveLength(1);expect(exampleScenarios['benchmark-busy-field'].contacts.length).toBeGreaterThan(1);for(const s of Object.values(exampleScenarios))expect(()=>loadScenario(s)).not.toThrow();});
it('constructor optional seed overrides without mutating input and simT aliases time',()=>{const s=cpaScenario(),a=new AcousticEngine(s,123),b=new AcousticEngine({...s,seed:123});expect(s.seed).toBe(42);expect(a.scenario.seed).toBe(123);expect(a.step(.25)[0].row).toEqual(b.step(.25)[0].row);expect(a.simT).toBe(a.time);expect(a.simT).toBe(.25);});
it('subscribe configs rowsReady and writeRow numbered allocation-free output facade',()=>{
  const e=new AcousticEngine(cpaScenario());expect(e.configs()).toEqual([]);
  const c=e.subscribe({channel:1,kind:'lofar'}),out=new Float32Array(1030);out.fill(-999);
  expect(e.configs()).toEqual([c]);expect(c).toMatchObject({type:'gramConfig',channel:1,bins:1024,kind:'lofar',rowRateHz:4});expect(c.fBin).toBe(500/1023);
  expect(e.rowsReady(c.streamId)).toBe(0);expect(e.writeRow(c.streamId,out,3)).toBe(-1);expect(out[3]).toBe(-999);
  e.advance(.5);expect(e.rowsReady(c.streamId)).toBe(2);
  expect(e.writeRow(c.streamId,out,3)).toBe(0);expect(e.rowsReady(c.streamId)).toBe(1);expect(e.writeRow(c.streamId,out,3)).toBe(1);expect(e.rowsReady(c.streamId)).toBe(0);expect(e.writeRow(c.streamId,out,3)).toBe(-1);expect(out[0]).toBe(-999);expect(out[1029]).toBe(-999);
  e.advance(.25);expect(e.writeRow(c.streamId,out,3)).toBe(2);
  e.unsubscribe(c.streamId);expect(e.configs()).toEqual([]);expect(e.rowsReady(c.streamId)).toBe(0);
});
it('subscription validates unsupported kind bins band channel and uses scenario dimensions',()=>{const s=cpaScenario();s.bins=64;s.fmax=200;const e=new AcousticEngine(s);
  expect(e.subscribe({channel:1,kind:'lofar',bins:64,band:[0,200]}).bins).toBe(64);
  expect(()=>e.subscribe({channel:1,kind:'demon' as 'lofar'})).toThrow(/kind/);
  expect(()=>e.subscribe({channel:1,kind:'lofar',bins:1024})).toThrow(/bins/);
  expect(()=>e.subscribe({channel:1,kind:'lofar',band:[0,500]})).toThrow(/band/);
  expect(()=>e.subscribe({channel:999,kind:'lofar'})).toThrow(/channel/);
});
it('legacy registered writeRow remains immediate and now returns numbered rows',()=>{const e=new AcousticEngine(cpaScenario()),out=new Float32Array(1024);expect(e.writeRow(1,out)).toBe(0);expect(e.writeRow(1,out)).toBe(1);expect([...out].every(Number.isFinite)).toBe(true);});
it('dropBuoy returns numeric id and tactical reuses records carrying lifecycle',()=>{
  const e=new AcousticEngine(cpaScenario()),id=e.dropBuoy({channel:2,kind:'omni',x:10,y:20,hydrophoneDepthM:75,lifeS:1});expect(id).toBe(2);
  const c=e.subscribe({channel:2,kind:'lofar'}),t=e.tactical();expect(t.buoys[1]).toMatchObject({id:2,channel:2,kind:'omni',x:10,y:20,hydrophoneDepthM:75,state:'live'});
  e.advance(1);expect(e.tactical()).toBe(t);expect(t.buoys[1].state).toBe('dead');const out=new Float32Array(1024);expect(e.writeRow(c.streamId,out)).toBe(0);expect([...out].every(Number.isNaN)).toBe(true);
  expect(e.dropBuoy({id:7,channel:3,kind:'difar',x:0,y:0,hydrophoneDepthM:40})).toBe(7);
});
it('contract facade exports v1 and additive v1.1 log types',()=>{
  const confidence:Confidence='probable',kind:LogEventType='classification';const event:LogEvent={v:1.1,type:'log',simT:3,kind,contactId:1,class:'Fictional SSK A',confidence,data:{training:true}};
  const compileOnly:([GramConfig?,GramRows?,Tactical?,Command?,WorkerRequest?,WorkerResponse?])=[];
  expect(event.v).toBe(1.1);expect(compileOnly.length).toBe(0);
});
