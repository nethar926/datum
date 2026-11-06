import {deriveSeed,mulberry32,type Random} from './prng.js';
import {clamp,knotsToMps,mpsToKnots} from './units.js';
import type {MotionLeg} from './scenario.js';
/** m3-events behaviours v1: invented TRAINING patterns only. Nothing here describes any real navy,
 * platform, class or doctrine; shapes are generic textbook geometry (straight legs, boxes,
 * racetracks, zig-zags, sprint/drift) chosen to make LOFAR/DEMON/DIFAR traces non-trivial.
 * Output is plain {at,course,speed,depth} MotionLeg[] (course rad, speed m/s, depth m). */
export type SurfaceBehaviour='shipping'|'fishing';
export type SubBehaviour='transit'|'patrol'|'avoidance'|'combat';
export type BehaviourKind=SurfaceBehaviour|SubBehaviour;
export const SURFACE_BEHAVIOURS:readonly SurfaceBehaviour[]=['shipping','fishing'];
export const SUB_BEHAVIOURS:readonly SubBehaviour[]=['transit','patrol','avoidance','combat'];
export const BEHAVIOUR_KINDS:readonly BehaviourKind[]=[...SURFACE_BEHAVIOURS,...SUB_BEHAVIOURS];
/** Default seeded pick weights for classification-target subs (teaching mix, not real-world frequency). */
export const subBehaviourWeights:Readonly<Record<SubBehaviour,number>>={transit:30,patrol:35,avoidance:15,combat:20};
/** Fishing probability per fictional surface template; the remainder is `shipping`. */
export const surfaceFishingProbability:Readonly<Record<string,number>>={'fishing-trawler':.85,tug:.4,'coastal-freighter':.1,ferry:.05,'bulk-carrier':0,tanker:0};
/** Default generated horizon: after the last leg the contact simply holds its final leg. */
export const BEHAVIOUR_HORIZON_S=3600;
export interface BehaviourLimits {maxSpeedKn:number;/** Quiet / drift ceiling; default 35% of max. */quietSpeedKn?:number;/** Floor for underway legs; default min(1 kn, max). */minSpeedKn?:number;/** Allowed depth band [shallow, deep] m; [d,d] pins depth (surface ships, SURF/SNORK). */depthM:[number,number]}
export interface BehaviourRequest {kind:BehaviourKind;seed:number;durationS:number;/** Leg 0 exactly (clamped into limits). course rad, speed m/s, depth m. x/y unused by v1 (no waypoints). */start:{course:number;speed:number;depth:number;x?:number;y?:number};limits:BehaviourLimits;/** No manoeuvre before this time (keeps initial CPA geometry). Default 0. */holdS?:number}
const TAU=2*Math.PI,DEG=Math.PI/180;
const wrap=(a:number):number=>{const r=a%TAU;return r<0?r+TAU:r;};
const range=(rng:Random,lo:number,hi:number):number=>lo+rng()*(hi-lo);
const sign=(rng:Random):number=>rng()<.5?-1:1;
export function pickWeighted<K extends string>(rng:Random,weights:Readonly<Record<K,number>>,order:readonly K[]):K {
 let total=0;for(const k of order){const w=weights[k];if(!Number.isFinite(w)||w<0)throw new Error('Invalid behaviour weight');total+=w;}if(total<=0)throw new Error('Positive total behaviour weight required');
 let n=rng()*total;for(const k of order){n-=weights[k];if(n<0)return k;}return order[order.length-1];
}
export const pickSubBehaviour=(rng:Random,weights:Readonly<Record<SubBehaviour,number>>=subBehaviourWeights):SubBehaviour=>pickWeighted(rng,weights,SUB_BEHAVIOURS);
export const pickSurfaceBehaviour=(rng:Random,type:string):SurfaceBehaviour=>rng()<(surfaceFishingProbability[type]??.2)?'fishing':'shipping';
/** Deterministic multi-leg plan. Same request → identical legs. Legs: first at===0, strictly increasing
 * integer-second `at` below durationS, speeds within [0,maxSpeedKn], depths within limits.depthM. */
export function planBehaviour(req:BehaviourRequest):MotionLeg[] {
 const {kind,limits}=req;if(!BEHAVIOUR_KINDS.includes(kind))throw new Error(`Unknown behaviour ${String(kind)}`);
 if(!Number.isFinite(req.durationS)||req.durationS<=0||!Number.isFinite(limits.maxSpeedKn)||limits.maxSpeedKn<0||!Array.isArray(limits.depthM)||!Number.isFinite(limits.depthM[0])||!Number.isFinite(limits.depthM[1])||limits.depthM[0]>limits.depthM[1])throw new Error('Invalid behaviour request');
 const rng=mulberry32(deriveSeed(req.seed>>>0,`behaviour:${kind}`)),max=Math.max(0,limits.maxSpeedKn*(1-1e-9)),quiet=clamp(limits.quietSpeedKn??max*.35,0,max),floor=clamp(limits.minSpeedKn??Math.min(1,max),0,quiet),[dLo,dHi]=limits.depthM;
 const kn=(x:number):number=>clamp(x,0,max),dep=(d:number):number=>clamp(Math.round(d*10)/10,dLo,dHi);
 const s0=Math.max(0,req.start.speed),d0=req.start.depth>=dLo&&req.start.depth<=dHi?req.start.depth:dep(req.start.depth);
 const legs:MotionLeg[]=[{at:0,course:wrap(req.start.course),speed:mpsToKnots(s0)<=limits.maxSpeedKn?s0:knotsToMps(max),depth:d0}];
 let t=0,course=legs[0].course,speedKn=mpsToKnots(legs[0].speed),depth=legs[0].depth;
 const startKn=speedKn,hold=Math.max(0,req.holdS??0);
 /** Append a leg dt seconds after the previous one (first manoeuvre deferred to holdS). */
 const push=(dt:number,c:number,s:number,d:number):boolean=>{let at=Math.round(Math.max(t+1,t+dt));if(legs.length===1&&at<hold)at=Math.round(hold);if(at>=req.durationS)return false;t=at;course=wrap(c);speedKn=kn(s);depth=dep(d);legs.push({at,course,speed:knotsToMps(speedKn),depth});return true;};
 const deeperOrShallower=(min:number,maxStep:number):number=>{const room=[dHi-depth,depth-dLo];if(room[0]<min&&room[1]<min)return depth+(room[0]>room[1]?room[0]:-room[1]);const down=room[0]>=min&&(room[1]<min||rng()<.5);return depth+(down?1:-1)*range(rng,min,Math.max(min,Math.min(maxStep,down?room[0]:room[1])));};
 switch(kind){
  case 'shipping':{// lane-like: long steady legs, occasional 10–40° alterations, near-constant transit speed
   const base=startKn;for(let ok=true;ok;){const turn=rng()<.6?sign(rng)*range(rng,10,40):sign(rng)*range(rng,1,4);ok=push(range(rng,600,1500),course+turn*DEG,base+(rng()<.3?range(rng,-.5,.5):0),depth);}break;}
  case 'fishing':{// slow loiter / box / racetrack with frequent mild turns; tow and haul/drift speeds
   const pattern=rng()<1/3?'box':rng()<.5?'racetrack':'loiter',dir=sign(rng),tow=()=>clamp(range(rng,2.5,4.5),floor,max),drift=()=>clamp(range(rng,.5,1.5),0,max);
   for(let ok=true,n=0;ok;n++){
    if(pattern==='box')ok=push(range(rng,240,480),course+dir*range(rng,75,105)*DEG,rng()<.2?drift():tow(),depth);
    else if(pattern==='racetrack')ok=n%3===2?push(range(rng,420,720),course+dir*range(rng,80,100)*DEG,tow(),depth):push(n%3===0?range(rng,420,720):range(rng,90,150),course+dir*range(rng,80,100)*DEG,n%3===1?drift()+.5:tow(),depth);
    else ok=push(range(rng,150,420),course+sign(rng)*range(rng,15,60)*DEG,rng()<.25?drift():tow(),depth);}break;}
  case 'transit':{// long steady legs; rare course and depth changes
   for(let ok=true;ok;){const alter=rng()<.6;ok=push(range(rng,900,2100),course+(alter?sign(rng)*range(rng,5,25):sign(rng)*range(rng,0,3))*DEG,startKn+range(rng,-.5,.5),rng()<.3?deeperOrShallower(10,40):depth);}break;}
  case 'patrol':{// closed box or reciprocating track at moderate speed, depth varied inside the envelope
   const box=rng()<.5,dir=sign(rng),moderate=()=>clamp(range(rng,Math.max(floor,quiet*.7),Math.max(quiet,Math.min(max,quiet*1.5))),0,max);
   for(let ok=true;ok;)ok=push(range(rng,500,1100),course+(box?dir*range(rng,80,100):range(rng,170,190))*DEG,moderate(),rng()<.6?deeperOrShallower(10,60):depth);break;}
  case 'avoidance':{// steady run, then abrupt evasive turn + depth change at quiet (or short sprint), then quiet opening legs
   let ok=push(range(rng,240,600),course,speedKn,depth);
   const sprint=rng()<.4,turn=sign(rng)*range(rng,70,150)*DEG;
   if(ok)ok=push(1,course+turn,sprint?Math.max(startKn,max*range(rng,.7,.9)):clamp(quiet*range(rng,.6,1),floor,quiet),deeperOrShallower(30,120));
   if(ok&&sprint)ok=push(range(rng,120,300),course+sign(rng)*range(rng,10,30)*DEG,clamp(quiet*range(rng,.6,1),floor,quiet),depth);
   while(ok)ok=push(range(rng,400,900),course+sign(rng)*range(rng,20,50)*DEG,clamp(quiet*range(rng,.5,1),floor,quiet),rng()<.4?deeperOrShallower(10,40):depth);break;}
  case 'combat':{// invented sprint-drift zig-zag: alternating fast and quiet legs with alternating course swings
   let side=sign(rng),fast=true;for(let ok=true;ok;fast=!fast,side=-side)ok=push(fast?range(rng,180,420):range(rng,120,300),course+side*range(rng,30,70)*DEG,fast?max*range(rng,.75,.95):clamp(quiet*range(rng,.4,1),floor,quiet),fast&&rng()<.5?deeperOrShallower(15,60):depth);break;}
 }
 return legs;
}
/** Structural check used by tests and callers: throws on the first bad leg. */
export function checkBehaviourLegs(legs:readonly MotionLeg[],limits:BehaviourLimits,durationS=Infinity):void {
 if(!legs.length||legs[0].at!==0)throw new Error('Plan needs leg at 0');let last=-1;
 for(const l of legs){if(!(l.at>last)||l.at>=durationS&&l.at!==0||!Number.isFinite(l.course)||!(mpsToKnots(l.speed)<=limits.maxSpeedKn)||l.speed<0||l.depth<limits.depthM[0]||l.depth>limits.depthM[1])throw new Error(`Invalid planned leg at ${l.at}`);last=l.at;}
}
export interface HydpTrigger {courseDeg?:number;depthM?:number}
/** Rudder/hydroplane proxy: a leg that turns ≥courseDeg (default 10°) or changes depth ≥depthM
 * (default 5 m) schedules one `hydp` transient at that leg's time (rendered as a paired blip). */
export function maneuverTransients(legs:readonly MotionLeg[],trigger:HydpTrigger={}):{at:number;kind:'hydp';params:Record<string,number>}[] {
 const minC=(trigger.courseDeg??10)*DEG,minD=trigger.depthM??5,out:{at:number;kind:'hydp';params:Record<string,number>}[]=[];
 for(let i=1;i<legs.length;i++){const a=legs[i-1],b=legs[i],dc=Math.abs(wrap(b.course-a.course+Math.PI)-Math.PI);if(dc>=minC||Math.abs(b.depth-a.depth)>=minD)out.push({at:b.at,kind:'hydp',params:{}});}
 return out;
}
