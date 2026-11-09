import {normalizeMode,isDiesel,type ModeInput,type OperatingMode,type SubmarineClass} from './catalog/schema.js';
import {commandSpeedWindowKn,coupledSpeedWindowKn} from './catalog/plantModel.js';
import {clamp,knotsToMps,mpsToKnots} from './units.js';
import {
  depthEnvelopeFor,clampDepthM,atPeriscopeDepth,isSurfaced,type DepthEnvelope,
} from './depthEnvelope.js';
import {deriveSeed,mulberry32} from './prng.js';
import {sourceGateFor,type SourceGate} from './sourceGate.js';

const TAU=2*Math.PI;
const wrap=(a:number):number=>{const r=a%TAU;return r<0?r+TAU:r;};
const angDiff=(from:number,to:number):number=>{let d=wrap(to)-wrap(from);if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d;};

/** Ordered maneuver commands. Applied instantly as orders; kinematics ramp at envelope rates. */
export type ManeuverCommand=
  |{type:'setMode';mode:ModeInput}
  |{type:'setSpeedKn';speedKn:number}
  |{type:'setCourseRad';courseRad:number}
  |{type:'setDepthM';depthM:number}
  /** Explicit clutch request for flagged declutchToMotor plants; others reject. */
  |{type:'setClutch';engaged:boolean};

export type ManeuverRejectReason=
  |'exceedsTestDepth'
  |'snorkelTooDeep'
  |'dieselDeepWithoutSnorkel'
  |'surfacedRequiresDepth0'
  |'modeUnsupported'
  |'aipRequiresCapability'
  |'aipTooFast'
  |'speedExceedsModeCap'
  |'coupledOutOfBand'
  |'clutchUnsupported'
  |'invalidValue';

export interface ManeuverTruth {
  mode:OperatingMode;
  orderedMode:OperatingMode;
  speedKn:number;
  orderedSpeedKn:number;
  courseRad:number;
  orderedCourseRad:number;
  depthM:number;
  orderedDepthM:number;
  /** Live clutch intent for flagged GR diesels; undefined when N/A. */
  clutchEngaged?:boolean;
  commandStatus:'ok'|'rejected';
  rejectReason?:ManeuverRejectReason;
  envelope:DepthEnvelope;
  /** Seed that created this contact's maneuver stream (determinism). */
  seed:number;
}

export interface ManeuverSnapshot {
  mode:OperatingMode;
  speedKn:number;
  courseRad:number;
  depthM:number;
  speedMps:number;
  commandStatus:'ok'|'rejected';
  rejectReason?:ManeuverRejectReason;
  /** Sources that should emit given the live mode/depth/clutch (see sourceGate). */
  gate:SourceGate;
  /** Mode-change / depth-band edge events since last step (for SWATH/TRANSIENT). */
  edgeEvents:ManeuverEdgeEvent[];
}

export type ManeuverEdgeEvent=
  |{kind:'modeChange';from:OperatingMode;to:OperatingMode}
  |{kind:'surface'|'submerge'|'snorkelEngage'|'snorkelSecure'}
  |{kind:'clutchEngage'|'clutchDisengage'}
  |{kind:'depthBandCross';band:'periscope'|'patrol'|'deep'};

export interface ManeuverInit {
  class:SubmarineClass;
  seed:number;
  mode?:ModeInput;
  speedKn?:number;
  courseRad?:number;
  depthM?:number;
  contactId?:string;
}

/** Deterministic, seeded per-contact maneuver state. Rate-limits speed/heading/depth;
 * rejects physically impossible commands the same way propulsion uses commandStatus='rejected'
 * (previous valid order held). Never resets FE-facing history — step only advances continuous state. */
export class ManeuverState {
  readonly envelope:DepthEnvelope;
  readonly seed:number;
  readonly contactId:string;
  private readonly klass:SubmarineClass;
  private mode:OperatingMode;
  private orderedMode:OperatingMode;
  private speedKn:number;
  private orderedSpeedKn:number;
  private courseRad:number;
  private orderedCourseRad:number;
  private depthM:number;
  private orderedDepthM:number;
  private clutchEngaged:boolean|undefined;
  private commandStatus:'ok'|'rejected'='ok';
  private rejectReason:ManeuverRejectReason|undefined;
  private edges:ManeuverEdgeEvent[]=[];
  private prevDepthBand:'surface'|'periscope'|'patrol'|'deep';

  constructor(init:ManeuverInit){
    this.klass=init.class;this.seed=init.seed>>>0;this.contactId=init.contactId??init.class.id;
    this.envelope=depthEnvelopeFor(init.class);
    const primary=init.class.params.propulsion;
    const mode=normalizeMode(init.mode??(init.class.plant==='nuclear'?'NUC':'BATT'),primary);
    const depth=clampDepthM(this.envelope,init.depthM??this.envelope.typicalPatrolDepthM[0]);
    const cap=modeSpeedCap(init.class,mode);
    const speed=clamp(init.speedKn??Math.min(cap,init.class.quietSpeedKts[1]),0,cap);
    this.mode=mode;this.orderedMode=mode;
    this.speedKn=speed;this.orderedSpeedKn=speed;
    this.courseRad=wrap(init.courseRad??0);this.orderedCourseRad=this.courseRad;
    this.depthM=depth;this.orderedDepthM=depth;
    this.clutchEngaged=init.class.declutchToMotor?true:undefined;
    this.prevDepthBand=depthBand(this.envelope,depth);
    // Seeded jitter unused for rates (deterministic fixed rates); keep stream reserved.
    mulberry32(deriveSeed(this.seed,`maneuver:${this.contactId}`));
  }

  /** Apply a command. Rejects leave live state unchanged and set commandStatus='rejected'. */
  command(cmd:ManeuverCommand):ManeuverTruth {
    this.commandStatus='ok';this.rejectReason=undefined;
    switch(cmd.type){
      case 'setMode':return this.cmdMode(cmd.mode);
      case 'setSpeedKn':return this.cmdSpeed(cmd.speedKn);
      case 'setCourseRad':return this.cmdCourse(cmd.courseRad);
      case 'setDepthM':return this.cmdDepth(cmd.depthM);
      case 'setClutch':return this.cmdClutch(cmd.engaged);
      default:return this.reject('invalidValue');
    }
  }

  /** Advance continuous kinematics by dt seconds. Emits edge events for state-change transients. */
  step(dt:number):ManeuverSnapshot {
    if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid maneuver dt');
    this.edges=[];
    if(dt===0)return this.snapshot();
    const env=this.envelope;
    // Speed ramp toward ordered (respect mode cap continuously).
    const cap=modeSpeedCap(this.klass,this.mode);
    const targetSp=Math.min(this.orderedSpeedKn,cap);
    if(this.speedKn<targetSp)this.speedKn=Math.min(targetSp,this.speedKn+env.accelKnPerS*dt);
    else if(this.speedKn>targetSp)this.speedKn=Math.max(targetSp,this.speedKn-env.decelKnPerS*dt);
    // Heading ramp (rudder-limited; rate scales with speed/ref).
    const turn=env.turnRateRadPerS*clamp(this.speedKn/Math.max(1e-6,env.turnRateRefKn),.15,2.5);
    const dH=angDiff(this.courseRad,this.orderedCourseRad);
    if(Math.abs(dH)>1e-12){
      const step=Math.sign(dH)*Math.min(Math.abs(dH),turn*dt);
      this.courseRad=wrap(this.courseRad+step);
    }
    // Depth ramp toward ordered; never past test depth.
    const targetD=clampDepthM(env,this.orderedDepthM);
    if(this.depthM<targetD)this.depthM=Math.min(targetD,this.depthM+env.diveRateMps*dt);
    else if(this.depthM>targetD)this.depthM=Math.max(targetD,this.depthM-env.riseRateMps*dt);
    this.depthM=clampDepthM(env,this.depthM);
    this.emitDepthEdges();
    // Auto-secure diesel engines when depth leaves snorkel/surfaced band while ordered SNORK/SURF.
    this.reconcileModeWithDepth();
    return this.snapshot();
  }

  truth():ManeuverTruth {
    return {
      mode:this.mode,orderedMode:this.orderedMode,
      speedKn:this.speedKn,orderedSpeedKn:this.orderedSpeedKn,
      courseRad:this.courseRad,orderedCourseRad:this.orderedCourseRad,
      depthM:this.depthM,orderedDepthM:this.orderedDepthM,
      ...(this.clutchEngaged!==undefined?{clutchEngaged:this.clutchEngaged}:{}),
      commandStatus:this.commandStatus,
      ...(this.rejectReason?{rejectReason:this.rejectReason}:{}),
      envelope:this.envelope,seed:this.seed,
    };
  }

  snapshot():ManeuverSnapshot {
    return {
      mode:this.mode,speedKn:this.speedKn,courseRad:this.courseRad,depthM:this.depthM,
      speedMps:knotsToMps(this.speedKn),commandStatus:this.commandStatus,
      ...(this.rejectReason?{rejectReason:this.rejectReason}:{}),
      gate:sourceGateFor(this.klass,this.mode,this.depthM,this.clutchEngaged,this.envelope),
      edgeEvents:this.edges.slice(),
    };
  }

  private cmdMode(raw:ModeInput):ManeuverTruth {
    const mode=normalizeMode(raw,this.klass.params.propulsion);
    const check=validateModeDepth(this.klass,this.envelope,mode,this.depthM,this.orderedSpeedKn);
    if(check)return this.reject(check);
    if(mode!==this.mode)this.edges.push({kind:'modeChange',from:this.mode,to:mode});
    this.orderedMode=mode;this.mode=mode;
    // Cap ordered speed to new mode.
    const cap=modeSpeedCap(this.klass,mode);
    if(this.orderedSpeedKn>cap)this.orderedSpeedKn=cap;
    return this.truth();
  }

  private cmdSpeed(kn:number):ManeuverTruth {
    if(!Number.isFinite(kn)||kn<0)return this.reject('invalidValue');
    const cap=modeSpeedCap(this.klass,this.mode);
    if(kn>cap+1e-9)return this.reject('speedExceedsModeCap');
    // Unflagged coupled plants: out-of-band SNORK/SURF rejected (hold last valid).
    // Flagged declutchToMotor: commandSpeedWindowKn is undefined by design — use coupledSpeedWindowKn.
    const wCmd=commandSpeedWindowKn(this.klass,this.mode);
    const wCoup=coupledSpeedWindowKn(this.klass);
    if(wCmd&&kn>0&&(kn<wCmd.min*(1-1e-9)||kn>wCmd.max*(1+1e-9))){
      return this.reject('coupledOutOfBand');
    }
    if(this.klass.declutchToMotor&&wCoup&&(this.mode==='SURF'||this.mode==='SNORK')&&kn>0){
      const inBand=kn>=wCoup.min*(1-1e-9)&&kn<=wCoup.max*(1+1e-9);
      if(!inBand&&this.clutchEngaged!==false){this.clutchEngaged=false;this.edges.push({kind:'clutchDisengage'});}
      if(inBand&&this.clutchEngaged===false){this.clutchEngaged=true;this.edges.push({kind:'clutchEngage'});}
    }
    this.orderedSpeedKn=kn;
    return this.truth();
  }

  private cmdCourse(rad:number):ManeuverTruth {
    if(!Number.isFinite(rad))return this.reject('invalidValue');
    this.orderedCourseRad=wrap(rad);
    return this.truth();
  }

  private cmdDepth(d:number):ManeuverTruth {
    if(!Number.isFinite(d)||d<0)return this.reject('invalidValue');
    if(d>this.envelope.testDepthM+1e-9)return this.reject('exceedsTestDepth');
    const check=validateModeDepth(this.klass,this.envelope,this.mode,d,this.orderedSpeedKn);
    if(check)return this.reject(check);
    this.orderedDepthM=clampDepthM(this.envelope,d);
    return this.truth();
  }

  private cmdClutch(engaged:boolean):ManeuverTruth {
    if(!this.klass.declutchToMotor)return this.reject('clutchUnsupported');
    if(this.clutchEngaged===engaged)return this.truth();
    this.clutchEngaged=engaged;
    this.edges.push({kind:engaged?'clutchEngage':'clutchDisengage'});
    return this.truth();
  }

  private reject(reason:ManeuverRejectReason):ManeuverTruth {
    this.commandStatus='rejected';this.rejectReason=reason;return this.truth();
  }

  private emitDepthEdges():void {
    const band=depthBand(this.envelope,this.depthM);
    if(band===this.prevDepthBand)return;
    const prev=this.prevDepthBand;this.prevDepthBand=band;
    if(band==='surface')this.edges.push({kind:'surface'});
    else if(prev==='surface')this.edges.push({kind:'submerge'});
    if(band==='periscope'&&prev!=='periscope')this.edges.push({kind:'snorkelEngage'});
    if(prev==='periscope'&&band!=='periscope'&&band!=='surface')this.edges.push({kind:'snorkelSecure'});
    if(band==='patrol'||band==='deep')this.edges.push({kind:'depthBandCross',band});
  }

  private reconcileModeWithDepth():void {
    // Continuous: if a diesel is still ordered SNORK but depth left the periscope band, do not
    // silently change mode — plant gating already kills diesels via sourceGate when too deep.
    // SURF at depth>0 is rejected at command time; live depth ramp to surface keeps mode.
  }
}

function depthBand(env:DepthEnvelope,d:number):'surface'|'periscope'|'patrol'|'deep' {
  if(isSurfaced(env,d))return 'surface';
  if(atPeriscopeDepth(env,d))return 'periscope';
  if(d<=env.typicalPatrolDepthM[1])return 'patrol';
  return 'deep';
}

export function modeSpeedCap(c:Pick<SubmarineClass,'maxSpeedKts'|'aip'|'params'>,mode:OperatingMode):number {
  const m=c.maxSpeedKts;
  if(mode==='SURF')return m.surfaced;
  if(mode==='SNORK')return m.snorkel;
  if(mode==='BATT')return m.battery;
  if(mode==='AIP')return Math.min(m.battery,c.aip?.maxSpeedKts??0);
  if(mode==='D/E')return m.battery;
  return m.submerged;
}

/** Return a reject reason if mode/depth/speed combination is physically impossible; else undefined. */
export function validateModeDepth(
  c:Pick<SubmarineClass,'plant'|'params'|'aip'|'aipCapable'|'snorkelDepthM'>,
  env:DepthEnvelope,mode:OperatingMode,depthM:number,speedKn:number,
):ManeuverRejectReason|undefined {
  if(depthM>env.testDepthM+1e-9)return 'exceedsTestDepth';
  const diesel=isDiesel(c.params.propulsion);
  if(mode==='SURF'&&!isSurfaced(env,depthM))return 'surfacedRequiresDepth0';
  if(mode==='SNORK'){
    if(!diesel)return 'modeUnsupported';
    if(!atPeriscopeDepth(env,depthM)&&!isSurfaced(env,depthM))return 'snorkelTooDeep';
  }
  if(mode==='BATT'||mode==='D/E'){if(!diesel)return 'modeUnsupported';}
  if(mode==='NUC'&&diesel)return 'modeUnsupported';
  if(mode==='AIP'){
    if(!c.aipCapable||!c.aip)return 'aipRequiresCapability';
    if(depthM<=env.surfacedKeelDepthM)return 'modeUnsupported';
    if(speedKn>c.aip.maxSpeedKts+1e-9)return 'aipTooFast';
  }
  // Diesel "running deep without snorkel" — SNORK already covered; SURF covered.
  // Teaching: commanding SNORK while ordered depth is deep is the explicit reject above.
  if(diesel&&mode==='SNORK'&&depthM>env.periscopeDepthM+1e-6)return 'dieselDeepWithoutSnorkel';
  return undefined;
}

/** Edge events → ContactTransient-compatible flash descriptors (SWATH / TRANSIENT). */
export function edgeTransients(edges:readonly ManeuverEdgeEvent[],t:number,rng?:()=>number):{at:number;kind:'swath'|'transient'|'hydp';params:Record<string,number>}[] {
  const out:{at:number;kind:'swath'|'transient'|'hydp';params:Record<string,number>}[]=[];
  const u=()=>rng?rng():.5;
  for(const e of edges){
    if(e.kind==='surface'||e.kind==='submerge'){
      // Blow/vent broadband flash
      out.push({at:t,kind:'swath',params:{durationS:Number((1.5+u()*2).toFixed(2)),loHz:30+u()*40,hiHz:400+u()*600}});
      out.push({at:t,kind:'transient',params:{durationS:Number((.4+u()*.6).toFixed(2)),hz:Number((55+u()*40).toFixed(1)),harmonics:2}});
    }else if(e.kind==='snorkelEngage'||e.kind==='snorkelSecure'){
      // Mast raise/lower proxy
      out.push({at:t,kind:'swath',params:{durationS:Number((.8+u()*1.2).toFixed(2)),loHz:50+u()*30,hiHz:250+u()*200}});
      out.push({at:t,kind:'hydp',params:{durationS:Number((1+u()*1.5).toFixed(2))}});
    }else if(e.kind==='clutchEngage'||e.kind==='clutchDisengage'){
      out.push({at:t,kind:'transient',params:{durationS:Number((.15+u()*.2).toFixed(2)),hz:Number((120+u()*80).toFixed(1)),harmonics:1}});
    }else if(e.kind==='depthBandCross'||e.kind==='modeChange'){
      out.push({at:t,kind:'hydp',params:{durationS:Number((.8+u()*1).toFixed(2))}});
    }
  }
  return out;
}

/** Advance a Track-like contact from a maneuver snapshot (xy from course/speed; depth from state). */
export function applyManeuverKinematics(
  track:{x:number;y:number;depth:number;course:number;speed:number},
  snap:ManeuverSnapshot,dt:number,
):void {
  track.course=snap.courseRad;track.speed=snap.speedMps;track.depth=snap.depthM;
  track.x+=Math.sin(track.course)*track.speed*dt;
  track.y+=Math.cos(track.course)*track.speed*dt;
}

export {mpsToKnots,knotsToMps};
