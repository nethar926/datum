import {liveTime,splashTime} from './deploySequence.js';
import type { Track } from './kinematics.js';
export type ReceiverType = 'passive-omni' | 'difar';
/** Canonical inventory / plot / status buoy type. */
export const BUOY_TYPES = ['bt','omni','difar','dicass'] as const;
export type BuoyType = typeof BUOY_TYPES[number];
/** Accepted on input (scenario JSON, addBuoy): canonical types plus the legacy acoustic spelling. */
export type BuoyTypeInput = BuoyType | ReceiverType;
/** Typed placeholders only; not supported by gram `dropBuoy`. `dicass`/`bt` may appear on inventory/status. */
export type PendingReceiverType = 'dicass' | 'vlad' | 'bt';
export const BUOY_TYPE_INPUTS: readonly string[] = [...BUOY_TYPES, 'passive-omni'];
export function isBuoyType(v: unknown): v is BuoyType {
  return v === 'bt' || v === 'omni' || v === 'difar' || v === 'dicass';
}
export function isBuoyTypeInput(v: unknown): v is BuoyTypeInput {
  return isBuoyType(v) || v === 'passive-omni';
}
/** Infer canonical type from `type`, legacy `passive-omni`, `kind`, or a `difar` boolean. */
export function inferBuoyType(
  raw?: {type?: unknown; kind?: unknown; difar?: unknown} | string | null,
  fallback: BuoyType = 'omni',
): BuoyType {
  const pick = (v: unknown): BuoyType | undefined => {
    if (isBuoyType(v)) return v;
    if (v === 'passive-omni') return 'omni';
    return undefined;
  };
  if (typeof raw === 'string') return pick(raw) ?? fallback;
  if (!raw || typeof raw !== 'object') return fallback;
  if (pick(raw.type) !== undefined) return pick(raw.type)!;
  if (pick(raw.kind) !== undefined) return pick(raw.kind)!;
  if (raw.difar === true) return 'difar';
  if (raw.difar === false) return 'omni';
  return fallback;
}
export function receiverTypeOf(t: BuoyType | BuoyTypeInput): ReceiverType {
  return inferBuoyType(t) === 'difar' ? 'difar' : 'passive-omni';
}
export function isDifarBuoy(b: {type?: unknown; kind?: unknown; difar?: unknown} | string): boolean {
  return inferBuoyType(b) === 'difar';
}
/** Canonical `type` plus derived `difar` boolean (type === 'difar'). */
export function normalizeBuoy<T extends {type?: unknown; kind?: unknown; difar?: unknown}>(b: T): T & {type: BuoyType; difar: boolean} {
  const type = inferBuoyType(b);
  return {...b, type, difar: type === 'difar'};
}
/** rfChannel 0 means detuned (no RF assigned); positive channels are unique among tuned buoys.
 * Optional `fault` is an engine-runtime health flag (yellow chrome); not required in scenario JSON.
 * `type` accepts legacy `passive-omni`; engines canonicalize to `BuoyType` on add/load.
 * `difar` is derived (`type === 'difar'`) and written on add/load for backward compatibility. */
export interface Buoy extends Track { id:string; rfChannel:number; deployedAt?:number; life:number; type:BuoyTypeInput; difar?:boolean; fault?:boolean;
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
