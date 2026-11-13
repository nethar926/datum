import {isPlanned} from './planeDrop.js';
/** Deploy-sequence clock, mirrored by Swift DeploySequence. Placed buoys skip descent and are live at deployedAt. */
export const DEPLOY_HOLD_S=1;
/** 1500 ft in metres. */
export const DEFAULT_DROP_ALTITUDE_M=457.2;
export const DEFAULT_DESCENT_RATE_MPS=9;
export const DEFAULT_INTEGRATION_TIME_S=5;
export const INTEGRATION_TIME_MIN_S=5;
export const INTEGRATION_TIME_MAX_S=10;

export type BuoyStartMode='placed'|'unplaced';

export type DeployBuoy={deployedAt?:number;placed?:boolean;dropAltitudeM?:number;descentRateMps?:number;integrationTimeS?:number;plannedDrop?:{x:number;y:number;order:number}};

export const isPlaced=(b:DeployBuoy):boolean=>b.placed!==false;
export const dropAltitudeM=(b:DeployBuoy):number=>b.dropAltitudeM??DEFAULT_DROP_ALTITUDE_M;
export const descentRateMps=(b:DeployBuoy):number=>b.descentRateMps??DEFAULT_DESCENT_RATE_MPS;
export const integrationTimeS=(b:DeployBuoy):number=>b.integrationTimeS??DEFAULT_INTEGRATION_TIME_S;
export const fallDurationS=(b:DeployBuoy):number=>dropAltitudeM(b)/descentRateMps(b);
export function splashTime(b:DeployBuoy):number{
  if(isPlanned(b))return Number.POSITIVE_INFINITY;
  if(isPlaced(b))return b.deployedAt!;
  return b.deployedAt!+DEPLOY_HOLD_S+fallDurationS(b);
}
export function liveTime(b:DeployBuoy):number{
  if(isPlanned(b))return Number.POSITIVE_INFINITY;
  if(isPlaced(b))return b.deployedAt!;
  return splashTime(b)+integrationTimeS(b);
}
/** First row-end that may emit: max(live, splash+P) — full post-splash integration window, no pre-splash in the average. */
export const firstEmitTime=(b:DeployBuoy,P:number):number=>Math.max(liveTime(b),splashTime(b)+P);

export function validateIntegration(t:number):void{
  if(!Number.isFinite(t)||t<INTEGRATION_TIME_MIN_S||t>INTEGRATION_TIME_MAX_S)throw new Error('integrationTimeS must be in 5...10 s');
}
export function validateDrop(alt:number,rate:number):void{
  if(!Number.isFinite(alt)||alt<0||alt>1e6)throw new Error('Invalid dropAltitudeM');
  if(!Number.isFinite(rate)||rate<=0||rate>1e3)throw new Error('Invalid descentRateMps');
}

export type DeployPhase='planned'|'loaded'|'deployed'|'descending'|'integrating'|'tuned';
export interface DeployStatus{phase:DeployPhase;fill:number;etaSeconds:number;splashTime:number;liveTime:number}

export function deployStatus(t:number,b:DeployBuoy):DeployStatus{
  if(isPlanned(b))return {phase:'planned',fill:0,etaSeconds:0,splashTime:0,liveTime:0};
  const splash=splashTime(b),live=liveTime(b),release=b.deployedAt!;
  const pack=(phase:DeployPhase,a:number,c:number):DeployStatus=>{
    const d=c-a,fill=d<=0?1:Math.min(1,Math.max(0,(t-a)/d));
    return {phase,fill,etaSeconds:Math.max(0,c-t),splashTime:splash,liveTime:live};
  };
  if(t<release)return {phase:'loaded',fill:0,etaSeconds:Math.max(0,release-t),splashTime:splash,liveTime:live};
  if(isPlaced(b))return {phase:'tuned',fill:1,etaSeconds:0,splashTime:splash,liveTime:live};
  const descendStart=release+DEPLOY_HOLD_S;
  if(t<descendStart)return pack('deployed',release,descendStart);
  if(t<splash)return pack('descending',descendStart,splash);
  if(t<live)return pack('integrating',splash,live);
  return {phase:'tuned',fill:1,etaSeconds:0,splashTime:splash,liveTime:live};
}
