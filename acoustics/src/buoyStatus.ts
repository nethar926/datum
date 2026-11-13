/** Per-buoy lifecycle status (AcousticEngine.buoyStatus; Swift SimEngine.buoyStatus).
 * Phase is the deploy sequence: planned → loaded → deployed (1 s) → descending → integrating → tuned,
 * then battery/link/operator phases. `descending` matches the UI label (not "falling").
 *
 * Priority (highest first): scuttled > offline > detuned > terminating > critical > degraded,
 * then the deploy-sequence phase. `weakSignal` is a flag alongside the phase, never a phase itself.
 */
import {deployStatus,splashTime,type DeployBuoy} from './deploySequence.js';
import type {PlanePose} from './planeRoute.js';
import {isTuned,type Buoy} from './buoys.js';
import {clamp} from './units.js';

/** Default rows for a full waterfall screen (web FE CURRENT_HISTORY_ROWS). Kept for API compatibility;
 * phase no longer depends on the row grid. */
export const BUOY_STATUS_SCREEN_ROWS=600;

/** Scenario default buoy life (minutes). Linear drain uses `buoy.life` seconds, falling back to this × 60. */
export const DEFAULT_BUOY_LIFE_MIN=240;

/** Battery phase thresholds on `batteryFrac` (inclusive upper bounds). */
export const BATTERY_DEGRADED=0.20;
export const BATTERY_CRITICAL=0.05;
export const BATTERY_TERMINATING=0.01;

/** weakSignal enters when linkQuality < this, and clears only when linkQuality > this. */
export const WEAK_SIGNAL_ENTER=0.25;
export const WEAK_SIGNAL_CLEAR=0.35;
/** Evaluation period (s) for weakSignal hysteresis (the status/row clock). */
export const WEAK_SIGNAL_CLOCK_S=1;

/**
 * Fictional sonobuoy-to-plane RF downlink (not a real radio).
 * Free-space path loss at `LINK_FREQ_HZ` plus a 4/3-earth radio-horizon cutoff
 * `4.12 * (sqrt(h_tx) + sqrt(h_rx))` km with heights in metres. Each antenna is
 * `LINK_ANTENNA_M` above its platform (plane `altM`, buoy surface float).
 * Received margin maps linearly onto 0…1 over `LINK_MARGIN_FULL_DB`.
 */
export const LINK_ANTENNA_M=1;
export const LINK_HORIZON_FACTOR=4.12;
export const LINK_FREQ_HZ=1.5e9;
export const LINK_TX_EIRP_DBM=30;
export const LINK_RX_SENSITIVITY_DBM=-100;
export const LINK_MARGIN_FULL_DB=40;
export const LINK_C_MPS=299792458;
/** 20 log10(4π/c); used as FSPL_dB = 20 log10(slant_m) + 20 log10(f) + LINK_FSPL_CONST. */
export const LINK_FSPL_CONST=20*Math.log10(4*Math.PI/LINK_C_MPS);

export type BuoyPhase='planned'|'loaded'|'deployed'|'descending'|'integrating'|'tuned'
  |'degraded'|'critical'|'terminating'|'offline'|'detuned'|'scuttled';

export interface BuoyStatus {
  phase:BuoyPhase;
  /** 0…1 of the *current* phase (not of a gram screen). */
  fill:number;
  /** Sim seconds remaining in the current phase (0 once tuned, or in a terminal operator/battery phase). */
  etaSeconds:number;
  /** Absolute sim time of water entry. Equal to deployedAt for placed buoys. */
  splashTime:number;
  /** Absolute sim time the buoy goes live. Equal to deployedAt for placed buoys. */
  liveTime:number;
  /** RF-tuned (`rfChannel > 0`); omitted on the pure helper, always set on engine queries. */
  isTuned?:boolean;
  /** Requested integration mode (`sti` default). Always set on engine queries. */
  integrationMode?:import('./res.js').IntegrationMode;
  /** Analysis span (s) currently used for rows (STI span during cold LSTI warmup). */
  integrationSpanS?:number;
  /** 0…1 of the LSTI span of *real* (non-prefill) history. 1 when STI, warm, or LSTI is ready. */
  lstiFill?:number;
  /** Sim seconds until LSTI is ready (0 when fill is 1). Does not overwrite deploy `etaSeconds`. */
  lstiEtaSeconds?:number;
  /** Ghost drop point while (and after) the buoy is on the planned path; null for ordinary placed buoys. */
  plannedDrop:{x:number;y:number;order:number}|null;
  /** Exact release (crossing) time; null while planned. Equal to deployedAt after release or for placed buoys. */
  releaseAt:number|null;
  /** 0…1 linear battery, draining from splashTime (placed: deployedAt) over `life` seconds. */
  batteryFrac:number;
  /** Sim seconds until batteryFrac reaches 0 (0 once offline or scuttled). */
  secondsToOffline:number;
  /** 0…1 RF link to the plane pose, or 1 when no plane route is set. */
  linkQuality:number;
  /** Hysteresis flag on the row clock: enters below WEAK_SIGNAL_ENTER, clears above WEAK_SIGNAL_CLEAR. */
  weakSignal:boolean;
}

/** Drain start: splashTime for sequence buoys, deployedAt (= splash) for placed. Infinity if still planned. */
export function batteryDrainStart(b:DeployBuoy):number{return splashTime(b);}
/** Sim time at which batteryFrac reaches 0. */
export function offlineTime(b:DeployBuoy&{life:number}):number{
  const start=batteryDrainStart(b);
  return Number.isFinite(start)?start+b.life:Number.POSITIVE_INFINITY;
}
export function batteryFracAt(t:number,b:DeployBuoy&{life:number}):number{
  const start=batteryDrainStart(b);
  if(!Number.isFinite(start)||t<=start)return 1;
  if(!(b.life>0))return 0;
  return clamp(1-(t-start)/b.life,0,1);
}
export function secondsToOfflineAt(t:number,b:DeployBuoy&{life:number}):number{
  const off=offlineTime(b);
  if(!Number.isFinite(off))return 0;
  return Math.max(0,off-t);
}

/** Radio-horizon range (metres). `hTx`/`hRx` are antenna heights in metres. */
export function radioHorizonM(hTx:number,hRx:number):number{
  return LINK_HORIZON_FACTOR*(Math.sqrt(Math.max(0,hTx))+Math.sqrt(Math.max(0,hRx)))*1000;
}

/** Free-space + horizon link quality in 0…1. `pose == null` means no plane route → 1. */
export function linkQualityAt(buoy:{x:number;y:number},pose:PlanePose|null):number{
  if(!pose)return 1;
  const hRx=LINK_ANTENNA_M,hTx=pose.altM+LINK_ANTENNA_M;
  const horiz=Math.hypot(pose.x-buoy.x,pose.y-buoy.y);
  if(horiz>radioHorizonM(hTx,hRx))return 0;
  const slant=Math.hypot(horiz,pose.altM);
  if(!(slant>0))return 1;
  const fspl=20*Math.log10(slant)+20*Math.log10(LINK_FREQ_HZ)+LINK_FSPL_CONST;
  const margin=LINK_TX_EIRP_DBM-fspl-LINK_RX_SENSITIVITY_DBM;
  return clamp(margin/LINK_MARGIN_FULL_DB,0,1);
}

/**
 * Deterministic weakSignal by stepping the row clock from 0 through `floor(t/clock)*clock`.
 * A query at t matches advancing the engine to t. Does not use wall-clock or prior call order.
 */
export function weakSignalByStepping(t:number,qualityAt:(tau:number)=>number,clock=WEAK_SIGNAL_CLOCK_S):boolean{
  if(!(t>=0)||!Number.isFinite(t)||!(clock>0))return false;
  let weak=false;
  const n=Math.floor(t/clock);
  for(let k=0;k<=n;k++){
    const q=qualityAt(k*clock);
    if(!weak && q<WEAK_SIGNAL_ENTER)weak=true;
    else if(weak && q>WEAK_SIGNAL_CLEAR)weak=false;
  }
  return weak;
}

export function resolveBuoyPhase(
  deploy:BuoyPhase,
  batteryFrac:number,
  detuned:boolean,
  scuttled:boolean,
):{phase:BuoyPhase;fill:number;etaSeconds:number;bandEndFrac:number|null}{
  if(scuttled)return {phase:'scuttled',fill:1,etaSeconds:0,bandEndFrac:null};
  if(batteryFrac<=0 && deploy!=='planned' && deploy!=='loaded')return {phase:'offline',fill:1,etaSeconds:0,bandEndFrac:null};
  if(detuned && deploy!=='planned' && deploy!=='loaded')return {phase:'detuned',fill:1,etaSeconds:0,bandEndFrac:null};
  if(batteryFrac<=BATTERY_TERMINATING)return {phase:'terminating',fill:1-batteryFrac/BATTERY_TERMINATING,etaSeconds:0,bandEndFrac:0};
  if(batteryFrac<=BATTERY_CRITICAL)return {phase:'critical',fill:1-(batteryFrac-BATTERY_TERMINATING)/(BATTERY_CRITICAL-BATTERY_TERMINATING),etaSeconds:0,bandEndFrac:BATTERY_TERMINATING};
  if(batteryFrac<=BATTERY_DEGRADED)return {phase:'degraded',fill:1-(batteryFrac-BATTERY_CRITICAL)/(BATTERY_DEGRADED-BATTERY_CRITICAL),etaSeconds:0,bandEndFrac:BATTERY_CRITICAL};
  return {phase:deploy,fill:0,etaSeconds:0,bandEndFrac:null};
}

function etaToFrac(t:number,b:DeployBuoy&{life:number},frac:number):number{
  const start=batteryDrainStart(b);
  if(!Number.isFinite(start)||!(b.life>0))return 0;
  const at=start+(1-frac)*b.life;
  return Math.max(0,at-t);
}

/** Deploy-sequence status. `anchor`/`period`/`screenRows` are accepted for call-site compatibility and ignored. */
function withDropFields(s:BuoyStatus,b:DeployBuoy):BuoyStatus{
  const d=b.deployedAt;
  return {...s,plannedDrop:b.plannedDrop??null,releaseAt:typeof d==='number'&&Number.isFinite(d)?d:null};
}



export function decorateStatusWithQuality(
  base:Omit<BuoyStatus,'batteryFrac'|'secondsToOffline'|'linkQuality'|'weakSignal'> & {phase:BuoyPhase;fill:number;etaSeconds:number},
  opts:{t:number;buoy:DeployBuoy&{life:number;x?:number;y?:number;rfChannel?:number;scuttledAt?:number};qualityAt:(tau:number)=>number;isTuned?:boolean},
):BuoyStatus{
  const {t,buoy}=opts;
  const scuttled=typeof buoy.scuttledAt==='number'&&Number.isFinite(buoy.scuttledAt)&&t>=buoy.scuttledAt;
  const frac=batteryFracAt(t,buoy);
  const detuned=opts.isTuned===false || (opts.isTuned===undefined && typeof buoy.rfChannel==='number' && !isTuned(buoy as Buoy));
  const resolved=resolveBuoyPhase(base.phase,frac,!!detuned,scuttled);
  let fill=base.fill,eta=base.etaSeconds;
  if(resolved.phase!==base.phase || resolved.bandEndFrac!==null || resolved.phase==='scuttled' || resolved.phase==='offline' || resolved.phase==='detuned'){
    fill=resolved.fill;
    eta=resolved.bandEndFrac===null?resolved.etaSeconds:etaToFrac(t,buoy,resolved.bandEndFrac);
  }
  const q=opts.qualityAt(t);
  const weak=weakSignalByStepping(t,opts.qualityAt);
  const seconds=scuttled?0:secondsToOfflineAt(t,buoy);
  return {...base,phase:resolved.phase,fill,etaSeconds:eta,batteryFrac:frac,secondsToOffline:seconds,linkQuality:q,weakSignal:weak};
}


export function buoyStatusOnGrid(t:number,deployedAt:number,anchor=0,period=1,screenRows=1,b:DeployBuoy={deployedAt}):BuoyStatus{
  void anchor;void period;void screenRows;
  const buoy={...b,deployedAt,life:(b as {life?:number}).life??DEFAULT_BUOY_LIFE_MIN*60};
  const raw=withDropFields(deployStatus(t,buoy) as BuoyStatus,buoy);
  return decorateStatusWithQuality(raw,{t,buoy,qualityAt:()=>1,isTuned:true});
}
export function buoyDeployStatus(t:number,b:DeployBuoy&{life?:number;x?:number;y?:number;rfChannel?:number;scuttledAt?:number},pose:PlanePose|null=null,qualityAt?:(tau:number)=>number):BuoyStatus{
  const buoy={...b,life:b.life??DEFAULT_BUOY_LIFE_MIN*60};
  const raw=withDropFields(deployStatus(t,b) as BuoyStatus,b);
  if(qualityAt)return decorateStatusWithQuality(raw,{t,buoy,qualityAt,isTuned:typeof b.rfChannel==='number'?isTuned(b as Buoy):undefined});
  // A single pose is the pose at `t` only — hysteresis needs pose(tau). Callers with a route pass qualityAt.
  if(pose)return decorateStatusWithQuality(raw,{t,buoy,qualityAt:()=>linkQualityAt({x:buoy.x??0,y:buoy.y??0},pose),isTuned:typeof b.rfChannel==='number'?isTuned(b as Buoy):undefined});
  return decorateStatusWithQuality(raw,{t,buoy,qualityAt:()=>1,isTuned:typeof b.rfChannel==='number'?isTuned(b as Buoy):undefined});
}
