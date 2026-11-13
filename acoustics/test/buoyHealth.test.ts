import {it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,MAX_RF_CHANNELS,WorkerRuntime,splashTime} from '../src/index.js';
import type {Command,WorkerRequest,WorkerResponse,Tactical} from '../src/protocol.js';

it('tactical health defaults ok; setBuoyFault toggles yellow fault and clears',()=>{
  const e=new AcousticEngine(cpaScenario()),t=e.tactical();
  expect(t.buoys[0]).toMatchObject({id:1,channel:1,state:'live',health:'ok'});
  e.setBuoyFault(1,true);expect(e.tactical().buoys[0].health).toBe('fault');
  e.setBuoyFault(1,false);expect(e.tactical().buoys[0].health).toBe('ok');
  expect(()=>e.setBuoyFault(99,true)).toThrow(/buoyId/);
});

it('fault is independent of falling/live/dead life cycle',()=>{
  const e=new AcousticEngine(cpaScenario());
  e.dropBuoy({channel:2,kind:'omni',x:0,y:0,hydrophoneDepthM:40,lifeS:.5});
  e.setBuoyFault(2,true);
  expect(e.tactical().buoys[1]).toMatchObject({state:'live',health:'fault',channel:2});
  const b2=e.scenario.buoys[1]!;
  e.advance(splashTime(b2)+b2.life-e.time);expect(e.tactical().buoys[1]).toMatchObject({state:'dead',health:'fault',channel:2});
});

it('detune releases RF for reuse; retune reassigns; streams NaN while detuned',()=>{
  const e=new AcousticEngine(cpaScenario());
  expect(e.tactical().buoys[0].channel).toBe(1);
  const out=new Float32Array(1024);
  e.writeRow(1,out);expect([...out].every(Number.isFinite)).toBe(true);
  e.detuneBuoy(1);
  const t=e.tactical();expect(t.buoys[0]).toMatchObject({id:1,channel:0,state:'live',health:'ok'});
  e.writeRow(1,out);expect([...out].every(Number.isNaN)).toBe(true);
  // Freed channel 1 can be claimed by a new drop.
  expect(e.dropBuoy({channel:1,kind:'omni',x:10,y:10,hydrophoneDepthM:50})).toBe(2);
  expect(e.tactical().buoys.map(b=>b.channel)).toEqual([0,1]);
  // Retune buoy 1 onto lowest free (2).
  expect(e.tuneBuoy(1)).toBe(2);
  expect(e.tactical().buoys[0].channel).toBe(2);
  e.writeRow(1,out);expect([...out].every(Number.isFinite)).toBe(true);
});

it('tune with host channel; NO CH when pool full; already-tuned rejected',()=>{
  const e=new AcousticEngine(cpaScenario());
  e.detuneBuoy(1);
  expect(e.tuneBuoy(1,7)).toBe(7);
  expect(e.tactical().buoys[0].channel).toBe(7);
  expect(()=>e.tuneBuoy(1,8)).toThrow(/already tuned/);
  e.detuneBuoy(1);
  for(let ch=1;ch<=MAX_RF_CHANNELS;ch++)e.dropBuoy({id:100+ch,channel:ch,kind:'omni',x:0,y:0,hydrophoneDepthM:40});
  expect(e.lowestFreeChannel()).toBeNull();
  expect(()=>e.tuneBuoy(1)).toThrow(/NO CH/);
});

it('idempotent detune; dead life still works after detune',()=>{
  const e=new AcousticEngine(cpaScenario());
  e.dropBuoy({id:3,channel:3,kind:'difar',x:0,y:0,hydrophoneDepthM:40,lifeS:.25});
  e.detuneBuoy(3);e.detuneBuoy(3);
  expect(e.tactical().buoys.find(b=>b.id===3)).toMatchObject({channel:0,state:'live'});
  const b3=e.scenario.buoys.find(b=>b.id==='buoy-3'||(b as {id:string}).id.endsWith('3'))??e.scenario.buoys.at(-1)!;
  e.advance(splashTime(b3)+b3.life-e.time);
  expect(e.tactical().buoys.find(b=>b.id===3)).toMatchObject({channel:0,state:'dead'});
});

function setup(){const messages:WorkerResponse[]=[];const runtime=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));const send=(m:Command,simT=runtime.simT)=>runtime.command({...m,v:1,simT} as WorkerRequest);send({type:'init',seed:42,scenarioId:'cpa-pass'});return {runtime,messages,send};}
const lastTac=(messages:WorkerResponse[]):Tactical=>{const t=messages.filter(m=>m.type==='tactical').at(-1);if(!t||t.type!=='tactical')throw new Error('no tactical');return t;};

it('worker detune/tune/setBuoyFault update tactical picture and free RF',()=>{
  const {messages,send}=setup();
  expect(lastTac(messages).buoys[0]).toMatchObject({channel:1,health:'ok',state:'live'});
  send({type:'setBuoyFault',buoyId:1,fault:true});
  expect(lastTac(messages).buoys[0].health).toBe('fault');
  send({type:'detuneBuoy',buoyId:1});
  expect(lastTac(messages).buoys[0]).toMatchObject({channel:0,health:'fault',state:'live'});
  send({type:'dropBuoy',id:2,channel:1,kind:'omni',x:1,y:1,hydrophoneDepthM:40});
  expect(lastTac(messages).buoys.map(b=>b.channel).sort()).toEqual([0,1]);
  send({type:'tuneBuoy',buoyId:1});
  expect(lastTac(messages).buoys.find(b=>b.id===1)!.channel).toBe(2);
  send({type:'setBuoyFault',buoyId:1,fault:false});
  expect(lastTac(messages).buoys.find(b=>b.id===1)).toMatchObject({health:'ok',channel:2});
});
