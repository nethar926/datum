import {createSurfacePool,surfaceCount} from '../catalog/surface.js';
import {deriveSeed,mulberry32} from '../prng.js';
import {clamp,knotsToMps} from '../units.js';
import {cpaScenario,loadScenario,type Scenario,type ScenarioInput} from '../scenario.js';
import {randomizeSelection,rarityWeights,rarityOrder,type RarityWeights} from '../catalog/randomize.js';
import {effectiveParams} from '../catalog/schema.js';
import {cavitationInceptionKn} from '../catalog/derive.js';
export type Difficulty='easy'|'regular'|'difficult';
/** v1.1 plain operator-editable data, not a hidden difficulty switch. surfaceTraffic controls a seeded ship prefix and ambient shipping. */
export interface ScenarioParams {subCount:number;rarityWeights:RarityWeights;opState:{speedKn:[number,number];depthM:[number,number];quietProb:number;cavitationAllowed:boolean};seaState:number;surfaceTraffic:number;cpaRangeKm:[number,number];buoyLifeMin:number;seed:number}
const safe=(x:unknown,fallback:number,lo:number,hi:number):number=>typeof x==='number'&&Number.isFinite(x)?clamp(x,lo,hi):fallback;
function range(x:unknown,fallback:[number,number],lo:number,hi:number):[number,number]{const a=Array.isArray(x)?x:[];const l=safe(a[0],fallback[0],lo,hi),h=safe(a[1],fallback[1],lo,hi);return l<=h?[l,h]:[h,l];}
export function clampParams(value:unknown):ScenarioParams {
 const p=(value&&typeof value==='object'?value:{}) as Partial<ScenarioParams>,o=p.opState;
 const weights={...rarityWeights};for(const k of rarityOrder)weights[k]=safe(p.rarityWeights?.[k],rarityWeights[k],0,10000);if(!rarityOrder.some(k=>weights[k]>0))Object.assign(weights,rarityWeights);
 return {subCount:Math.round(safe(p.subCount,1,1,250)),rarityWeights:weights,opState:{speedKn:range(o?.speedKn,[6,18],0,45),depthM:range(o?.depthM,[20,100],0,1000),quietProb:safe(o?.quietProb,.35,0,1),cavitationAllowed:typeof o?.cavitationAllowed==='boolean'?o.cavitationAllowed:true},seaState:Math.round(safe(p.seaState,3,0,6)),surfaceTraffic:safe(p.surfaceTraffic,.5,0,1),cpaRangeKm:range(p.cpaRangeKm,[1.5,3],.05,100),buoyLifeMin:safe(p.buoyLifeMin,240,1,1440),seed:Math.floor(safe(p.seed,42,0,4294967295))};
}
export function presetToParams(difficulty:Difficulty,seed:number):ScenarioParams {
 if(!['easy','regular','difficult'].includes(difficulty))throw new Error('Unknown difficulty');seed=clampParams({seed}).seed;
 const rng=mulberry32(deriveSeed(seed,'difficulty-preset')),u=rng(),v=rng(),life=rng();const weights={...rarityWeights};
 if(difficulty==='easy')Object.assign(weights,{dieselDirect:.5,dieselGearReduction:8,dieselElectric:60,aip:.1,nuclearGearReduction:60,nuclearElectric:.1});
 if(difficulty==='difficult'){weights.dieselDirect*=3;weights.aip*=3;weights.nuclearElectric*=3;}
 return clampParams({seed,subCount:difficulty==='easy'?1:1+Math.floor(u*(difficulty==='regular'?2:3)),rarityWeights:weights,opState:difficulty==='easy'?{speedKn:[14,24],depthM:[0,12],quietProb:.05,cavitationAllowed:true}:difficulty==='regular'?{speedKn:[6,18],depthM:[20,100],quietProb:.35,cavitationAllowed:true}:{speedKn:[2,7],depthM:[120,300],quietProb:.9,cavitationAllowed:false},seaState:difficulty==='easy'?1+Math.floor(v*2):difficulty==='regular'?3:4+Math.floor(v*2),surfaceTraffic:difficulty==='easy'?.2:difficulty==='regular'?.5:.9,cpaRangeKm:difficulty==='easy'?[.3,1.2]:difficulty==='regular'?[1.5,3]:[4,8],buoyLifeMin:difficulty==='easy'?480:difficulty==='regular'?240:60+60*life});
}
/** Seeded catalog identity and operational state only; never mutates catalog class parameters. */
export function generateScenario(params:ScenarioParams,seed=params.seed):Scenario {
 const p=clampParams({...params,seed}),s:ScenarioInput={...cpaScenario(),seed:p.seed,contacts:[]},select=mulberry32(deriveSeed(p.seed,'catalog-selection'));
 s.fMax=s.fmax;s.fBin=s.fmax/(s.bins-1);s.band=[0,s.fmax];s.surfaceTraffic=p.surfaceTraffic;
 s.environment.shippingDensity=p.surfaceTraffic;s.environment.seaState=p.seaState;s.environment.shipping=p.surfaceTraffic<.33?'light':p.surfaceTraffic<.67?'moderate':'heavy';s.buoys[0].life=p.buoyLifeMin*60;
 for(let i=0;i<p.subCount;i++){const draw=randomizeSelection(select,p.rarityWeights),c=effectiveParams(draw.klass,draw.variantId),rng=mulberry32(deriveSeed(p.seed,`op-state:${i}`));
  const quiet=rng()<p.opState.quietProb;let speed=p.opState.speedKn[0]+rng()*(p.opState.speedKn[1]-p.opState.speedKn[0]);const depth=clamp(p.opState.depthM[0]+rng()*(p.opState.depthM[1]-p.opState.depthM[0]),c.depthM[0],c.depthM[1]);
  speed=Math.min(speed,c.maxSpeedKn);if(quiet)speed=Math.min(speed,c.quietSpeedKn);if(!p.opState.cavitationAllowed)speed=Math.min(speed,.95*cavitationInceptionKn(c,depth));
  const mode=quiet&&draw.operatingState.mode!=='aip'?'quiet':draw.operatingState.mode,course=rng()*2*Math.PI,cpa=1000*(p.cpaRangeKm[0]+rng()*(p.cpaRangeKm[1]-p.cpaRangeKm[0])),v=knotsToMps(speed);
  s.contacts.push({id:`fictional-${i+1}`,category:'subsurface',classificationTarget:true,catalogRef:{classId:draw.classId,variantId:draw.variantId,hullId:draw.hullId},operatingMode:mode,x:-600*v*Math.sin(course)+cpa*Math.cos(course),y:-600*v*Math.cos(course)-cpa*Math.sin(course),depth,course,speed:v,motion:[{at:0,course,speed:v,depth}]});
 }s.classificationTargets=s.contacts.map(c=>c.id);s.surfacePool=createSurfacePool(p.seed,Math.min(18,250-s.contacts.length));const n=surfaceCount(p.surfaceTraffic,s.surfacePool.length);for(let i=0;i<n;i++){s.surfacePool[i].active=true;s.contacts.push(s.surfacePool[i]);}return loadScenario(s);
}
