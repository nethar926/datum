import {FFT} from './demon.js';
import {deriveSeed,mulberry32} from './prng.js';
import {powerToDb,dbToPower,C} from './units.js';
import {sourceLevel,type Signature} from './sourceModel.js';
import {spreadingLoss,thorp} from './transmissionLoss.js';
import {exactGain,pathDifference,seaSurfaceSigma} from './lloydsMirror.js';
import {czPropagationGainLinear,czEstimateFor} from './convergenceZone.js';
import type {WaterColumnProfile} from './waterColumn.js';
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

/** Same fictional broadband PSD shape as NB/BB (`lofar.ts` / `resGram.ts`). */
export function sourceShape(fHz:number):number{return 1/(1+(Math.max(0,fHz)/400)**2);}

export interface CarrierIntegralOpts {
 /** Override sample count (default: clamp(ceil(span/16), 48, 96)). */
 samples?:number;
 /** When true, force shape(f)=1 (closed-form / dB-contrast tests). */
 flatShape?:boolean;
 /** When true, force Lloyd gain = 1 (absorption-only tests). */
 noLloyd?:boolean;
 /** When true, force absorption gain = 1. */
 noAbsorption?:boolean;
}

function defaultSamples(span:number):number{return Math.max(48,Math.min(96,Math.ceil(span/16)));}

/**
 * Linear ∫ S(f)·G_f(r,f) df over [loHz, hiHz] (midpoint rule).
 * S(f) = sourceShape(f) unless flatShape.
 * G_f = 10^(−thorp(f)·km/10) · exactGain(...) — absorption + Lloyd's mirror, matching NB/BB.
 * Frequency-independent factors (spreading, CZ, SL, cavitation) are applied by the caller.
 * Does **not** average TL in dB.
 */
export function integrateCarrierSG(
 loHz:number,hiHz:number,
 rangeM:number,horizontalM:number,zsM:number,zrM:number,
 soundSpeed=C,sigma=0,opts:CarrierIntegralOpts={},
):number{
 const lo=Math.min(loHz,hiHz),hi=Math.max(loHz,hiHz),span=hi-lo;
 if(!(span>0)||!Number.isFinite(span))return 0;
 const n=opts.samples??defaultSamples(span);
 const df=span/n,km=Math.max(0,rangeM-1)/1000,c=Math.max(1,soundSpeed);
 const flat=!!opts.flatShape,noL=!!opts.noLloyd,noA=!!opts.noAbsorption;
 // Fast path: Lloyd via path-difference recurrence (same as lofar/resGram); q may still vary with f when sigma>0.
 const delta=noL?0:pathDifference(horizontalM,zsM,zrM);
 const imageRange=Math.hypot(horizontalM,zsM+zrM),q0=imageRange>0?Math.hypot(horizontalM,zsM-zrM)/imageRange:1;
 const grazing2=imageRange>0?((zsM+zrM)/imageRange)**2:0;
 const f0=lo+.5*df;
 const phase=2*Math.PI*f0*delta/c,step=2*Math.PI*df*delta/c,dc=Math.cos(step),ds=Math.sin(step);
 let cp=Math.cos(phase),sp=Math.sin(phase),sum=0;
 for(let i=0;i<n;i++){
  const f=lo+(i+.5)*df;
  const s=flat?1:1/(1+(f/400)**2);
  const abs=noA?1:Math.exp(-thorp(f)*km*(Math.LN10/10));
  let lloyd=1;
  if(!noL){
   // Match exactGain: (1-q)^2 + 4q sin^2(π f Δ/c) = (1-q)^2 + 2q(1-cos(2π f Δ/c)).
   const q=sigma===0?q0:q0*Math.exp(-2*(2*Math.PI*f/c)**2*sigma*sigma*grazing2);
   lloyd=Math.max(0,(1-q)*(1-q)+2*q*(1-cp));
   const next=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=next;
  }
  sum+=s*abs*lloyd;
 }
 return sum*df;
}

/**
 * Incorrect dB-average of absorption+Lloyd TL over the band, for contrast tests only.
 * Returns 10^(−mean_dB(TL_f)/10) · ∫ S(f) df  (same S options).
 */
export function integrateCarrierDbAvgTL(
 loHz:number,hiHz:number,
 rangeM:number,horizontalM:number,zsM:number,zrM:number,
 soundSpeed=C,sigma=0,opts:CarrierIntegralOpts={},
):number{
 const lo=Math.min(loHz,hiHz),hi=Math.max(loHz,hiHz),span=hi-lo;
 if(!(span>0)||!Number.isFinite(span))return 0;
 const n=opts.samples??defaultSamples(span);
 const df=span/n,km=Math.max(0,rangeM-1)/1000,c=Math.max(1,soundSpeed);
 let sumS=0,sumTlDb=0;
 for(let i=0;i<n;i++){
  const f=lo+(i+.5)*df;
  const s=opts.flatShape?1:sourceShape(f);
  const absDb=opts.noAbsorption?0:thorp(f)*km;
  const lloyd=opts.noLloyd?1:exactGain(f,horizontalM,zsM,zrM,c,sigma);
  const lloydDb=lloyd>0?-10*Math.log10(lloyd):300;
  sumS+=s;sumTlDb+=absDb+lloydDb;
 }
 const meanTl=sumTlDb/n;
 return sumS*df*Math.exp(-meanTl*(Math.LN10/10));
}

/** Per-contact carrier weight in linear power: SL · cav · spreading · CZ · ∫S·G_f df. */
export function carrierBandWeight(
 loHz:number,hiHz:number,
 slDb:number,cavitationPower:number,
 rangeM:number,horizontalM:number,zsM:number,zrM:number,
 spreading:Parameters<typeof spreadingLoss>[1],transition:number,
 czGain:number,soundSpeed=C,sigma=0,opts?:CarrierIntegralOpts,
):number{
 const spread=dbToPower(-spreadingLoss(rangeM,spreading,transition));
 const band=integrateCarrierSG(loHz,hiHz,rangeM,horizontalM,zsM,zrM,soundSpeed,sigma,opts);
 return dbToPower(slDb)*(.0001+(cavitationPower||0))*spread*czGain*band;
}

/** Module-level per-tick cache: engine bumpDemonWeightTick() clears between ticks. */
let demonWeightTick=0;
const demonWeightCache=new Map<string,number>();
export function bumpDemonWeightTick():void{demonWeightTick++;if(demonWeightCache.size>0)demonWeightCache.clear();}
export function demonWeightCacheSize():number{return demonWeightCache.size;}

/**
 * Spectrum-based envelope DEMON (Urick/Kinsler framing): incoherent sum of
 * band-integrated TL-weighted broadband power envelopes. Not waveform-derived DEMON.
 * Carrier bands remain an approximation until source weighting is validated.
 */
export class DemonStream {
 readonly bins=512;readonly fBin=100/511;
 private readonly signal=new Float32Array(SIZE);private readonly median=new Float32Array(512);private readonly spectrum=new Float32Array(512);private readonly fft=new FFT(SIZE);
 private readonly tables:Envelope[];private readonly weights:Float64Array;private readonly rng;
 private readonly bandLo:number;private readonly bandHi:number;
 private waterColumn:WaterColumnProfile|undefined;
 constructor(private readonly buoy:Buoy,private readonly contacts:Contact[],seed:number,band:[number,number],private environment?:Environment){
  this.bandLo=band[0];this.bandHi=band[1];this.weights=new Float64Array(contacts.length);this.rng=mulberry32(deriveSeed(seed,`demon:${buoy.id}`));
  this.tables=contacts.map(c=>{let e=envelopes.get(c.params);if(!e){e={shaft:-1,blades:0,modulation:-1,table:new Float32Array(SIZE),phase:mulberry32(deriveSeed(seed,`envelope:${c.id}`))()*2*Math.PI};envelopes.set(c.params,e);}refresh(c.params,e);return e;});
 }
 setEnvironment(e:Environment):void{this.environment=e;}
 setWaterColumn(profile:WaterColumnProfile|undefined):void{this.waterColumn=profile;}
 write(out:Float32Array,offset:number):void {
  this.signal.fill(0);let total=0;
  const e=this.environment,sigma=seaSurfaceSigma(e?.seaState??0),cSpeed=e?.soundSpeed??C;
  const spreadMode=e?.spreading??'hybrid',transition=e?.transition??1000;
  const prop=e?.propagation,czOn=prop?.czEnabled===true,czForce=prop?.czForceGainLinear;
  for(let j=0;j<this.contacts.length;j++){
   const c=this.contacts[j];
   if(c.active===false){this.weights[j]=0;continue;}
   const dx=c.x-this.buoy.x,dy=c.y-this.buoy.y,horizontal=Math.hypot(dx,dy),range=Math.hypot(horizontal,c.depth-this.buoy.depth);
   // Per-tick cache key: same contact geometry + band + env → reuse across DEMON streams/buoy rows in one tick.
   const cacheKey=`${demonWeightTick}|${this.bandLo}|${this.bandHi}|${c.id}|${range.toFixed(3)}|${horizontal.toFixed(3)}|${c.depth}|${this.buoy.depth}|${c.speed}|${sigma}|${cSpeed}|${spreadMode}|${transition}|${czOn}|${czForce??''}`;
   let w=demonWeightCache.get(cacheKey);
   if(w===undefined){
    const czEst=czOn||czForce!==undefined?czEstimateFor(this.waterColumn,c.depth,this.buoy.depth):null;
    const czGain=czForce!==undefined?czForce:czPropagationGainLinear(range,czEst,{enabled:czOn});
    w=carrierBandWeight(this.bandLo,this.bandHi,sourceLevel(c.params,c.speed,c.depth),c.params.cavitationPower??0,range,horizontal,c.depth,this.buoy.depth,spreadMode,transition,czGain,cSpeed,sigma);
    demonWeightCache.set(cacheKey,w);
   }
   this.weights[j]=w;total+=w;refresh(c.params,this.tables[j]);
  }
  if(total<=1e-30){out.fill(NaN,offset,offset+512);return;}
  for(let j=0;j<this.contacts.length;j++){const w=this.weights[j]/total;if(w<=0)continue;const table=this.tables[j].table;for(let i=0;i<SIZE;i++)this.signal[i]+=w*table[i];}
  let mean=0;for(let i=0;i<SIZE;i++){this.signal[i]+=.0001*(this.rng()-.5);mean+=this.signal[i];}mean/=SIZE;for(let i=0;i<SIZE;i++)this.signal[i]-=mean;
  this.fft.transform(this.signal,true,true);for(let i=0;i<512;i++)this.median[i]=this.spectrum[i]=(this.fft.real[i]**2+this.fft.imag[i]**2)/(SIZE*SIZE);
  const median=Math.max(1e-30,(select(this.median,255)+select(this.median,256))/2);
  for(let i=0;i<512;i++)out[offset+i]=Math.max(DEMON_DB_FLOOR,powerToDb(this.spectrum[i]/median));
 }
}
