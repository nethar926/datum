import {attachWaterColumn,buildWaterColumn} from '../waterColumn.js';
import {commandSpeedWindowKn} from '../catalog/plantModel.js';
import {chooseOperatingState} from '../catalog/operations.js';
import {createSurfacePool,surfaceCount} from '../catalog/surface.js';
import {deriveSeed,mulberry32} from '../prng.js';
import {clamp,knotsToMps,mpsToKnots} from '../units.js';
import {cpaScenario,loadScenario,type Scenario,type ScenarioInput,type ContactTransient} from '../scenario.js';
import {randomizeSelection,rarityWeights,rarityOrder,scenarioPoolWeights,type RarityWeights} from '../catalog/randomize.js';
import {effectiveParams} from '../catalog/schema.js';
import {cavitationInceptionKn} from '../catalog/derive.js';
import {planBehaviour,pickSubBehaviour,maneuverTransients,subBehaviourWeights,SUB_BEHAVIOURS,BEHAVIOUR_HORIZON_S,type SubBehaviour,type BehaviourLimits} from '../behaviours.js';
import type {SubmarineClass,ClassParams,OperatingState} from '../catalog/schema.js';
import {placeContactSpawn,spawnLevelDb} from '../spawnGeometry.js';
import {deriveSignature} from '../catalog/derive.js';
export type Difficulty='easy'|'regular'|'difficult';
/** v1.1 plain operator-editable data, not a hidden difficulty switch. surfaceTraffic controls a seeded ship prefix and ambient shipping. */
export interface ScenarioParams {reactorOffline?:boolean;subCount:number;rarityWeights:RarityWeights;opState:{speedKn:[number,number];depthM:[number,number];quietProb:number;cavitationAllowed:boolean;/** Explicit training mixture: chance a diesel uses a shallow machinery encounter instead of the patrol depth range. Omitted = use patrol depth range subject to class limits. */shallowDieselProb?:number;/** Hard depth envelope every procedural placement must respect (shallow encounters included). Omitted = depthM, so a custom depth range can never be overridden. */allowedDepthM?:[number,number]};seaState:number;surfaceTraffic:number;cpaRangeKm:[number,number];buoyLifeMin:number;seed:number;/** m3-events: optional sub behaviour pick weights (defaults subBehaviourWeights). */behaviourWeights?:Record<SubBehaviour,number>}
const safe=(x:unknown,fallback:number,lo:number,hi:number):number=>typeof x==='number'&&Number.isFinite(x)?clamp(x,lo,hi):fallback;
function range(x:unknown,fallback:[number,number],lo:number,hi:number):[number,number]{const a=Array.isArray(x)?x:[];const l=safe(a[0],fallback[0],lo,hi),h=safe(a[1],fallback[1],lo,hi);return l<=h?[l,h]:[h,l];}
function clampBehaviourWeights(w:Partial<Record<SubBehaviour,number>>):Record<SubBehaviour,number>{const out={...subBehaviourWeights};for(const k of SUB_BEHAVIOURS)out[k]=safe(w[k],subBehaviourWeights[k],0,10000);if(!SUB_BEHAVIOURS.some(k=>out[k]>0))Object.assign(out,subBehaviourWeights);return out;}
/** Envelope for a generated sub's behaviour legs: class/mode speed caps, the scenario opState band
 * (difficulty stays meaningful), quiet draw, cavitation ban and mode-legal depths (SURF pinned at 0,
 * SNORK held at its start depth, AIP strictly submerged). Every leg must pass validateOperatingState. */
export function subBehaviourLimits(klass:SubmarineClass,c:ClassParams,op:OperatingState,p:ScenarioParams,quiet:boolean):BehaviourLimits{
 const mode=op.mode,depth=op.depthM,surfaced=depth===0,cap=mode==='SURF'||surfaced?klass.maxSpeedKts.surfaced:mode==='SNORK'?klass.maxSpeedKts.snorkel:mode==='BATT'?klass.maxSpeedKts.battery:mode==='AIP'?Math.min(klass.maxSpeedKts.battery,klass.aip?.maxSpeedKts??0):klass.maxSpeedKts.submerged;
 const band:[number,number]=mode==='SURF'||mode==='SNORK'||surfaced?[depth,depth]:[Math.max(c.depthM[0],Math.min(depth,Math.max(p.opState.depthM[0],10))),Math.min(c.depthM[1],Math.max(depth,p.opState.depthM[1]))];
 let max=Math.min(c.maxSpeedKn,Math.max(cap,op.speedKn),Math.max(p.opState.speedKn[1],op.speedKn));if(mode==='AIP')max=Math.min(max,klass.aip!.maxSpeedKts);if(quiet)max=Math.min(max,Math.max(klass.quietSpeedKts[1],op.speedKn));if(!p.opState.cavitationAllowed)max=Math.min(max,Math.max(op.speedKn,.95*cavitationInceptionKn(c,band[0])));
 return {maxSpeedKn:Math.max(op.speedKn,max),quietSpeedKn:Math.min(Math.max(op.speedKn,max),klass.quietSpeedKts[1]),minSpeedKn:Math.min(1,klass.quietSpeedKts[0]),depthM:band};
}
export function clampParams(value:unknown):ScenarioParams {
 const p=(value&&typeof value==='object'?value:{}) as Partial<ScenarioParams>,o=p.opState;
 const weights={...rarityWeights};for(const k of rarityOrder)weights[k]=safe(p.rarityWeights?.[k],rarityWeights[k],0,10000);Object.assign(weights,scenarioPoolWeights(weights));
 return {reactorOffline:p.reactorOffline===true,subCount:Math.round(safe(p.subCount,1,1,250)),rarityWeights:weights,opState:{speedKn:range(o?.speedKn,[6,18],0,45),depthM:range(o?.depthM,[20,100],0,1000),quietProb:safe(o?.quietProb,.35,0,1),cavitationAllowed:typeof o?.cavitationAllowed==='boolean'?o.cavitationAllowed:true,...(o?.shallowDieselProb!==undefined?{shallowDieselProb:safe(o.shallowDieselProb,0,0,1)}:{}),...(o?.allowedDepthM!==undefined?{allowedDepthM:range(o.allowedDepthM,[0,1000],0,1000)}:{})},seaState:Math.round(safe(p.seaState,3,0,6)),surfaceTraffic:safe(p.surfaceTraffic,.5,0,1),cpaRangeKm:range(p.cpaRangeKm,[1.5,3],.05,100),buoyLifeMin:safe(p.buoyLifeMin,240,1,1440),seed:Math.floor(safe(p.seed,42,0,4294967295)),...(p.behaviourWeights&&typeof p.behaviourWeights==='object'?{behaviourWeights:clampBehaviourWeights(p.behaviourWeights)}:{})};
}
export function presetToParams(difficulty:Difficulty,seed:number):ScenarioParams {
 if(!['easy','regular','difficult'].includes(difficulty))throw new Error('Unknown difficulty');seed=clampParams({seed}).seed;
 const rng=mulberry32(deriveSeed(seed,'difficulty-preset')),u=rng(),v=rng(),life=rng();const weights={...rarityWeights};
 if(difficulty==='easy')Object.assign(weights,{dieselDirect:.5,dieselGearReduction:8,dieselElectric:60,aip:.1,nuclearGearReduction:60,nuclearElectric:.1});
 if(difficulty==='difficult'){weights.dieselDirect*=3;weights.aip*=3;weights.nuclearElectric*=3;}
 return clampParams({seed,subCount:difficulty==='easy'?1:1+Math.floor(u*(difficulty==='regular'?2:3)),rarityWeights:weights,opState:difficulty==='easy'?{speedKn:[14,24],depthM:[0,12],quietProb:.05,cavitationAllowed:true}:difficulty==='regular'?{speedKn:[6,18],depthM:[20,100],quietProb:.35,cavitationAllowed:true,shallowDieselProb:.35,allowedDepthM:[0,100]}:{speedKn:[2,7],depthM:[120,300],quietProb:.9,cavitationAllowed:false,shallowDieselProb:.2,allowedDepthM:[0,300]},seaState:difficulty==='easy'?1+Math.floor(v*2):difficulty==='regular'?3:4+Math.floor(v*2),surfaceTraffic:difficulty==='easy'?.2:difficulty==='regular'?.5:.9,cpaRangeKm:difficulty==='easy'?[.3,1.2]:difficulty==='regular'?[1.5,3]:[4,8],buoyLifeMin:difficulty==='easy'?480:difficulty==='regular'?240:60+60*life});
}
/** Seeded catalog identity and operational state only; never mutates catalog class parameters. */
export function generateScenario(params:ScenarioParams,seed=params.seed):Scenario {
 const p=clampParams({...params,seed}),s:ScenarioInput={...cpaScenario(),seed:p.seed,contacts:[]},select=mulberry32(deriveSeed(p.seed,'catalog-selection'));
 s.reactorOffline=p.reactorOffline;s.fMax=s.fmax;s.fBin=s.fmax/(s.bins-1);s.band=[0,s.fmax];s.surfaceTraffic=p.surfaceTraffic;
 s.environment.shippingDensity=p.surfaceTraffic;s.environment.seaState=p.seaState;s.environment.shipping=p.surfaceTraffic<.33?'light':p.surfaceTraffic<.67?'moderate':'heavy';s.buoys[0].life=p.buoyLifeMin*60;
 const surfT=12+((p.seed>>>3)%10),sal=34+((p.seed>>>7)%3)*.5;s.environment.temperatureC=surfT;s.environment.salinityPsu=sal;
 s.waterColumn=attachWaterColumn(s.environment,buildWaterColumn({surfaceTempC:surfT,deepTempC:surfT-6-((p.seed>>>5)%5),salinityPsu:sal,maxDepthM:Math.max(300,p.opState.depthM[1]*1.5)}));
 for(let i=0;i<p.subCount;i++){const draw=randomizeSelection(select,p.rarityWeights),c=effectiveParams(draw.klass,draw.variantId),rng=mulberry32(deriveSeed(p.seed,`op-state:${i}`));
  const quiet=rng()<p.opState.quietProb;let speed=p.opState.speedKn[0]+rng()*(p.opState.speedKn[1]-p.opState.speedKn[0]);let depth=clamp(p.opState.depthM[0]+rng()*(p.opState.depthM[1]-p.opState.depthM[0]),c.depthM[0],c.depthM[1]);
  // Explicit preset mixture only; independent seed preserves catalog/traffic/behaviour draws.
  // Modes still go through chooseOperatingState (engine-off remains valid at shallow depths).
  const machineryRng=mulberry32(deriveSeed(p.seed,`shallow-machinery:${i}`));
  if(draw.klass.plant==='diesel'&&machineryRng()<(p.opState.shallowDieselProb??0)){
   // Hard envelope: requested constraint (allowedDepthM, else depthM) always wins over the mixture.
   const env=p.opState.allowedDepthM??p.opState.depthM,lo=Math.max(env[0],c.depthM[0]),snorkMax=Math.min(draw.klass.snorkelDepthM,c.depthM[1],env[1]);
   const shallowSpeed=Math.min(speed,c.maxSpeedKn,quiet?c.quietSpeedKn:Infinity,p.opState.cavitationAllowed?Infinity:.95*cavitationInceptionKn(c,0));
   const surfWindow=commandSpeedWindowKn(draw.klass,'SURF'),surfAllowed=!surfWindow||shallowSpeed>=surfWindow.min*(1+1e-6);
   if(snorkMax>0&&lo<=snorkMax){const surf=machineryRng()<.25&&surfAllowed&&env[0]<=0,lo1=Math.max(lo,1);depth=surf?0:lo1>snorkMax?snorkMax:lo1+machineryRng()*(snorkMax-lo1);}
  }
  speed=Math.min(speed,c.maxSpeedKn);if(quiet)speed=Math.min(speed,c.quietSpeedKn);if(!p.opState.cavitationAllowed)speed=Math.min(speed,.95*cavitationInceptionKn(c,depth));
  const op=chooseOperatingState(draw.klass,speed,depth,quiet,mulberry32(deriveSeed(p.seed,`static-mode:${i}`)),p.reactorOffline===true);speed=op.speedKn;const mode=op.mode,v=knotsToMps(speed);
  const brng=mulberry32(deriveSeed(p.seed,`behaviour:${i}`)),behaviour=pickSubBehaviour(brng,p.behaviourWeights??subBehaviourWeights),limits=subBehaviourLimits(draw.klass,c,op,p,quiet);
  const course0=brng()*2*Math.PI;
  // Legs hold geometry for the first 600 s, then diverge. Spawn placement overwrites leg 0 course/pos.
  const motion=planBehaviour({kind:behaviour,seed:Math.floor(brng()*4294967296),durationS:BEHAVIOUR_HORIZON_S,holdS:600,start:{course:course0,speed:v,depth},limits}),transients:ContactTransient[]=maneuverTransients(motion,{},brng);
  // Lead: tactics for unflagged coupled plants stay inside the exposed coupled window (no rejected commands).
  const cw=commandSpeedWindowKn(draw.klass,mode);if(cw)for(const leg of motion){const k=mpsToKnots(leg.speed);leg.speed=knotsToMps(Math.min(cw.max*(1-1e-6),Math.max(cw.min*(1+1e-6),k)));}
  // Fictional diesel teaching: after CPA hold, a small ratio-locked engine-slowdown knee on SNORK/SURF.
  if(draw.klass.plant==='diesel'&&(mode==='SNORK'||mode==='SURF')){const kneeAt=720+Math.floor(brng()*180),toScale=.82+.06*brng();transients.push({at:kneeAt,kind:'engine-ramp',params:{durationS:35+Math.floor(brng()*25),fromScale:1,toScale:Number(toScale.toFixed(3))}});}
  // Wilson spawn: sometimes beside the buoy, sometimes outside — fade-in ≤ 180 s via SNR/TL.
  const sig=deriveSignature(draw.klass,draw.variantId,{speedKn:speed,depthM:depth,mode,reactorOffline:p.reactorOffline===true&&draw.klass.plant==='nuclear'&&draw.klass.aipCapable});
  const levelDb=spawnLevelDb(sig,v,depth);
  // Spawn SNR uses seaState + fixed moderate shipping so surfaceTraffic does not perturb sub draws.
  const spawnEnv={seaState:s.environment.seaState,shipping:'moderate' as const,shippingDensity:.5,soundSpeed:s.environment.soundSpeed,spreading:s.environment.spreading,transition:s.environment.transition};
  const place=placeContactSpawn({seed:p.seed,contactId:`fictional-${i+1}`,speed:v,depth,levelDb,env:spawnEnv,buoy:s.buoys[0],inside:rng()<.35});
  // Re-seed behaviour start course/speed from placement; keep planned legs but rewrite leg 0.
  if(motion[0]){motion[0]={...motion[0],course:place.course,speed:place.speed,depth:place.depth};}
  s.contacts.push({id:`fictional-${i+1}`,category:'subsurface',classificationTarget:true,behaviour,catalogRef:{classId:draw.classId,variantId:draw.variantId,hullId:draw.hullId},operatingMode:mode,reactorOffline:p.reactorOffline===true&&draw.klass.plant==='nuclear'&&draw.klass.aipCapable,x:place.x,y:place.y,depth:place.depth,course:place.course,speed:place.speed,motion,...(transients.length?{transients}:{})});
 }s.classificationTargets=s.contacts.map(c=>c.id);s.surfacePool=createSurfacePool(p.seed,Math.min(18,250-s.contacts.length));const n=surfaceCount(p.surfaceTraffic,s.surfacePool.length);for(let i=0;i<n;i++){s.surfacePool[i].active=true;s.contacts.push(s.surfacePool[i]);}return loadScenario(s);
}
