import {tonalRefDbFor} from '../tonalLevels.js';
import {surfaceVesselPlant} from './plants.js';
import {configurePropulsion,updatePropulsion,writePlantTonals} from './plantModel.js';
import {deriveSeed,mulberry32} from '../prng.js';
import {knotsToMps,clamp} from '../units.js';
import {type Signature} from '../sourceModel.js';
import type {Contact,ContactTransient,Scenario} from '../scenario.js';
import {displayName} from './derive.js';
import {planBehaviour,pickSurfaceBehaviour,BEHAVIOUR_HORIZON_S} from '../behaviours.js';

/** Fixed invented ship templates, not measured signatures. Offsets above a fictional 120 dB
 * reference sub: merchants/tankers loudest. Urick/Ross: shaft/blade/diesel/broadband; surface
 * platforms are not trying to hide so they sit well above typical submarine levels. */
const templates=[
 {id:'fishing-trawler',name:'Fictional Flaxfloat',shafts:[1,2],maxRpm:420,maxSpeedKn:12,offsetDb:12,kind:'fishing' as const},
 {id:'coastal-freighter',name:'Fictional Mossbarge',shafts:[1,2],maxRpm:380,maxSpeedKn:16,offsetDb:18,kind:'merchant' as const},
 {id:'ferry',name:'Fictional Prismhopper',shafts:[2,3],maxRpm:500,maxSpeedKn:24,offsetDb:20,kind:'ferry' as const},
 {id:'tug',name:'Fictional Tumblekeel',shafts:[1,3],maxRpm:450,maxSpeedKn:11,offsetDb:16,kind:'small' as const},
 {id:'bulk-carrier',name:'Fictional Thistlehaul',shafts:[1,2],maxRpm:360,maxSpeedKn:15,offsetDb:26,kind:'merchant' as const},
 {id:'tanker',name:'Fictional Opalhold',shafts:[1,2],maxRpm:400,maxSpeedKn:16,offsetDb:28,kind:'merchant' as const},
 {id:'small-craft',name:'Fictional Pebblewake',shafts:[1,1],maxRpm:520,maxSpeedKn:22,offsetDb:10,kind:'small' as const},
] as const;

export type SurfaceKind=(typeof templates)[number]['kind'];
export const surfaceTypes=templates.map((t,i)=>({...t,plantSpec:surfaceVesselPlant(t.id,t.maxRpm,t.shafts[0],60,[0,2,3].includes(i))}));
export const SURFACE_POOL_SIZE=18;
export const surfaceCount=(v:number,max=SURFACE_POOL_SIZE):number=>Math.round(clamp(Number.isFinite(v)?v:.5,0,1)*max);

/**
 * Expected dynamic-event rates (events per contact-hour of horizon). Wilson: subs ≫ fishing ≫
 * other surface (≈0). Used by tests and by createSurfacePool seeding.
 */
export const SURFACE_EVENT_RATE={
  /** Submarine maneuver/HYDP/swath rate — order-of-magnitude reference (from behaviours). */
  subPerHour:8,
  /** Fishing: most likely surface type for random events (still ≪ subs). */
  fishingPerHour:.45,
  /** Merchant/ferry/tanker/small craft: rare but nonzero. */
  otherPerHour:.06,
} as const;

/** Minimum surface−sub level gap (dB) at equal teaching speed — surfaces are louder. */
export const SURFACE_VS_SUB_LEVEL_DB=8;

/** Speed-dependent fictional ship signature (shaft orders, level, cavitation, flow); fixed topology,
 * in place. Called at pool creation and by the engine whenever a ship's leg changes speed. */
export function refreshSurfaceSignature(params:Signature,typeId:string,speedKn:number):void{
 const type=surfaceTypes.find(t=>t.id===typeId);if(!type)throw new Error(`Unknown surface type ${typeId}`);const v=clamp(speedKn,0,type.maxSpeedKn);
 params.levelDb=120+type.offsetDb+10*Math.log10(1+v/5);params.tonalRefDb=tonalRefDbFor(params.levelDb,'SURF','gen2');params.draughtSurfacedM=params.draughtSurfacedM??8;params.cavitationPower=.025+.04*(v/type.maxSpeedKn)**2;params.flowNoiseDb=v>0?85+55*Math.log10(v/5):-300;
 params.shaftHz=updatePropulsion(params,v/type.maxSpeedKn,'SURF').shafts[0].hz;params.tonalHz=params.shaftHz*params.blades;writePlantTonals(params,'SURF');
}

/** Lead: fishing is MOST likely among surface types; others still get rare but nonzero plausible events.
 * Ordering of expected rates: sub ≫ fishing ≫ other surface ≫ 0. */
function surfaceEvents(kind:SurfaceKind,horizonS:number,rng:()=>number):ContactTransient[]{
 const rate=kind==='fishing'?SURFACE_EVENT_RATE.fishingPerHour:SURFACE_EVENT_RATE.otherPerHour;
 const expected=rate*(horizonS/3600);
 // Poisson-ish: P(≥1)≈1-e^{-λ}; allow a second rare flash.
 let n=0;if(rng()<1-Math.exp(-expected))n=1;if(n===1&&rng()<1-Math.exp(-expected*.25))n=2;
 const out:ContactTransient[]=[];
 for(let i=0;i<n;i++){
  const at=60+Math.floor(rng()*Math.max(1,horizonS-120));
  if(kind==='fishing'?(rng()<.55):rng()<.35)out.push({at,kind:'swath',params:{durationS:Number((.6+rng()*1.8).toFixed(2)),loHz:30+rng()*50,hiHz:180+rng()*350}});
  else out.push({at,kind:'engine-ramp',params:{durationS:Number((6+rng()*18).toFixed(2)),fromScale:1,toScale:Number((.88+.08*rng()).toFixed(3))}});
 }
 return out;
}

export function createSurfacePool(seed:number,max=SURFACE_POOL_SIZE):Contact[]{
 const out:Contact[]=[];for(let rank=0;rank<max;rank++){
  const rng=mulberry32(deriveSeed(seed,`surface-pool:${rank}`)),mix=rank/Math.max(1,max-1);
  // Mix includes small-craft (index 6) in the light tier.
  const choices=mix<.34?[0,0,3,6,2,1]:mix<.67?[1,2,2,3,4,6]:[4,4,5,5,1],type=surfaceTypes[choices[Math.floor(rng()*choices.length)]]!;
  const behaviourRng=mulberry32(deriveSeed(seed,`surface-behaviour:${rank}`)),behaviour=pickSurfaceBehaviour(behaviourRng,type.id);
  const shafts=type.shafts[0]+Math.floor(rng()*(type.shafts[1]-type.shafts[0]+1)),blades=rng()<.5?3:4,electricalHz=rng()<.5?50:60,transitKn=type.maxSpeedKn*(.45+.4*rng()),speedKn=behaviour==='fishing'?Math.min(type.maxSpeedKn,2.5+2*behaviourRng()):transitKn,shaftHz=type.maxRpm/60*speedKn/type.maxSpeedKn;
  const params:Signature={label:displayName(type.name),shafts,electricalHz,shaftHz,blades,tonalHz:shaftHz*blades,levelDb:0,modulation:.55,tonals:[],plantSpec:surfaceVesselPlant(type.id,type.maxRpm,shafts,electricalHz,type.plantSpec.machinery.kind==='dieselGR'),cavitationPower:0,flowRadiatedFraction:.02};
  params.plantSpec!.propeller={shafts,blades,type:'flat'};
  configurePropulsion(params,seed,`surface-${rank+1}`);refreshSurfaceSignature(params,type.id,speedKn);
  const course=rng()*Math.PI*2,speed=knotsToMps(speedKn),depth=3+5*rng(),x=(rng()-.5)*14000,y=(rng()-.5)*14000;
  // Wilson/Lead: fishing MOST likely for random events; other surface rare but nonzero; both ≪ subs.
  const motion=planBehaviour({kind:behaviour==='fishing'?behaviour:'shipping',seed:deriveSeed(seed,`surface-${rank+1}`),durationS:BEHAVIOUR_HORIZON_S,start:{course,speed,depth},limits:{maxSpeedKn:type.maxSpeedKn,quietSpeedKn:Math.min(type.maxSpeedKn,4.5),minSpeedKn:.5,depthM:[depth,depth]},...(behaviour!=='fishing'?{holdS:BEHAVIOUR_HORIZON_S*.7}:{})});
  const transients=surfaceEvents(type.kind,BEHAVIOUR_HORIZON_S,mulberry32(deriveSeed(seed,`surface-evt:${rank}`)));
  out.push({id:`surface-${rank+1}`,category:'surface',operatingMode:'SURF',classificationTarget:false,surface:{type:type.id,shafts,electricalHz,rank},behaviour,active:false,x,y,depth,course,speed,params,motion,...(transients.length?{transients}:{})});
 }return out;
}
export function getClassificationTargets(s:Scenario):Contact[]{return s.contacts.filter(c=>c.category!=='surface'&&c.classificationTarget!==false&&c.active!==false);}

/** Count dynamic events on a contact (transients + motion legs after the first). */
export function countDynamicEvents(c:Pick<Contact,'motion'|'transients'>):number {
 return Math.max(0,(c.motion?.length??1)-1)+(c.transients?.length??0);
}
