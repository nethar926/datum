import type {LofarBandPresetId,GramFilter,ResLevel} from './protocol.js';
import {LOFAR_BAND_PRESETS} from './bands.js';

/**
 * Canonical tool/stream set shared by the live sim and CUT practice mode.
 * Wilson (2026-11-06): cuts offer all the same tools as live sims — they just are not
 * continuous. A 15-min cut (900 s) must carry every stream below for the full duration,
 * with synchronized bounded history. Equality of this set is pinned by test.
 */
export type SimStreamId=
  |`lofar/${LofarBandPresetId}/${GramFilter}`
  |'demon'
  |'difarBearing'
  |'waterColumn'
  |'truth';

const FILTERS:readonly GramFilter[]=['NB','BB'];

function buildStreamSet():readonly SimStreamId[] {
  const out:SimStreamId[]=[];
  for(const p of LOFAR_BAND_PRESETS)for(const f of FILTERS)out.push(`lofar/${p.id}/${f}`);
  out.push('demon','difarBearing','waterColumn','truth');
  return Object.freeze(out);
}

/** Frozen canonical stream set — live and cut must report identical contents/order. */
export const SIM_STREAM_SET:readonly SimStreamId[]=buildStreamSet();

export function liveSimStreamSet():readonly SimStreamId[]{return SIM_STREAM_SET;}
export function cutStreamSet():readonly SimStreamId[]{return SIM_STREAM_SET;}

/** Vernier centre (Hz) for a named LOFAR band when opening a RES NB/BB stream. */
export function vernierHzForBand(id:LofarBandPresetId):number {
  const p=LOFAR_BAND_PRESETS.find(x=>x.id===id);if(!p)throw new Error(`Unknown band ${id}`);
  return .5*(p.band[0]+p.band[1]);
}

/** Per-band analysis resolution: the finest RES whose 1024-bin zoom band B=1024·Δf covers the
 * preset width (ELF 50 Hz→RES2, VLF 200→RES4, LF 500→RES5, MF 2000→RES7). Integration T=1/Δf, so
 * ELF/VLF integrate longer (16 s / 4 s) than LF/MF (2 s / 0.5 s): the classic time–frequency
 * resolution tradeoff (Δf·T≈1; Urick, Principles of Underwater Sound, ch. 12; Lyons, Understanding
 * DSP, zoom FFT). Any later low-band pickup comes from this window/averaging only — there is no
 * per-band time offset anywhere; all bands share one sim time axis. */
export function resForBand(id:LofarBandPresetId):ResLevel {
  const p=LOFAR_BAND_PRESETS.find(x=>x.id===id);if(!p)throw new Error(`Unknown band ${id}`);
  const w=p.band[1]-p.band[0];for(let r=1;r<=9;r++)if(1024*.03125*2**(r-1)>=w)return r as ResLevel;return 9 as ResLevel;
}

/** Parse `lofar/LF/NB` → {bandPreset,filter}; other ids → null. */
export function parseLofarStreamId(id:SimStreamId):{bandPreset:LofarBandPresetId;filter:GramFilter}|null {
  if(!id.startsWith('lofar/'))return null;
  const parts=id.split('/');if(parts.length!==3)return null;
  const bandPreset=parts[1] as LofarBandPresetId,filter=parts[2] as GramFilter;
  if(!LOFAR_BAND_PRESETS.some(p=>p.id===bandPreset)||(filter!=='NB'&&filter!=='BB'))return null;
  return {bandPreset,filter};
}

/** Ring of synchronized samples for cut/live tool history (bounded; never grows without bound). */
export class BoundedStreamHistory<T> {
  private readonly buf:T[];
  private readonly cap:number;
  private i=0;
  private n=0;
  constructor(capacity:number){if(!(capacity>=1)||!Number.isInteger(capacity))throw new Error('Invalid history capacity');this.cap=capacity;this.buf=new Array(capacity);}
  push(sample:T):void{this.buf[this.i]=sample;this.i=(this.i+1)%this.cap;this.n=Math.min(this.n+1,this.cap);}
  get size():number{return this.n;}
  /** Oldest→newest copy. */
  toArray():T[]{const out:T[]=new Array(this.n);const start=this.n===this.cap?this.i:0;for(let k=0;k<this.n;k++)out[k]=this.buf[(start+k)%this.cap]!;return out;}
  clear():void{this.i=0;this.n=0;}
}

/** Default history horizon for a 900 s cut at 4 Hz row rate (one sample/row). */
export const CUT_HISTORY_ROWS_900S=900*4;
