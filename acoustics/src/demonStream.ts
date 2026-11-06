import {FFT} from './demon.js';
import {deriveSeed,mulberry32} from './prng.js';
import {powerToDb} from './units.js';
import {sourceLevel,type Signature} from './sourceModel.js';
import {transmissionLoss} from './transmissionLoss.js';
import type {Contact,Environment} from './scenario.js';
import type {Buoy} from './buoys.js';
import {DEMON_NORM} from './cuts/norm.js';
const DEMON_DB_FLOOR=DEMON_NORM.clampFloorDb;
const SIZE=4096,FS=SIZE*100/511;
interface Envelope {shaft:number;blades:number;modulation:number;table:Float32Array;phase:number}
// The same physical source envelope is shared by all buoy receivers; tables refresh only on state changes.
const envelopes=new WeakMap<Signature,Envelope>();
function refresh(s:Signature,e:Envelope):void{
 if(e.shaft===s.shaftHz&&e.blades===s.blades&&e.modulation===s.modulation)return;
 e.shaft=s.shaftHz;e.blades=s.blades;e.modulation=s.modulation;const phase=e.phase;
 for(let i=0;i<SIZE;i++){let sum=0;const shafts=s.propulsion?.shafts,n=shafts?.length??1;for(let j=0;j<n;j++){const hz=shafts?shafts[j].hz:s.shaftHz,a=2*Math.PI*hz*i/FS+phase,b=2*Math.PI*hz*s.blades*i/FS+phase;sum+=.2*Math.cos(a)+.1*Math.cos(2*a)+.4*Math.cos(b)+.18*Math.cos(2*b)+.08*Math.cos(3*b)+.04*Math.cos(4*b);}e.table[i]=1+s.modulation*sum/n;}
}
function select(a:Float32Array,k:number):number{let lo=0,hi=a.length-1;while(lo<hi){const pivot=a[(lo+hi)>>>1];let i=lo,j=hi;while(i<=j){while(a[i]<pivot)i++;while(a[j]>pivot)j--;if(i<=j){const v=a[i];a[i++]=a[j];a[j--]=v;}}if(k<=j)hi=j;else if(k>=i)lo=i;else break;}return a[k];}
/** Urick/Kinsler: DEMON of the incoherent sum of TL-weighted broadband power envelopes.
 * Includes every live sub/ship, shaft/blade harmonics; stationary 5.11 s envelope blocks.
 * No ultrasonic carrier is sampled: square-law power envelopes are summed directly. */
export class DemonStream {
 readonly bins=512;readonly fBin=100/511;
 private readonly signal=new Float32Array(SIZE);private readonly median=new Float32Array(512);private readonly spectrum=new Float32Array(512);private readonly fft=new FFT(SIZE);
 private readonly tables:Envelope[];private readonly weights:Float64Array;private readonly rng;
 private readonly carrier:number;
 constructor(private readonly buoy:Buoy,private readonly contacts:Contact[],seed:number,band:[number,number],private environment?:Environment){
  this.carrier=(band[0]+band[1])/2;this.weights=new Float64Array(contacts.length);this.rng=mulberry32(deriveSeed(seed,`demon:${buoy.id}`));
  this.tables=contacts.map(c=>{let e=envelopes.get(c.params);if(!e){e={shaft:-1,blades:0,modulation:-1,table:new Float32Array(SIZE),phase:mulberry32(deriveSeed(seed,`envelope:${c.id}`))()*2*Math.PI};envelopes.set(c.params,e);}refresh(c.params,e);return e;});
 }
 setEnvironment(e:Environment):void{this.environment=e;}
 write(out:Float32Array,offset:number):void {
  this.signal.fill(0);let total=0;
  for(let j=0;j<this.contacts.length;j++){const c=this.contacts[j];if(c.active===false){this.weights[j]=0;continue;}const r=Math.hypot(c.x-this.buoy.x,c.y-this.buoy.y,c.depth-this.buoy.depth),tl=transmissionLoss(r,this.carrier,this.environment?.spreading,this.environment?.transition);
   const w=Math.exp((sourceLevel(c.params,c.speed,c.depth)-tl)*(Math.LN10/10))*(.0001+(c.params.cavitationPower??0));this.weights[j]=w;total+=w;refresh(c.params,this.tables[j]);}
  if(total<=1e-30){out.fill(NaN,offset,offset+512);return;}
  for(let j=0;j<this.contacts.length;j++){const w=this.weights[j]/total;if(w<=0)continue;const table=this.tables[j].table;for(let i=0;i<SIZE;i++)this.signal[i]+=w*table[i];}
  let mean=0;for(let i=0;i<SIZE;i++){this.signal[i]+=.0001*(this.rng()-.5);mean+=this.signal[i];}mean/=SIZE;for(let i=0;i<SIZE;i++)this.signal[i]-=mean;
  this.fft.transform(this.signal,true,true);for(let i=0;i<512;i++)this.median[i]=this.spectrum[i]=(this.fft.real[i]**2+this.fft.imag[i]**2)/(SIZE*SIZE);
  const median=Math.max(1e-30,(select(this.median,255)+select(this.median,256))/2);
  // Clamp empty-bin floor (powerToDb(1e-30)≈−300). Peaks unchanged; stops FE split-window
  // mean collapse that painted saturated full-height low-band DEMON columns.
  for(let i=0;i<512;i++)out[offset+i]=Math.max(DEMON_DB_FLOOR,powerToDb(this.spectrum[i]/median));
 }
}
