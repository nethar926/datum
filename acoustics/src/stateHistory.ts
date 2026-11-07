import type {Contact} from './scenario.js';
import type {Buoy} from './buoys.js';
import {RES_FRAME_S,resParams} from './res.js';
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
 * before the sim). Bounded: HISTORY_FRAMES frames, fixed at construction. Deterministic. */
export const HISTORY_LATE_MARGIN_S=8;
/** Longest RES span (RES1: T=32 s, K=1). */
export const HISTORY_MAX_SPAN_S=Math.max(...[1,2,3,4,5,6,7,8,9].map(r=>{const p=resParams(r as 1);return p.integrationS+(p.averages-1)*p.hopS;}));
export const HISTORY_FRAMES=Math.ceil((HISTORY_MAX_SPAN_S+HISTORY_LATE_MARGIN_S)/RES_FRAME_S)+2;
const C_HEAD=10,B_STRIDE=5;
export interface HistoryLayout{offset:number;lines:number;swaths:number}
export function contactSwaths(c:Contact){return [...(c.params.speedGated??[]).filter(w=>w.kind==='SWATH'),...(c.params.eventSwaths??[])] as {loHz:number;hiHz:number;gain:number}[];}
export class StateHistory{
 readonly frames=HISTORY_FRAMES;readonly stride:number;readonly layout:HistoryLayout[];
 /** Per-buoy kinematics rings (frames×5), registered on demand; a late buoy is pre-filled with its current state. */
 readonly buoyRings=new Map<Buoy,Float64Array>();
 readonly data:Float64Array;readonly t:Float64Array;head=0;count=0;last=-Infinity;
 private readonly freq:Float64Array;private readonly pow:Float64Array;
 constructor(readonly contacts:readonly Contact[]){
  let off=0,maxL=0;this.layout=contacts.map(c=>{c.lines??=sourceLines(c.params);const n=c.lines.length,m=contactSwaths(c).length,l={offset:off,lines:n,swaths:m};off+=C_HEAD+2*n+3*m;maxL=Math.max(maxL,n);return l;});
  this.stride=off;this.data=new Float64Array(this.frames*this.stride);this.t=new Float64Array(this.frames);
  this.freq=new Float64Array(maxL);this.pow=new Float64Array(maxL);
 }
 get bytes():number{let b=this.data.byteLength+this.t.byteLength+this.freq.byteLength+this.pow.byteLength;for(const r of this.buoyRings.values())b+=r.byteLength;return b;}
 buoyRing(b:Buoy):Float64Array{let r=this.buoyRings.get(b);if(!r){r=new Float64Array(this.frames*B_STRIDE);for(let k=0;k<this.frames;k++){const o=k*B_STRIDE;r[o]=b.x;r[o+1]=b.y;r[o+2]=b.depth;r[o+3]=b.course;r[o+4]=b.speed;}this.buoyRings.set(b,r);}return r;}
 /** Record every grid point up to t with the CURRENT state (engine calls after each advance). */
 record(t:number):void{
  const f=RES_FRAME_S,cold=!Number.isFinite(this.last);let tk=cold?Math.floor(t/f+1e-9)*f:this.last+f;if(tk>t+1e-9)return;
  if(cold)for(let j=this.frames-1;j>0;j--)this.put(tk-j*f);
  for(;tk<=t+1e-9;tk+=f)this.put(tk);
 }
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
