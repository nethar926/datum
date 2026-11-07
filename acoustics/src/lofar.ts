import {lineKernel,type LineKernel} from './lineKernel.js';
import { deriveSeed, mulberry32, gaussian, type Random } from './prng.js';
import { dbToPower, powerToDb } from './units.js';
import { geometry, createGeometry } from './kinematics.js';
import { doppler } from './doppler.js';
import { exactGain,pathDifference,seaSurfaceSigma } from './lloydsMirror.js';
import { spreadingLoss, thorp } from './transmissionLoss.js';
import { ambientLevel } from './ambientNoise.js';
import { sourceLevel, fillTonals,sourceLines } from './sourceModel.js';
import type { Contact, Environment } from './scenario.js';
import type { Buoy } from './buoys.js';
interface CachedContact { contact:Contact; frequencies:Float64Array; powers:Float64Array; kernels:LineKernel[]; gain:number;swaths:{source:import('./catalog/drivetrain.js').SpeedGated;lo:number;hi:number}[] }
/** Per-bin DIFAR bearing noise: generic public cross-spectral estimator variance ~ k/√SNR
 * (Urick-level directional-receiver behaviour; illustrative, not classified sensor data).
 * sigmaDeg = min(90, BEARING_NOISE_K / sqrt(SNR)); SNR = signalPower/ambient (linear).
 * Below BEARING_SNR_FLOOR (0 dB) ambient dominates → isotropic uniform draw. */
export const BEARING_NOISE_K=20;
export const BEARING_SNR_FLOOR=1;
/** Incremental incoherent PSD renderer (Urick/Wenz). Output is PSD in dB re 1 µPa²/Hz; tonal power divided by df.
 * Independent exponential power (chi-square, 2 DOF) fluctuations per time-frequency cell.
 * Tonals use normalized precomputed Hann/Gaussian window kernels. No row-time allocations.
 * DIFAR also fills bearingRow (degrees true, 0..360) with a separate seeded RNG stream. */
export class LofarGenerator {
  readonly row:Float32Array;
  /** Per-bin true bearing degrees (0..360); NaN for omni. Same length as row. */
  readonly bearingRow:Float32Array;
  readonly lines=Array.from({length:8},()=>({freqHz:0,brgDeg:0,quality:-300}));
  lineCount=0;
  readonly ambient:Float64Array;
  readonly absorption:Float64Array;
  private readonly power:Float64Array;
  private readonly signalEast:Float64Array;
  private readonly signalNorth:Float64Array;
  private readonly signalPower:Float64Array;
  private readonly shape:Float64Array;
  private readonly absorptionExponent:Float64Array;
  private readonly coherenceExponent:Float64Array;private sigma=0;
  private readonly contacts:CachedContact[];
  private readonly rng:Random;
  private readonly bearingRng:Random;
  private readonly baseSeed:number;private readonly bearingSeed:number;private rowIndex=0;
  private readonly g=createGeometry();
  private environment:Environment;
  private readonly difar:boolean;
  bearing=0;
  constructor(readonly buoy:Buoy, contacts:Contact[],readonly bins:number,readonly fmax:number,seed:number,environment:Environment,readonly f0=0){
    this.row=new Float32Array(bins);this.bearingRow=new Float32Array(bins);this.power=new Float64Array(bins);this.signalEast=new Float64Array(bins);this.signalNorth=new Float64Array(bins);this.signalPower=new Float64Array(bins);this.ambient=new Float64Array(bins);this.absorption=new Float64Array(bins);this.shape=new Float64Array(bins);this.absorptionExponent=new Float64Array(bins);this.coherenceExponent=new Float64Array(bins);
    this.difar=buoy.type==='difar';this.baseSeed=deriveSeed(seed,`buoy:${buoy.id}`);this.bearingSeed=deriveSeed(seed,`bearing:${buoy.id}`);this.rng=mulberry32(this.baseSeed);this.bearingRng=mulberry32(this.bearingSeed);this.environment={...environment};
    this.contacts=contacts.map(contact=>{contact.lines??=sourceLines(contact.params);const frequencies=new Float64Array(contact.lines.length),powers=new Float64Array(contact.lines.length);fillTonals(contact.params,frequencies,powers,contact.lines);const df=(fmax-f0)/(bins-1),swathSources=[...(contact.params.speedGated??[]).filter(w=>w.kind==='SWATH'),...(contact.params.eventSwaths??[])],swaths=swathSources.map(w=>({source:w,lo:Math.max(0,Math.ceil(((w as {loHz:number}).loHz-f0)/df)),hi:Math.min(bins-1,Math.floor(((w as {hiHz:number}).hiHz-f0)/df))}));return {contact,frequencies,powers,swaths,kernels:contact.lines.map(l=>lineKernel(l.width,l.sigmaBins)),gain:.9+.2*mulberry32(deriveSeed(seed,`contact:${contact.id}`))()};});
    this.setEnvironment(environment);
  }
  setEnvironment(e:Environment):void {
    this.environment={...e};this.sigma=seaSurfaceSigma(e.seaState);const df=(this.fmax-this.f0)/(this.bins-1);
    for(let i=0;i<this.bins;i++){const f=Math.max(df/2,this.f0+i*df);const k=2*Math.PI*f/e.soundSpeed;this.coherenceExponent[i]=-2*k*k*this.sigma*this.sigma;this.absorption[i]=thorp(f);this.absorptionExponent[i]=-this.absorption[i]*(Math.LN10/10);this.ambient[i]=dbToPower(ambientLevel(f,e.seaState,e.shipping,e.shippingDensity));this.shape[i]=1/(1+(f/400)**2);}
  }
  generate(out=this.row,offset=0):Float32Array {
    if(!Number.isInteger(offset)||offset<0||out.length<offset+this.bins)throw new Error('Row size mismatch');
    const rowKey=this.rowIndex++;this.rng.reset!((this.baseSeed+Math.imul(rowKey,0x9e3779b9))>>>0);this.bearingRng.reset!((this.bearingSeed+Math.imul(rowKey,0x9e3779b9))>>>0);this.lineCount=0;this.power.set(this.ambient);const e=this.environment,df=(this.fmax-this.f0)/(this.bins-1);let east=0,north=0;const difar=this.difar;if(difar){this.signalEast.fill(0);this.signalNorth.fill(0);this.signalPower.fill(0);}
    for(let j=0;j<this.contacts.length;j++){
      const item=this.contacts[j],c=item.contact;if(c.active===false)continue;const g=geometry(c,this.buoy,this.g);
      fillTonals(c.params,item.frequencies,item.powers,c.lines);
      const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
      const level=dbToPower(sourceLevel(c.params,c.speed,c.depth))*item.gain*spread;
      // Smooth fictional broadband PSD; absorption per bin cached, range factor updated.
      const km=Math.max(0,g.range-1)/1000;
      const flow=c.params.flowNoiseDb===undefined?0:dbToPower(c.params.flowNoiseDb)*(g.range<=1?1:spread*(c.params.flowRadiatedFraction??0));
      const broadband=level*(.0001+(c.params.cavitationPower??0)),imageRange=Math.hypot(g.horizontal,c.depth+this.buoy.depth),q=imageRange>0?g.range/imageRange:1,grazing2=imageRange>0?((c.depth+this.buoy.depth)/imageRange)**2:0;
      const delta=pathDifference(g.horizontal,c.depth,this.buoy.depth),phase=2*Math.PI*this.f0*delta/e.soundSpeed,step=2*Math.PI*df*delta/e.soundSpeed,dc=Math.cos(step),ds=Math.sin(step);let cp=Math.cos(phase),sp=Math.sin(phase);
      const sinB=Math.sin(g.bearing),cosB=Math.cos(g.bearing);
      for(let i=0;i<this.bins;i++){const coherent=q*(this.sigma===0?1:Math.exp(this.coherenceExponent[i]*grazing2)),gain=Math.max(0,1+coherent*coherent-2*coherent*cp);const contrib=(broadband*gain+flow)*this.shape[i]*Math.exp(this.absorptionExponent[i]*km);this.power[i]+=contrib;if(difar){this.signalPower[i]+=contrib;this.signalEast[i]+=contrib*sinB;this.signalNorth[i]+=contrib*cosB;}const next=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=next;}
      for(const w of item.swaths)if(w.source.gain>0)for(let i=w.lo;i<=w.hi;i++){const contrib=level*.0003*w.source.gain*Math.exp(this.absorptionExponent[i]*km);this.power[i]+=contrib;if(difar){this.signalPower[i]+=contrib;this.signalEast[i]+=contrib*sinB;this.signalNorth[i]+=contrib*cosB;}}
      for(let k=0;k<item.frequencies.length;k++){
        const f=doppler(item.frequencies[k],g.sourceRadial,g.receiverRadial,e.soundSpeed),bin=(f-this.f0)/df;
        if(bin<0||bin>this.bins-1)continue;
        const i=Math.floor(bin);
        const v=level*item.powers[k]*10**(-thorp(f)*km/10)*exactGain(f,g.horizontal,c.depth,this.buoy.depth,e.soundSpeed,this.sigma);
        if(difar)item.kernels[k].depositBearing(this.power,this.signalEast,this.signalNorth,this.signalPower,bin,v/df,sinB,cosB);
        else item.kernels[k].deposit(this.power,bin,v/df);
        const quality=powerToDb(v/df/this.ambient[i]);
        if(quality>0){let pos=0;while(pos<this.lineCount&&this.lines[pos].quality>quality)pos++;if(pos<8){this.lineCount=Math.min(8,this.lineCount+1);for(let h=this.lineCount-1;h>pos;h--){const dst=this.lines[h],src=this.lines[h-1];dst.freqHz=src.freqHz;dst.brgDeg=src.brgDeg;dst.quality=src.quality;}const line=this.lines[pos];line.freqHz=f;line.quality=quality;line.brgDeg=(g.bearing*180/Math.PI+Math.min(90,20*10**(-quality/20))*gaussian(this.rng)+720)%360;}}
        east+=v*Math.sin(g.bearing);north+=v*Math.cos(g.bearing);
      }
    }
    // Ideal cross-spectrum beam resultant, not a multi-source bearing separator.
    this.bearing=(Math.atan2(east,north)+2*Math.PI)%(2*Math.PI);
    for(let i=0;i<this.bins;i++)out[offset+i]=powerToDb(this.power[i]*-Math.log(Math.max(this.rng(),1/4294967296)));
    if(!difar)this.bearingRow.fill(NaN);
    else{
      const br=this.bearingRng,eastA=this.signalEast,northA=this.signalNorth,sig=this.signalPower,amb=this.ambient,outB=this.bearingRow;
      for(let i=0;i<this.bins;i++){
        const snr=sig[i]/amb[i];
        if(!(snr>=BEARING_SNR_FLOOR)){outB[i]=br()*360;continue;}
        const sigma=Math.min(90,BEARING_NOISE_K/Math.sqrt(snr));
        outB[i]=(Math.atan2(eastA[i],northA[i])*180/Math.PI+sigma*gaussian(br)+720)%360;
      }
    }
    return out;
  }
}
