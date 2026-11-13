import {liveTime,splashTime} from './deploySequence.js';
import type { Track } from './kinematics.js';
export type ReceiverType = 'passive-omni' | 'difar';
/** Typed placeholders only; not supported by engine or scenario validation. */
export type PendingReceiverType = 'dicass' | 'vlad' | 'bt';
/** rfChannel 0 means detuned (no RF assigned); positive channels are unique among tuned buoys.
 * Optional `fault` is an engine-runtime health flag (yellow chrome); not required in scenario JSON. */
export interface Buoy extends Track { id:string; rfChannel:number; deployedAt?:number; life:number; type:ReceiverType; fault?:boolean;
  /** Default true: already in the water and integrated (today's goldens). `false` walks the deploy sequence. */
  placed?:boolean; dropAltitudeM?:number; descentRateMps?:number; integrationTimeS?:number;
  /** Ghost drop point and sequence order for a planned (not-yet-released) buoy. */
  plannedDrop?:{x:number;y:number;order:number};
  /** Sim time at which the operator scuttled the buoy; rows stop from this instant. */
  scuttledAt?:number }
export const isAlive=(b:Buoy,time:number):boolean => {
  const d=b.deployedAt;
  if(typeof d!=='number'||!Number.isFinite(d)||time<d)return false;
  if(typeof b.scuttledAt==='number'&&Number.isFinite(b.scuttledAt)&&time>=b.scuttledAt)return false;
  const start=splashTime(b),end=Number.isFinite(start)?start+b.life:d+b.life;
  return time<end;
};
/** Tuned = holding a positive RF channel (feeding when also alive). */
export const isTuned=(b:Buoy):boolean => b.rfChannel>0;
/** Alive and tuned — streams feed; detuned or expired yield NaN. */
export const isFeeding=(b:Buoy,time:number):boolean => isAlive(b,time) && isTuned(b) && time>=liveTime(b);
/** Ideal co-located omni + east/north dipoles (Urick, directional receivers).
 * Cross-correlate signed dipoles with omni; atan2 removes dipole front/back ambiguity. */
export function difarBearing(omni:ArrayLike<number>,east:ArrayLike<number>,north:ArrayLike<number>):number {
  let e=0,n=0; for(let i=0;i<omni.length;i++){e+=omni[i]*east[i];n+=omni[i]*north[i];}
  return (Math.atan2(e,n)+2*Math.PI)%(2*Math.PI);
}
