/** Engine-owned time-sized history rings for warm RES 1–9 and DEMON.
 *
 * Capacity is `ceil(spanS / P)` (default spanS = 900: RES1 113, RES2 225, RES3–9 450,
 * DEMON at 4 Hz 3600). Displayed buoys store Float32; others store 8-bit 0.5 dB
 * (precisionDb 0.25) and 8-bit DIFAR bearings (360/256 °, NaN sentinel 255).
 * Vernier and legacy 4 Hz LOFAR are not in the warm set.
 */
import type {GramFilter,ResLevel} from './protocol.js';
import {resParams} from './res.js';

export const HISTORY_RING_SPAN_S=900;
export const DB_STEP=0.5;
/** Half-step of the 0.5 dB quantizer — readout error bound, not the step. */
export const PRECISION_DB=0.25;
export const BEARING_LEVELS=256;
export const BEARING_STEP_DEG=360/BEARING_LEVELS;
export const BEARING_PRECISION_DEG=BEARING_STEP_DEG/2;
/** 8-bit sentinel for a NaN bin (dB or bearing). */
export const Q_NAN=255;

export function historyRingRows(rowPeriodS:number,spanS=HISTORY_RING_SPAN_S):number{
  if(!(rowPeriodS>0)||!(spanS>0))throw new Error('invalid ring period/span');
  return Math.ceil(spanS/rowPeriodS);
}

export function historyRingRowsForRes(res:ResLevel,spanS=HISTORY_RING_SPAN_S):number{
  return historyRingRows(resParams(res).rowPeriodS,spanS);
}

export function quantizeDb(db:number):number{
  if(!Number.isFinite(db))return Q_NAN;
  return Math.max(0,Math.min(254,Math.round(db/DB_STEP)));
}
export function dequantizeDb(q:number):number{
  return q===Q_NAN?NaN:q*DB_STEP;
}
export function quantizeBearing(deg:number):number{
  if(!Number.isFinite(deg))return Q_NAN;
  const x=((deg%360)+360)%360;
  return Math.round(x/BEARING_STEP_DEG)%BEARING_LEVELS;
}
export function dequantizeBearing(q:number):number{
  return q===Q_NAN?NaN:(q*BEARING_STEP_DEG)%360;
}

export interface HistoryRow {
  k:number;
  simT:number;
  data:Float32Array;
  bearingDeg?:Float32Array;
  quantized?:boolean;
  precisionDb?:number;
  bearingQuantized?:boolean;
  bearingPrecisionDeg?:number;
}

export type DrainState='running'|'done'|'cancelled';

/** In-flight or finished chunked drain (beginDrain). `rows` is oldest-first and is this
 * handle's own buffer — never shared with another handle. Unfilled rows (`k < filledFrom`)
 * have NaN bins, not zeros. `filledFrom` only ever decreases. After `cancelled` or `done`,
 * both it and `rows` are frozen. */
export class DrainHandle {
  readonly id:number;
  readonly streamId:number;
  readonly res:ResLevel|null;
  readonly rows:HistoryRow[];
  private _filledFrom:number;
  private _state:DrainState;
  constructor(id:number,streamId:number,res:ResLevel|null,rows:HistoryRow[]){
    this.id=id;this.streamId=streamId;this.res=res;this.rows=rows;
    this._filledFrom=rows.length;this._state=rows.length===0?'done':'running';
  }
  get filledFrom():number{return this._filledFrom;}
  get state():DrainState{return this._state;}
  /** @internal */
  _setFilledFrom(n:number):void{if(n<this._filledFrom)this._filledFrom=n;}
  /** @internal */
  _setState(s:DrainState):void{if(this._state==='running')this._state=s;}
}

/** One circular row buffer (dB, optional bearings). Each plane is one contiguous
 * ArrayBuffer (row s at s·bins) rather than a per-row TypedArray — same values,
 * far fewer V8 object headers and less allocator/page waste. Displayed pushes
 * go to the Float32 plane; 8-bit historical rows stay on the Uint8 plane. */
export class RowRing {
  readonly rows:number;
  readonly bins:number;
  /** When true, new pushes are Float32; existing 8-bit rows stay 8-bit. */
  displayed:boolean;
  private originK=0;
  private filled=0;
  private dbF32:Float32Array|null=null;
  private dbU8:Uint8Array|null=null;
  private brgF32:Float32Array|null=null;
  private brgU8:Uint8Array|null=null;
  private readonly qDb:Uint8Array;   // 1 = this slot is 8-bit dB
  private readonly qBrg:Uint8Array;  // 1 = this slot is 8-bit bearing
  private readonly hasBrg:Uint8Array;
  constructor(rows:number,bins:number,displayed:boolean){
    this.rows=rows;this.bins=bins;this.displayed=displayed;
    this.qDb=new Uint8Array(rows);
    this.qBrg=new Uint8Array(rows);
    this.hasBrg=new Uint8Array(rows);
  }
  get count():number{return this.filled;}
  get oldestK():number{return this.filled===0?0:this.originK;}
  get newestK():number{return this.filled===0?-1:this.originK+this.filled-1;}
  get bytes():number{
    return this.qDb.byteLength+this.qBrg.byteLength+this.hasBrg.byteLength
      +(this.dbF32?.byteLength??0)+(this.dbU8?.byteLength??0)
      +(this.brgF32?.byteLength??0)+(this.brgU8?.byteLength??0);
  }
  private planeF32():Float32Array{return this.dbF32??(this.dbF32=new Float32Array(this.rows*this.bins));}
  private planeU8():Uint8Array{return this.dbU8??(this.dbU8=new Uint8Array(this.rows*this.bins));}
  private planeBrgF32():Float32Array{return this.brgF32??(this.brgF32=new Float32Array(this.rows*this.bins));}
  private planeBrgU8():Uint8Array{return this.brgU8??(this.brgU8=new Uint8Array(this.rows*this.bins));}
  /** Allocate every slot at the current precision (full-span RSS bound, no generate). */
  allocateCapacity(bearings:boolean):void{
    const f32=this.displayed;
    if(f32){
      this.planeF32();this.dbU8=null;this.qDb.fill(0);
      if(bearings){this.planeBrgF32();this.brgU8=null;this.qBrg.fill(0);this.hasBrg.fill(1);}
    }else{
      this.planeU8();this.dbF32=null;this.qDb.fill(1);
      if(bearings){this.planeBrgU8();this.brgF32=null;this.qBrg.fill(1);this.hasBrg.fill(1);}
    }
  }
  private slot(k:number):number{return ((k%this.rows)+this.rows)%this.rows;}
  has(k:number):boolean{return this.filled>0&&k>=this.originK&&k<this.originK+this.filled;}
  /** True when row k is stored 8-bit. Live writeRow must not copy those (not bit-exact). */
  isQuantized(k:number):boolean{return this.has(k)&&!!this.qDb[this.slot(k)];}
  push(k:number,db:Float32Array,bearing?:Float32Array):void{
    if(this.filled===0){this.originK=k;this.filled=1;}
    else if(k===this.originK+this.filled){
      if(this.filled===this.rows){this.originK++;this.filled--;}
      this.filled++;
    }else if(k>=this.originK&&k<this.originK+this.filled){
      // overwrite (shouldn't normally happen)
    }else if(k>this.originK+this.filled){
      // gap: drop and start a new run at k (should not happen on a regular grid)
      this.originK=k;this.filled=1;
    }else{
      return; // older than retained
    }
    const s=this.slot(k),B=this.bins,off=s*B,f32=this.displayed;
    if(f32){
      this.planeF32().set(db.subarray(0,B),off);this.qDb[s]=0;
    }else{
      const u=this.planeU8();for(let i=0;i<B;i++)u[off+i]=quantizeDb(db[i]!);this.qDb[s]=1;
    }
    if(bearing){
      this.hasBrg[s]=1;
      if(f32){this.planeBrgF32().set(bearing.subarray(0,B),off);this.qBrg[s]=0;}
      else{const u=this.planeBrgU8();for(let i=0;i<B;i++)u[off+i]=quantizeBearing(bearing[i]!);this.qBrg[s]=1;}
    }else{this.hasBrg[s]=0;this.qBrg[s]=0;}
  }
  /** Copy row k into `out` (and optional bearing). Returns flags. */
  get(k:number,out:Float32Array,bearing?:Float32Array):{quantized:boolean;bearingQuantized:boolean;hasBearing:boolean}|undefined{
    if(!this.has(k))return undefined;
    const s=this.slot(k),B=this.bins,off=s*B,qd=!!this.qDb[s];
    if(qd){const u=this.dbU8!;for(let i=0;i<B;i++)out[i]=dequantizeDb(u[off+i]!);}
    else out.set(this.dbF32!.subarray(off,off+Math.min(B,out.length)));
    const hb=!!this.hasBrg[s],qb=!!this.qBrg[s];
    if(bearing&&hb){
      if(qb){const u=this.brgU8!;for(let i=0;i<B;i++)bearing[i]=dequantizeBearing(u[off+i]!);}
      else bearing.set(this.brgF32!.subarray(off,off+Math.min(B,bearing.length)));
    }else if(bearing)bearing.fill(NaN);
    return {quantized:qd,bearingQuantized:qb,hasBearing:hb};
  }
  drain(n:number,rowPhaseS:number,rowRateHz:number):HistoryRow[]{
    if(this.filled===0||n<=0)return [];
    const take=Math.min(n,this.filled),start=this.originK+this.filled-take,out:HistoryRow[]=[];
    for(let k=start;k<this.originK+this.filled;k++){
      const data=new Float32Array(this.bins);
      const brg=new Float32Array(this.bins);
      const f=this.get(k,data,brg)!;
      const row:HistoryRow={k,simT:rowPhaseS+k/rowRateHz,data};
      if(f.quantized){row.quantized=true;row.precisionDb=PRECISION_DB;}
      if(f.hasBearing){
        row.bearingDeg=brg;
        if(f.bearingQuantized){row.bearingQuantized=true;row.bearingPrecisionDeg=BEARING_PRECISION_DEG;}
      }
      out.push(row);
    }
    return out;
  }
}

export type WarmResKey={buoy:number;res:ResLevel;filter:GramFilter};
