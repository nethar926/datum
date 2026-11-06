import {describe,it,expect} from 'vitest';
import {planBehaviour,checkBehaviourLegs,maneuverTransients,pickSubBehaviour,SUB_BEHAVIOURS,SURFACE_BEHAVIOURS,BEHAVIOUR_KINDS,BEHAVIOUR_HORIZON_S,generateScenario,presetToParams,createSurfacePool,AcousticEngine,cpaScenario,loadScenario,validateScenario,catalog,knotsToMps,mpsToKnots,mulberry32,HYDP_START_OFFSET_PCT,type BehaviourKind,type BehaviourLimits,type MotionLeg,type ScenarioInput} from '../src/index.js';
const DEG=Math.PI/180,H=BEHAVIOUR_HORIZON_S;
const subLimits:BehaviourLimits={maxSpeedKn:24,quietSpeedKn:7,minSpeedKn:1,depthM:[40,300]};
const shipLimits:BehaviourLimits={maxSpeedKn:16,quietSpeedKn:4.5,minSpeedKn:.5,depthM:[5,5]};
const plan=(kind:BehaviourKind,seed=7,limits=SUB_BEHAVIOURS.includes(kind as never)?subLimits:shipLimits,holdS=0)=>planBehaviour({kind,seed,durationS:H,holdS,start:{course:1,speed:knotsToMps(SUB_BEHAVIOURS.includes(kind as never)?8:limits===shipLimits&&kind==='fishing'?3.5:12),depth:limits.depthM[0]===limits.depthM[1]?limits.depthM[0]:120},limits});
const turn=(a:MotionLeg,b:MotionLeg)=>Math.abs(((b.course-a.course)%(2*Math.PI)+3*Math.PI)%(2*Math.PI)-Math.PI)/DEG;
const turns=(l:MotionLeg[])=>l.slice(1).map((b,i)=>turn(l[i],b));
const gaps=(l:MotionLeg[])=>l.slice(1).map((b,i)=>b.at-l[i].at);
const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/Math.max(1,x.length);
const knots=(l:MotionLeg[])=>l.map(x=>mpsToKnots(x.speed));
describe('behaviour planner',()=>{
 it('is deterministic per seed and kind, legs validate and every kind manoeuvres over the horizon',()=>{
  for(const kind of BEHAVIOUR_KINDS)for(let seed=0;seed<40;seed++){const a=plan(kind,seed),limits=SUB_BEHAVIOURS.includes(kind as never)?subLimits:shipLimits;
   expect(a).toEqual(plan(kind,seed));expect(a.length).toBeGreaterThanOrEqual(2);checkBehaviourLegs(a,limits,H);expect(a.every(l=>Number.isInteger(l.at)&&l.course>=0&&l.course<2*Math.PI)).toBe(true);
   expect(JSON.parse(JSON.stringify(a))).toEqual(a);}
  expect(plan('combat',1)).not.toEqual(plan('combat',2));expect(plan('patrol',3)).not.toEqual(plan('transit',3));
  expect(()=>planBehaviour({kind:'zigzag' as never,seed:1,durationS:H,start:{course:0,speed:1,depth:5},limits:shipLimits})).toThrow(/Unknown behaviour/);
 });
 it('holdS defers the first manoeuvre and pinned depth bands never change depth',()=>{
  for(const kind of BEHAVIOUR_KINDS)for(let seed=0;seed<20;seed++){const l=plan(kind,seed,undefined,600);expect(l[1].at).toBeGreaterThanOrEqual(600);}
  for(const kind of SUB_BEHAVIOURS)expect(new Set(planBehaviour({kind,seed:4,durationS:H,start:{course:0,speed:knotsToMps(5),depth:12},limits:{...subLimits,depthM:[12,12]}}).map(l=>l.depth))).toEqual(new Set([12]));
 });
 it('surface shipping is lane-like and fishing is slow, frequent-turn loitering',()=>{
  let shipGap=0,fishGap=0,shipKn=0,fishKn=0,shipTurns=0,fishTurns=0;
  for(let seed=0;seed<40;seed++){const s=plan('shipping',seed),f=plan('fishing',seed);shipGap+=mean(gaps(s));fishGap+=mean(gaps(f));shipKn+=mean(knots(s));fishKn+=mean(knots(f));shipTurns+=s.length;fishTurns+=f.length;
   expect(turns(s).every(t=>t<=40.001)).toBe(true);expect(Math.max(...knots(s))-Math.min(...knots(s))).toBeLessThanOrEqual(1.0001);expect(Math.max(...knots(f).slice(1))).toBeLessThanOrEqual(4.5+1e-9);}
  expect(shipGap).toBeGreaterThan(2*fishGap);expect(shipKn).toBeGreaterThan(2*fishKn);expect(fishTurns).toBeGreaterThan(2*shipTurns);
 });
 it('sub kinds have distinct invented shapes',()=>{
  let transitLegs=0,combatLegs=0;
  for(let seed=0;seed<40;seed++){
   const t=plan('transit',seed),p=plan('patrol',seed),a=plan('avoidance',seed),c=plan('combat',seed),ck=knots(c).slice(1);transitLegs+=t.length;combatLegs+=c.length;
   expect(turns(t).every(x=>x<=25.001)).toBe(true);
   expect(turns(p).every(x=>(x>=79.99&&x<=100.01)||x>=169.99)).toBe(true);
   expect(Math.max(...turns(a))).toBeGreaterThanOrEqual(70);expect(Math.abs(a[2].depth-a[1].depth)).toBeGreaterThan(0);expect(Math.min(...knots(a).slice(2))).toBeLessThanOrEqual(7+1e-9);
   expect(Math.max(...ck)).toBeGreaterThanOrEqual(.75*24*(1-1e-6));expect(Math.min(...ck)).toBeLessThanOrEqual(7+1e-9);ck.forEach((k,i)=>i%2===0?expect(k).toBeGreaterThanOrEqual(.75*24*(1-1e-6)):expect(k).toBeLessThanOrEqual(7+1e-9));
   expect(turns(c).every(x=>x>=29.99&&x<=70.01)).toBe(true);
  }
  expect(combatLegs).toBeGreaterThan(2*transitLegs);
  const counts=Object.fromEntries(SUB_BEHAVIOURS.map(k=>[k,0])) as Record<string,number>,rng=mulberry32(5);for(let i=0;i<4000;i++)counts[pickSubBehaviour(rng)]++;expect(counts.patrol).toBeGreaterThan(counts.transit);expect(counts.transit).toBeGreaterThan(counts.combat);expect(counts.combat).toBeGreaterThan(counts.avoidance);
 });
 it('manoeuvre transients trigger on turns ≥10° or depth changes ≥5 m only',()=>{
  const legs:MotionLeg[]=[{at:0,course:0,speed:4,depth:100},{at:60,course:5*DEG,speed:4,depth:100},{at:120,course:20*DEG,speed:4,depth:100},{at:200,course:20*DEG,speed:2,depth:130},{at:300,course:2*Math.PI-1*DEG,speed:2,depth:130}];
  expect(maneuverTransients(legs).map(t=>t.at)).toEqual([120,200,300]);expect(maneuverTransients(legs,{courseDeg:3,depthM:50}).map(t=>t.at)).toEqual([60,120,300]);
 });
});
describe('generation wiring',()=>{
 it('generated subs get seeded multi-leg behaviours that keep the CPA leg and validate',()=>{
  const seen=new Set<string>();let withHydp=0;
  for(let seed=0;seed<60;seed++)for(const d of ['easy','regular','difficult'] as const){const p=presetToParams(d,seed),s=generateScenario(p);expect(generateScenario(p)).toEqual(s);
   for(const c of s.contacts.filter(c=>c.category!=='surface')){seen.add(c.behaviour!);expect(SUB_BEHAVIOURS).toContain(c.behaviour);expect(c.motion.length).toBeGreaterThanOrEqual(2);expect(c.motion[0]).toEqual({at:0,course:c.course,speed:c.speed,depth:c.depth});expect(c.motion[1].at).toBeGreaterThanOrEqual(600);expect(c.motion.at(-1)!.at).toBeLessThan(H);
    if(d==='difficult')for(const l of c.motion)expect(l.depth).toBeGreaterThanOrEqual(Math.min(c.depth,120));
    if(c.transients?.length){withHydp++;expect(c.transients.every(t=>t.kind==='hydp'&&c.motion.some(l=>l.at===t.at))).toBe(true);}}
   expect(()=>loadScenario(JSON.parse(JSON.stringify(s)))).not.toThrow();}
  expect([...seen].sort()).toEqual([...SUB_BEHAVIOURS].sort());expect(withHydp).toBeGreaterThan(100);
 });
 it('HYDP fires in a generated scenario when a sub manoeuvres',()=>{
  const s=Array.from({length:40},(_,seed)=>generateScenario(presetToParams('regular',seed))).find(s=>s.contacts.some(c=>c.transients?.length))!,e=new AcousticEngine(s),c=e.scenario.contacts.find(c=>c.transients?.length)!,at=c.transients![0].at,lines=c.params.tonals!.filter(l=>l.lineFamily==='HYDP');
  expect(lines).toHaveLength(2);e.advance(at-1);expect(lines[0].power).toBe(0);e.advance(3);expect(lines[0].power).toBeGreaterThan(0);expect(lines[0].hz).toBeGreaterThan(c.params.plantSpec!.hydp!.nominalHz);
 });
 it('behaviour weights are editable params and a single-kind weight forces that kind',()=>{
  const p=presetToParams('regular',9);p.subCount=3;p.behaviourWeights={transit:0,patrol:0,avoidance:0,combat:1};const s=generateScenario(p);expect(s.contacts.filter(c=>c.category!=='surface').every(c=>c.behaviour==='combat')).toBe(true);
  expect(generateScenario({...p,behaviourWeights:{transit:NaN,patrol:-1,avoidance:0,combat:0} as never}).contacts.length).toBeGreaterThan(0);
 });
 it('surface pool mixes shipping and fishing and fishing ships run slow',()=>{
  const counts={shipping:0,fishing:0};for(let seed=0;seed<30;seed++)for(const c of createSurfacePool(seed)){counts[c.behaviour as 'shipping'|'fishing']++;expect(SURFACE_BEHAVIOURS).toContain(c.behaviour);expect(c.motion.length).toBeGreaterThanOrEqual(2);if(c.behaviour==='fishing')expect(mpsToKnots(c.speed)).toBeLessThanOrEqual(4.5+1e-9);expect(c.motion.every(l=>l.depth===c.depth)).toBe(true);}
  expect(counts.fishing).toBeGreaterThan(30);expect(counts.shipping).toBeGreaterThan(counts.fishing);
 });
 it('engine follows legs and refreshes ship signatures when a leg changes speed',()=>{
  const s=generateScenario({...presetToParams('regular',12),surfaceTraffic:1}),e=new AcousticEngine(s),ship=e.scenario.surfacePool!.find(c=>c.motion.some((l,i)=>i>0&&Math.abs(l.speed-c.motion[i-1].speed)>.2))!;expect(ship).toBeTruthy();
  const i=ship.motion.findIndex((l,i)=>i>0&&Math.abs(l.speed-ship.motion[i-1].speed)>.2),before=ship.params.shaftHz;e.advance(ship.motion[i].at+1);expect(ship.speed).toBe(ship.motion[i].speed);expect(ship.course).toBe(ship.motion[i].course);expect(ship.params.shaftHz).not.toBeCloseTo(before,6);
  expect(e.tactical().truth!.contacts.find(c=>c.sourceId===ship.id)!.behaviour).toBe(ship.behaviour);
 });
});
describe('HYDP manoeuvre transient',()=>{
 const klass=catalog.classes.find(c=>c.hydp?.nominalHz===367.77)!,h=klass.hydp!;
 const scenario=(transients:ScenarioInput['contacts'][number]['transients'])=>{const s:ScenarioInput=cpaScenario();const v=knotsToMps(4);s.buoys[0].depth=100;
  s.contacts=[{id:'hydp-demo',category:'subsurface',catalogRef:{classId:klass.id},operatingMode:'BATT',x:0,y:150,depth:100,course:0,speed:v,motion:[{at:0,course:0,speed:v,depth:100},{at:5,course:40*DEG,speed:v,depth:100}],...(transients?{transients}:{})}];return s;};
 const hydp=(e:AcousticEngine)=>e.scenario.contacts[0].params.tonals!.filter(l=>l.lineFamily==='HYDP');
 it('paired blip starts slightly high, curves down onto the class HYDP Hz, then goes silent',()=>{
  const e=new AcousticEngine(scenario(maneuverTransients(scenario(undefined).contacts[0].motion)));const [a,b]=hydp(e);expect(a&&b).toBeTruthy();expect(a.power).toBe(0);expect(b.power).toBe(0);
  e.advance(5.75);expect(a.power).toBeGreaterThan(0);expect(b.power).toBeGreaterThan(0);expect(a.hz).toBeGreaterThan(h.nominalHz*1.01);expect(a.hz).toBeLessThan(h.nominalHz*(1+HYDP_START_OFFSET_PCT/100));expect(b.hz/a.hz).toBeCloseTo((h.nominalHz+h.pairSpacingHz)/h.nominalHz,9);
  let last=a.hz;for(let t=0;t<h.durationS-1.25;t+=.25){e.advance(.25);expect(a.hz).toBeLessThan(last);last=a.hz;}expect(a.hz-h.nominalHz).toBeLessThan(.1*(h.nominalHz*HYDP_START_OFFSET_PCT/100));
  e.advance(2);expect(a.power).toBe(0);expect(a.hz).toBe(h.nominalHz);const truth=e.tactical().truth!.contacts[0].lines.filter(l=>l.lineFamily==='HYDP');expect(truth.map(l=>l.f0Hz)).toEqual([h.nominalHz,h.nominalHz+h.pairSpacingHz]);
 });
 it('shows on a RES gram during the blip only; untriggered contacts carry no HYDP slots',()=>{
  const run=(trans:boolean)=>{const e=new AcousticEngine(scenario(trans?[{at:5,kind:'hydp',params:{durationS:12}}]:undefined)),c=e.subscribe({channel:1,res:5,filter:'NB',vernierHz:370}),row=new Float32Array(c.bins),bin=Math.round((h.nominalHz-c.f0)/c.fBin);let peak=-Infinity,quiet=-Infinity;
   for(let k=0;k<200&&e.time<30;k++){e.advance(.25);while(e.writeRow(c.streamId,row)>=0){const v=Math.max(...row.subarray(bin-3,bin+12));if(e.time>7&&e.time<16)peak=Math.max(peak,v);if(e.time>20)quiet=Math.max(quiet,v);}}return {peak,quiet,lines:hydp(e).length};};
  const on=run(true),off=run(false);expect(on.lines).toBe(2);expect(off.lines).toBe(0);expect(on.peak).toBeGreaterThan(on.quiet+3);expect(on.peak).toBeGreaterThan(off.peak+3);
 });
 it('validation accepts hydp transients and keeps other kinds reserved',()=>{
  expect(()=>validateScenario(scenario([{at:5,kind:'hydp',params:{durationS:8,startOffsetPct:2}}]))).not.toThrow();
  expect(()=>validateScenario(scenario([{at:5,kind:'torpedo',params:{}}]))).toThrow(/reserved/);
  expect(()=>validateScenario(scenario([{at:5,kind:'hydp',params:{durationS:0}}]))).toThrow();expect(()=>validateScenario(scenario([{at:5,kind:'hydp',params:{other:1}}]))).toThrow();
  try{loadScenario(scenario([{at:1,kind:'hydp',params:{}},{at:-1,kind:'hydp',params:{}}]));expect.unreachable();}catch(err){expect((err as {path:string}).path).toBe('$.contacts[0].transients[1]');}
  const bad=scenario(undefined);(bad.contacts[0] as {behaviour?:string}).behaviour='doctrine';expect(()=>validateScenario(bad)).toThrow(/behaviour/);
 });
});
