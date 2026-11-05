import type { Track } from './kinematics.js';
export type ReceiverType = 'passive-omni' | 'difar';
/** Typed placeholders only; not supported by engine or scenario validation. */
export type PendingReceiverType = 'dicass' | 'vlad' | 'bt';
export interface Buoy extends Track { id:string; rfChannel:number; deployedAt:number; life:number; type:ReceiverType }
export const isAlive=(b:Buoy,time:number):boolean => time>=b.deployedAt && time<b.deployedAt+b.life;
/** Ideal co-located omni + east/north dipoles (Urick, directional receivers).
 * Cross-correlate signed dipoles with omni; atan2 removes dipole front/back ambiguity. */
export function difarBearing(omni:ArrayLike<number>,east:ArrayLike<number>,north:ArrayLike<number>):number {
  let e=0,n=0; for(let i=0;i<omni.length;i++){e+=omni[i]*east[i];n+=omni[i]*north[i];}
  return (Math.atan2(e,n)+2*Math.PI)%(2*Math.PI);
}
