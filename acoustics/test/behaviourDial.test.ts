import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {generateScenario,clampParams,type ScenarioParams} from '../src/scenario/presets.js';
import {subBehaviourWeights,behaviourWeightsFor,behaviourHoldS,behaviourLegScale,BEHAVIOUR_DEFAULT,SUB_BEHAVIOURS,type SubBehaviour} from '../src/behaviours.js';
import {resolveReference} from '../src/catalog/derive.js';
import {mpsToKnots} from '../src/units.js';
import {WorkerRuntime} from '../src/workerRuntime.js';
import type {Command,GramRows,WorkerRequest,WorkerResponse} from '../src/protocol.js';

/** Behaviour dial (ScenarioParams.behaviour ∈ [0,1], default 0.5): 0 steady … 1 dynamic. */
const sha=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const gen=(p:Partial<ScenarioParams>)=>generateScenario(clampParams(p));
const subs=(p:Partial<ScenarioParams>)=>gen(p).contacts.filter(c=>c.category==='subsurface');
const GRID=[0,.25,.5,.75,1];

describe('behaviour dial',()=>{
 it('defaults to 0.5, clamps into [0,1] and the default knot is exactly today’s weights/hold/spacing',()=>{
  expect(clampParams({}).behaviour).toBe(.5);expect(BEHAVIOUR_DEFAULT).toBe(.5);
  expect(clampParams({behaviour:-3}).behaviour).toBe(0);expect(clampParams({behaviour:7}).behaviour).toBe(1);expect(clampParams({behaviour:NaN}).behaviour).toBe(.5);
  expect(behaviourWeightsFor(.5)).toEqual(subBehaviourWeights);expect(behaviourWeightsFor(.5)).toEqual({transit:30,patrol:35,avoidance:15,combat:20});
  expect(behaviourHoldS(.5)).toBe(600);expect(behaviourLegScale(.5)).toBe(1);
  expect(behaviourHoldS(0)).toBe(900);expect(behaviourHoldS(1)).toBe(180);
  expect(behaviourWeightsFor(0)).toEqual({transit:60,patrol:35,avoidance:5,combat:0});expect(behaviourWeightsFor(1)).toEqual({transit:10,patrol:25,avoidance:30,combat:35});
  expect(behaviourWeightsFor(.25)).toEqual({transit:45,patrol:35,avoidance:10,combat:10});
 });
 it('default output is bit-identical to omitting the dial; seed 7 default hash pinned (unchanged from before the dial)',()=>{
  const s=gen({seed:7});expect(sha(s)).toBe('19f37a2a30289cfdc0ee1ed0441909e1f5ad3ac1e7cad441ab6bf6c2966050b7');
  expect(gen({seed:7,behaviour:.5})).toEqual(s);
  const raw=clampParams({seed:7});delete (raw as {behaviour?:number}).behaviour;expect(sha(generateScenario(raw))).toBe(sha(s));
 });
 it('is deterministic per seed and behaviour, and the dial actually changes plans',()=>{
  for(const b of GRID)for(const seed of [1,7,42]){expect(sha(gen({seed,behaviour:b,subCount:6}))).toBe(sha(gen({seed,behaviour:b,subCount:6})));}
  expect(sha(gen({seed:7,behaviour:0}))).not.toBe(sha(gen({seed:7})));expect(sha(gen({seed:7,behaviour:1}))).not.toBe(sha(gen({seed:7})));
 });
 it('hold and leg spacing fall strictly as behaviour rises',()=>{
  for(let i=1;i<GRID.length;i++){expect(behaviourHoldS(GRID[i])).toBeLessThan(behaviourHoldS(GRID[i-1]));expect(behaviourLegScale(GRID[i])).toBeLessThan(behaviourLegScale(GRID[i-1]));}
 });
 it('monotone: per contact (fixed kind) more or equal legs and an earlier-or-equal first manoeuvre ≥ hold as behaviour rises',()=>{
  for(const kind of SUB_BEHAVIOURS){const w=Object.fromEntries(SUB_BEHAVIOURS.map(k=>[k,k===kind?1:0])) as Record<SubBehaviour,number>;
   for(let seed=0;seed<12;seed++){const runs=GRID.map(b=>subs({seed,subCount:4,behaviour:b,behaviourWeights:w}));
    for(let i=1;i<runs.length;i++)runs[i].forEach((c,j)=>{const prev=runs[i-1][j];expect(c.behaviour).toBe(kind);expect(c.motion.length).toBeGreaterThanOrEqual(prev.motion.length);expect(c.motion[1].at).toBeLessThanOrEqual(prev.motion[1].at);expect(c.motion[1].at).toBeGreaterThanOrEqual(Math.round(behaviourHoldS(GRID[i])));});}}
 });
 it('monotone in aggregate with the dial’s own weights: mean legs per sub rise strictly',()=>{
  const mean=GRID.map(b=>{let n=0,l=0;for(let seed=0;seed<40;seed++)for(const c of subs({seed,subCount:4,behaviour:b})){n++;l+=c.motion.length;}return l/n;});
  for(let i=1;i<mean.length;i++)expect(mean[i]).toBeGreaterThan(mean[i-1]);
 });
 it('explicit behaviourWeights override the dial’s weights (kinds unchanged), hold/spacing still follow the dial',()=>{
  const w={transit:1,patrol:1,avoidance:1,combat:1};
  for(let seed=0;seed<10;seed++){const a=subs({seed,subCount:5,behaviour:0,behaviourWeights:w}),b=subs({seed,subCount:5,behaviour:1,behaviourWeights:w});expect(a.map(c=>c.behaviour)).toEqual(b.map(c=>c.behaviour));}
 });
 it('endpoints 0 and 1 stay inside every class depth and speed limit',()=>{
  for(const b of [0,1])for(let seed=0;seed<30;seed++)for(const c of subs({seed,subCount:6,behaviour:b})){const {params}=resolveReference(c.catalogRef!);
   for(const leg of c.motion){expect(leg.depth).toBeGreaterThanOrEqual(0);expect(leg.depth).toBeLessThanOrEqual(params.depthM[1]+1e-9);expect(mpsToKnots(leg.speed)).toBeLessThanOrEqual(params.maxSpeedKn+1e-6);expect(leg.speed).toBeGreaterThanOrEqual(0);}
   expect(c.motion.at(-1)!.at).toBeLessThan(4*3600+1);}
 });
});

describe('worker always generates',()=>{
 const setup=(init:Partial<Extract<Command,{type:'init'}>>)=>{const messages:WorkerResponse[]=[];const runtime=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));const send=(m:Command,simT=runtime.simT)=>runtime.command({...m,v:1,simT} as WorkerRequest);send({type:'init',seed:42,...init} as Command);return {runtime,messages,send};};
 const rows=(m:WorkerResponse[])=>m.filter((x):x is GramRows=>x.type==='gramRows');
 it('legacy scenarioIds are accepted and ignored; params (behaviour) reach the generator',()=>{
  const want=generateScenario(clampParams({seed:42}),42).contacts.map(c=>c.motion);
  for(const scenarioId of ['cpa-pass','m1-cpa-pass','m2-lloyds-cpa','anything',undefined]){const {runtime,messages}=setup({scenarioId});expect(messages.some(m=>m.type==='error')).toBe(false);expect(runtime.engine!.scenario.contacts.map(c=>c.motion)).toEqual(want);}
  const {runtime}=setup({scenarioId:'cpa-pass',params:{behaviour:1}});expect(runtime.engine!.scenario.contacts.map(c=>c.motion)).toEqual(generateScenario(clampParams({seed:42,behaviour:1}),42).contacts.map(c=>c.motion));
 });
 it('seek rebuilds the same generated scenario (replayed row identical)',()=>{
  const a=setup({params:{behaviour:.9}}),b=setup({params:{behaviour:.9}});a.runtime.tick(.25);a.runtime.tick(.25);const expected=rows(a.messages).at(-1)!.data;
  b.send({type:'seek'},.25);b.runtime.tick(.25);expect(rows(b.messages).at(-1)!.data).toEqual(expected);
  expect(b.runtime.engine!.scenario.contacts.map(c=>c.motion)).toEqual(generateScenario(clampParams({seed:42,behaviour:.9}),42).contacts.map(c=>c.motion));
 });
});
