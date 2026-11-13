import type {Contact} from './scenario.js';
import type {Buoy} from './buoys.js';
import {RES_FRAME_S,resParams,resSpanS} from './res.js';
import {sourceLevel,fillTonals,sourceLines} from './sourceModel.js';
/** Engine-wide source-STATE history for RES span averaging (shared by every LOFAR stream).
 *
 * Every RES_FRAME_S the engine records, per contact, the parameters the modelled spectrum depends
 * on (activity, kinematics, source level, flow/cavitation, tonal frequencies/powers, swath gains and
 * edges) and per buoy its kinematics. A RES row re-evaluates the modelled power spectrum at each
 * recorded frame inside its span and averages with Welch-style Hann² weights (resGram.ts). This is
 * time-averaging of modelled power spectra, not a waveform FFT — an approximation of the STFT
 * temporal response. Because the STATE (not spectra) is stored once per engine, any band, RES,
 * vernier or FULLBAND tile can be rendered for any span in the window with no per-stream history.
 *
 * Startup: the first record pre-fills the whole window with the t0 state (sources stationary
 * before the sim). Bounded: HISTORY_FRAMES frames, fixed at construction. Deterministic.
 *
 * Storage is Float32 for contact state and buoy kinematics (the large rings). Frame times
 * and the put() tonal scratch stay Float64. loadFrame promotes each value to Float64, and
 * the Welch span sum (integrateHistory / SH.P) already accumulates in Float64 over the
 * 88 s LSTI window, so live and drained BB stay bit-exact to each other. */
export const HISTORY_LATE_MARGIN_S=8;
/** Longest RES span: LSTI RES1 = T+(8K−1)·hop = 88 s (STI RES1 was 32 s). Covers every mode. */
export const HISTORY_MAX_SPAN_S=Math.max(...([1,2,3,4,5,6,7,8,9] as const).map(r=>resSpanS(resParams(r),'lsti')));
/** Frames needed to cover LSTI RES1 + late margin: ceil((88+8)/0.25)+2 = 386. Startup prefill is this deep, not the full retain ring. */
export const HISTORY_LSTI_FRAMES=Math.ceil((HISTORY_MAX_SPAN_S+HISTORY_LATE_MARGIN_S)/RES_FRAME_S)+2;
/** Retain enough real state to replay any row in a 900 s warm ring, including that row's LSTI span (900+88). */
export const HISTORY_RETAIN_SPAN_S=900+HISTORY_MAX_SPAN_S;
/** Ring capacity: ceil((988+8)/0.25)+2 = 3986. Distinct from HISTORY_LSTI_FRAMES (prefill depth). */
export const HISTORY_FRAMES=Math.ceil((HISTORY_RETAIN_SPAN_S+HISTORY_LATE_MARGIN_S)/RES_FRAME_S)+2;
const C_HEAD=10,B_STRIDE=5;
/** Line families whose activity is an event (unknown before t0 → zero in the startup prefill). */
export const EVENT_FAMILIES:ReadonlySet<string>=new Set(['HYDP','INTERMITTENT','TRANSIENT','SWATH']);
export interface HistoryLayout{offset:number;lines:number;swaths:number}
export function contactSwaths(c:Contact){return [...(c.params.speedGated??[]).filter(w=>w.kind==='SWATH'),...(c.params.eventSwaths??[])] as {loHz:number;hiHz:number;gain:number}[];}
export class StateHistory{
 readonly frames=HISTORY_FRAMES;readonly stride:number;readonly layout:HistoryLayout[];
 /** Per-buoy kinematics rings (frames×5), registered on demand; a late buoy is pre-filled with its current state. */
 readonly buoyRings=new Map<Buoy,Float32Array>();
 private static nextUid=1;readonly uid=StateHistory.nextUid++;private readonly buoyIds=new Map<Buoy,number>();
 buoyId(b:Buoy):number{let i=this.buoyIds.get(b);if(i===undefined){i=this.buoyIds.size;this.buoyIds.set(b,i);}return i;}
 readonly data:Float32Array;readonly t:Float64Array;head=0;count=0;last=-Infinity;
 private readonly freq:Float64Array;private readonly pow:Float64Array;
 constructor(readonly contacts:readonly Contact[]){
  let off=0,maxL=0;this.layout=contacts.map(c=>{c.lines??=sourceLines(c.params);const n=c.lines.length,m=contactSwaths(c).length,l={offset:off,lines:n,swaths:m};off+=C_HEAD+2*n+3*m;maxL=Math.max(maxL,n);return l;});
  this.stride=off;
  this.eventMask=contacts.map(c=>Uint8Array.from((c.lines??[]).map(l=>l.lineFamily&&EVENT_FAMILIES.has(l.lineFamily)?1:0)));this.data=new Float32Array(this.frames*this.stride);this.t=new Float64Array(this.frames);
  this.freq=new Float64Array(maxL);this.pow=new Float64Array(maxL);
 }
 get bytes():number{let b=this.data.byteLength+this.t.byteLength+this.freq.byteLength+this.pow.byteLength;for(const r of this.buoyRings.values())b+=r.byteLength;return b;}
 /** Register a buoy. A buoy added while history runs is back-extrapolated at constant velocity over the
  * recorded frame times (its own past was not recorded). */
 buoyRing(b:Buoy):Float32Array{let r=this.buoyRings.get(b);if(!r){r=new Float32Array(this.frames*B_STRIDE);const now=Number.isFinite(this.last)?this.last:0;
  for(let k=0;k<this.frames;k++){const o=k*B_STRIDE,dt=k<this.count||this.count===0?(this.count?now-this.t[k]!:0):0;r[o]=b.x-Math.sin(b.course)*b.speed*dt;r[o+1]=b.y-Math.cos(b.course)*b.speed*dt;r[o+2]=b.depth;r[o+3]=b.course;r[o+4]=b.speed;}this.buoyRings.set(b,r);}return r;}
 /** Record every grid point up to t with the CURRENT state (engine calls after each advance). */
 record(t:number):void{
  const f=RES_FRAME_S,cold=!Number.isFinite(this.last);let tk=cold?Math.floor(t/f+1e-9)*f:this.last+f;if(tk>t+1e-9)return;
  if(cold)this.prefillPending=true;
  for(;tk<=t+1e-9;tk+=f){this.put(tk);if(this.prefillPending&&this.count>=2){this.prefillPending=false;this.backfill();}}
 }
 /** Rows need the second real frame (t0+f) before rendering; until then integrate falls back. */
 private prefillPending=false;
 /** Startup prefill for t<t0 (documented assumption): kinematics are back-extrapolated from t0 at the
  * t0 rates (speed, heading and depth rates from the first two real frames t0, t0+f; position by
  * reverse Euler with the extrapolated course/speed). Only steady sources are carried back: plant
  * and other tonals at their t0 frequency/power, flow and cavitation broadband, source level re-
  * evaluated at the extrapolated speed/depth, and ambient (always present). Event families (HYDP,
  * INTERMITTENT, TRANSIENT, SWATH lines) and every swath contribute ZERO before t0, because their
  * pre-t0 state is unknown. Buoys are back-extrapolated the same way. Deterministic. */
 private backfill():void{
  const f=RES_FRAME_S,F=this.frames,P=Math.min(HISTORY_LSTI_FRAMES,this.frames),d=this.data,s1=this.slot(0),s0=this.slot(1),t0=this.t[s0]!;
  const wrap=(a:number)=>{let x=a%(2*Math.PI);if(x>Math.PI)x-=2*Math.PI;if(x<-Math.PI)x+=2*Math.PI;return x;};
  for(let j=0;j<this.contacts.length;j++){const c=this.contacts[j]!,L=this.layout[j]!,o0=s0*this.stride+L.offset,o1=s1*this.stride+L.offset,mask=this.eventMask[j]!;
   const acc=(d[o1+5]!-d[o0+5]!)/f,turn=wrap(d[o1+4]!-d[o0+4]!)/f,dz=(d[o1+3]!-d[o0+3]!)/f;
   let x=d[o0+1]!,y=d[o0+2]!;
   for(let k=1;k<=P-2;k++){const sl=(s0-k+2*F)%F,o=sl*this.stride+L.offset,tau=k*f;
    const sp=Math.max(0,d[o0+5]!-acc*tau),co=d[o0+4]!-turn*tau,dep=Math.max(0,d[o0+3]!-dz*tau);
    x-=Math.sin(co)*sp*f;y-=Math.cos(co)*sp*f;
    d[o]=d[o0]!;d[o+1]=x;d[o+2]=y;d[o+3]=dep;d[o+4]=co;d[o+5]=sp;d[o+6]=sourceLevel(c.params,sp,dep);d[o+7]=d[o0+7]!;d[o+8]=d[o0+8]!;d[o+9]=d[o0+9]!;
    for(let q=0;q<L.lines;q++){d[o+C_HEAD+q]=d[o0+C_HEAD+q]!;d[o+C_HEAD+L.lines+q]=mask[q]?0:d[o0+C_HEAD+L.lines+q]!;}
    const so=o+C_HEAD+2*L.lines,so0=o0+C_HEAD+2*L.lines;for(let q=0;q<L.swaths;q++){d[so+3*q]=0;d[so+3*q+1]=d[so0+3*q+1]!;d[so+3*q+2]=d[so0+3*q+2]!;}
    this.t[sl]=t0-tau;}}
  for(const r of this.buoyRings.values())this.backfillBuoy(r,s0,s1);
  this.count=P-1;
 }
 private backfillBuoy(r:Float32Array,s0:number,s1:number):void{
  const f=RES_FRAME_S,F=this.frames,P=Math.min(HISTORY_LSTI_FRAMES,this.frames),B=B_STRIDE,o0=s0*B,o1=s1*B;const acc=(r[o1+4]!-r[o0+4]!)/f,turn=(r[o1+3]!-r[o0+3]!)/f;let x=r[o0]!,y=r[o0+1]!;
  for(let k=1;k<=P-2;k++){const o=((s0-k+2*F)%F)*B,tau=k*f,sp=Math.max(0,r[o0+4]!-acc*tau),co=r[o0+3]!-turn*tau;x-=Math.sin(co)*sp*f;y-=Math.cos(co)*sp*f;r[o]=x;r[o+1]=y;r[o+2]=r[o0+2]!;r[o+3]=co;r[o+4]=sp;}
 }
 /** Per contact, per line: 1 = event family (no pre-t0 contribution). */
 private readonly eventMask:Uint8Array[];
 private put(tt:number):void{
  const h=this.head,base=h*this.stride,d=this.data;
  for(let j=0;j<this.contacts.length;j++){const c=this.contacts[j]!,L=this.layout[j]!,o=base+L.offset,p=c.params;
   d[o]=c.active===false?0:1;d[o+1]=c.x;d[o+2]=c.y;d[o+3]=c.depth;d[o+4]=c.course;d[o+5]=c.speed;d[o+6]=sourceLevel(p,c.speed,c.depth);
   d[o+7]=p.flowNoiseDb===undefined?NaN:p.flowNoiseDb;d[o+8]=p.flowRadiatedFraction??0;d[o+9]=p.cavitationPower??0;
   const fr=this.freq.subarray(0,L.lines),pw=this.pow.subarray(0,L.lines);fillTonals(p,fr,pw,c.lines);
   for(let k=0;k<L.lines;k++){d[o+C_HEAD+k]=fr[k]!;d[o+C_HEAD+L.lines+k]=pw[k]!;}
   const sw=contactSwaths(c),so=o+C_HEAD+2*L.lines;for(let s=0;s<L.swaths;s++){const w=sw[s];d[so+3*s]=w?.gain??0;d[so+3*s+1]=w?.loHz??0;d[so+3*s+2]=w?.hiHz??-1;}}
  for(const [b,r] of this.buoyRings){const o=h*B_STRIDE;r[o]=b.x;r[o+1]=b.y;r[o+2]=b.depth;r[o+3]=b.course;r[o+4]=b.speed;}
  this.t[h]=tt;this.head=(h+1)%this.frames;this.count=Math.min(this.count+1,this.frames);this.last=tt;
 }
 /** Slot index of the c-th newest frame (c=0 newest). */
 slot(c:number):number{return (this.head-1-c+this.frames*2)%this.frames;}
 static readonly C_HEAD=C_HEAD;static readonly B_STRIDE=B_STRIDE;
}
