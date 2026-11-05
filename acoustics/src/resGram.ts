import {depositHannLine,depositGaussianLine} from './lineKernel.js';
import {deriveSeed,mulberry32,gaussian,type Random} from './prng.js';
import {dbToPower,powerToDb} from './units.js';
import {geometry,createGeometry} from './kinematics.js';
import {doppler} from './doppler.js';
import {exactGain,pathDifference,seaSurfaceSigma} from './lloydsMirror.js';
import {spreadingLoss,thorp} from './transmissionLoss.js';
import {ambientLevel} from './ambientNoise.js';
import {sourceLevel,fillTonals,sourceLines} from './sourceModel.js';
import {BEARING_NOISE_K,BEARING_SNR_FLOOR} from './lofar.js';
import {RES_BINS,RES_DEFAULT,TPSW,BB_SMOOTH_OCTAVE,DIFFUSE_REFERENCE_BIN_HZ,HANN_75_AMPLITUDE_CORRELATION,resParams,resBand,gammaUnit,tpswBias,isResLevel,type ResGramSettings,type ResParams,type ResBand} from './res.js';
import type {Contact,Environment} from './scenario.js';
import type {Buoy} from './buoys.js';
import type {SpeedGated} from './catalog/drivetrain.js';
interface ResContact {contact:Contact;frequencies:Float64Array;powers:Float64Array;sigmaHz:Float64Array;gain:number;swaths:{source:SpeedGated;loHz:number;hiHz:number;lo:number;hi:number}[]}
export function normalizeResSettings(s:{res?:unknown;filter?:unknown;vernierHz?:unknown}):ResGramSettings{
 const res=s.res??RES_DEFAULT,filter=s.filter??'NB';
 if(!isResLevel(res))throw new Error('Invalid res (integer 1..9)');if(filter!=='NB'&&filter!=='BB')throw new Error("Invalid filter ('NB'|'BB')");
 if(s.vernierHz!==undefined&&(typeof s.vernierHz!=='number'||!Number.isFinite(s.vernierHz)||s.vernierHz<0||s.vernierHz>1e6))throw new Error('Invalid vernierHz');
 return s.vernierHz===undefined?{res,filter}:{res,filter,vernierHz:s.vernierHz as number};
}
/** RES-mode analytic LOFAR row (see res.ts for the zoom-FFT model and citations).
 * Bin powers are µPa² in the Hann ENBW (1.5Δf): ambient/broadband/swath PSD × 1.5Δf; tonals
 * v·|W(x)|² on the current Δf grid. Noise: χ²_ν (Welch EDOF) gamma draw, or the exact AR(1)
 * complex-Gaussian blend when K=1 (RES1–3, correlated rows). NB = signal/TPSW background dB;
 * BB = 1/24-octave smoothed absolute level dB re 1 µPa²/Hz. Bins at/after liveBins are NaN.
 * Hot path (generate) allocates nothing; configure/setEnvironment are config-time. */
export class ResLofarGenerator {
 readonly bins=RES_BINS;
 readonly row=new Float32Array(RES_BINS);
 /** Per-bin DIFAR bearing degrees true; NaN for omni and dead bins. */
 readonly bearingRow=new Float32Array(RES_BINS);
 /** Noise-free expected bin power (µPa² per ENBW), ambient included. */
 readonly expected=new Float64Array(RES_BINS);
 /** Ambient-only expected bin power. */
 readonly ambientBin=new Float64Array(RES_BINS);
 /** Noisy bin power after the χ²/AR(1) draw (linear, before NB/BB filtering). */
 readonly power=new Float64Array(RES_BINS);
 /** NB TPSW background (bias corrected) of the last NB row. */
 readonly background=new Float64Array(RES_BINS);
 private readonly signalEast=new Float64Array(RES_BINS);private readonly signalNorth=new Float64Array(RES_BINS);private readonly signalPower=new Float64Array(RES_BINS);
 private readonly shape=new Float64Array(RES_BINS);private readonly absorptionExponent=new Float64Array(RES_BINS);private readonly coherenceExponent=new Float64Array(RES_BINS);
 private readonly zr=new Float64Array(RES_BINS);private readonly zi=new Float64Array(RES_BINS);
 private readonly halfWidth=new Int32Array(RES_BINS);private readonly clipped=new Float64Array(RES_BINS);
 private readonly p0=new Float64Array(RES_BINS+1);private readonly p1=new Float64Array(RES_BINS+1);private readonly p2=new Float64Array(RES_BINS+1);private readonly p3=new Float64Array(RES_BINS+1);
 private readonly contacts:ResContact[];private readonly rng:Random;private readonly bearingRng:Random;private readonly baseSeed:number;private readonly bearingSeed:number;
 private readonly g=createGeometry();private readonly difar:boolean;private environment:Environment;private sigma=0;private bias=1;
 rowIndex=0;settings:ResGramSettings={res:RES_DEFAULT,filter:'NB'};params:ResParams=resParams(RES_DEFAULT);band:ResBand;
 constructor(readonly buoy:Buoy,contacts:Contact[],readonly fmax:number,seed:number,environment:Environment,settings:Partial<ResGramSettings>={}){
  if(!Number.isFinite(fmax)||fmax<=0)throw new Error('Invalid fmax');
  this.difar=buoy.type==='difar';this.baseSeed=deriveSeed(seed,`res:${buoy.id}`);this.bearingSeed=deriveSeed(seed,`resBearing:${buoy.id}`);this.rng=mulberry32(this.baseSeed);this.bearingRng=mulberry32(this.bearingSeed);this.environment={...environment};
  this.contacts=contacts.map(contact=>{contact.lines??=sourceLines(contact.params);const n=contact.lines.length,frequencies=new Float64Array(n),powers=new Float64Array(n),sigmaHz=new Float64Array(n);fillTonals(contact.params,frequencies,powers,contact.lines);for(let k=0;k<n;k++){const l=contact.lines[k];sigmaHz[k]=l.width==='diffuse'?(l.sigmaBins??2.5)*DIFFUSE_REFERENCE_BIN_HZ:0;}
   const swaths=(contact.params.speedGated??[]).filter(w=>w.kind==='SWATH').map(w=>({source:w,loHz:(w as {loHz:number}).loHz,hiHz:(w as {hiHz:number}).hiHz,lo:0,hi:-1}));
   return {contact,frequencies,powers,sigmaHz,swaths,gain:.9+.2*mulberry32(deriveSeed(seed,`contact:${contact.id}`))()};});
  this.band=resBand(RES_DEFAULT,undefined,fmax);this.configure(normalizeResSettings(settings));
 }
 get liveBins():number{return this.band.liveBins;}
 get f0():number{return this.band.f0;}
 get fBin():number{return this.params.fBin;}
 /** Config-time: change RES/filter/vernier. Resets the row counter and AR(1) state. */
 configure(settings:ResGramSettings):void{
  const s=normalizeResSettings(settings);this.settings=s;this.params=resParams(s.res);this.band=resBand(s.res,s.vernierHz,this.fmax);this.rowIndex=0;this.bias=tpswBias(this.params.edof);
  const df=this.params.fBin,f0=this.band.f0,L=this.band.liveBins,k=(2**(BB_SMOOTH_OCTAVE/2)-2**(-BB_SMOOTH_OCTAVE/2))/2;
  for(let i=0;i<RES_BINS;i++)this.halfWidth[i]=Math.round((f0+i*df)*k/df);
  for(const c of this.contacts)for(const w of c.swaths){w.lo=Math.max(0,Math.ceil((w.loHz-f0)/df));w.hi=Math.min(L-1,Math.floor((w.hiHz-f0)/df));}
  this.setEnvironment(this.environment);
 }
 setEnvironment(e:Environment):void{
  this.environment={...e};this.sigma=seaSurfaceSigma(e.seaState);const df=this.params.fBin,f0=this.band.f0,enbw=this.params.enbwHz;
  for(let i=0;i<RES_BINS;i++){const f=Math.max(df/2,f0+i*df),k=2*Math.PI*f/e.soundSpeed;this.coherenceExponent[i]=-2*k*k*this.sigma*this.sigma;this.absorptionExponent[i]=-thorp(f)*(Math.LN10/10);this.ambientBin[i]=i<this.band.liveBins?dbToPower(ambientLevel(f,e.seaState,e.shipping,e.shippingDensity))*enbw:NaN;this.shape[i]=1/(1+(f/400)**2);}
 }
 generate(out:Float32Array=this.row,offset=0):Float32Array{
  if(!Number.isInteger(offset)||offset<0||out.length<offset+RES_BINS)throw new Error('Row size mismatch');
  const rowKey=this.rowIndex++;this.rng.reset!((this.baseSeed+Math.imul(rowKey,0x9e3779b9))>>>0);this.bearingRng.reset!((this.bearingSeed+Math.imul(rowKey,0x9e3779b9))>>>0);
  const e=this.environment,df=this.params.fBin,enbw=this.params.enbwHz,f0=this.band.f0,L=this.band.liveBins,difar=this.difar,P=this.expected,sE=this.signalEast,sN=this.signalNorth,sP=this.signalPower;
  for(let i=0;i<L;i++)P[i]=this.ambientBin[i];if(difar){sE.fill(0);sN.fill(0);sP.fill(0);}
  for(let j=0;j<this.contacts.length;j++){
   const item=this.contacts[j],c=item.contact;if(c.active===false)continue;const g=geometry(c,this.buoy,this.g);
   fillTonals(c.params,item.frequencies,item.powers,c.lines);
   const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition)),level=dbToPower(sourceLevel(c.params,c.speed,c.depth))*item.gain*spread,km=Math.max(0,g.range-1)/1000;
   const flow=c.params.flowNoiseDb===undefined?0:dbToPower(c.params.flowNoiseDb)*(g.range<=1?1:spread*(c.params.flowRadiatedFraction??0));
   const broadband=level*(.0001+(c.params.cavitationPower??0)),imageRange=Math.hypot(g.horizontal,c.depth+this.buoy.depth),q=imageRange>0?g.range/imageRange:1,grazing2=imageRange>0?((c.depth+this.buoy.depth)/imageRange)**2:0;
   const delta=pathDifference(g.horizontal,c.depth,this.buoy.depth),phase=2*Math.PI*f0*delta/e.soundSpeed,step=2*Math.PI*df*delta/e.soundSpeed,dc=Math.cos(step),ds=Math.sin(step);let cp=Math.cos(phase),sp=Math.sin(phase);
   const sinB=Math.sin(g.bearing),cosB=Math.cos(g.bearing);
   for(let i=0;i<L;i++){const coherent=q*(this.sigma===0?1:Math.exp(this.coherenceExponent[i]*grazing2)),gain=Math.max(0,1+coherent*coherent-2*coherent*cp),contrib=(broadband*gain+flow)*this.shape[i]*Math.exp(this.absorptionExponent[i]*km)*enbw;P[i]+=contrib;if(difar){sP[i]+=contrib;sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}const next=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=next;}
   for(let s=0;s<item.swaths.length;s++){const w=item.swaths[s];if(w.source.gain>0)for(let i=w.lo;i<=w.hi;i++){const contrib=level*.0003*w.source.gain*Math.exp(this.absorptionExponent[i]*km)*enbw;P[i]+=contrib;if(difar){sP[i]+=contrib;sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}}}
   for(let k=0;k<item.frequencies.length;k++){
    const f=doppler(item.frequencies[k],g.sourceRadial,g.receiverRadial,e.soundSpeed),bin=(f-f0)/df,sigmaBins=item.sigmaHz[k]/df;
    if(bin<-2-4*sigmaBins||bin>L+1+4*sigmaBins)continue;
    const v=level*item.powers[k]*10**(-thorp(f)*km/10)*exactGain(f,g.horizontal,c.depth,this.buoy.depth,e.soundSpeed,this.sigma);
    if(sigmaBins<1)depositHannLine(P,L,bin,v,difar,sE,sN,sP,sinB,cosB);else depositGaussianLine(P,L,bin,v,sigmaBins,difar,sE,sN,sP,sinB,cosB);
   }
  }
  // Noise: K=1 → exact AR(1) on complex amplitudes (correlated rows); K>1 → unit-mean χ²_ν gamma.
  const pw=this.power,rng=this.rng;
  if(this.params.averages===1){const a=HANN_75_AMPLITUDE_CORRELATION,b=Math.sqrt(1-a*a),zr=this.zr,zi=this.zi,h=Math.SQRT1_2;
   if(rowKey===0)for(let i=0;i<L;i++){zr[i]=h*gaussian(rng);zi[i]=h*gaussian(rng);}else for(let i=0;i<L;i++){zr[i]=a*zr[i]+b*h*gaussian(rng);zi[i]=a*zi[i]+b*h*gaussian(rng);}
   for(let i=0;i<L;i++)pw[i]=P[i]*(zr[i]*zr[i]+zi[i]*zi[i]);}
  else{const shape=this.params.edof/2;for(let i=0;i<L;i++)pw[i]=P[i]*gammaUnit(rng,shape);}
  const bb=this.settings.filter==='BB';
  if(bb){const p0=this.p0;p0[0]=0;for(let i=0;i<L;i++)p0[i+1]=p0[i]+pw[i];for(let i=0;i<L;i++){const h=this.halfWidth[i],lo=Math.max(0,i-h),hi=Math.min(L-1,i+h);out[offset+i]=powerToDb((p0[hi+1]-p0[lo])/(hi-lo+1)/enbw);}}
  else{this.tpsw(L);for(let i=0;i<L;i++)out[offset+i]=powerToDb(pw[i]/this.background[i]);}
  out.fill(NaN,offset+L,offset+RES_BINS);
  this.bearingRow.fill(NaN);
  if(difar){const br=this.bearingRng,ob=this.bearingRow,amb=this.ambientBin;
   if(bb){const a0=this.p0,a1=this.p1,a2=this.p2,a3=this.p3;a0[0]=a1[0]=a2[0]=a3[0]=0;for(let i=0;i<L;i++){a0[i+1]=a0[i]+sE[i];a1[i+1]=a1[i]+sN[i];a2[i+1]=a2[i]+sP[i];a3[i+1]=a3[i]+amb[i];}
    for(let i=0;i<L;i++){const h=this.halfWidth[i],lo=Math.max(0,i-h),hi=Math.min(L-1,i+h)+1,snr=(a2[hi]-a2[lo])/(a3[hi]-a3[lo]);if(!(snr>=BEARING_SNR_FLOOR)){ob[i]=br()*360;continue;}const sigma=Math.min(90,BEARING_NOISE_K/Math.sqrt(snr));ob[i]=(Math.atan2(a0[hi]-a0[lo],a1[hi]-a1[lo])*180/Math.PI+sigma*gaussian(br)+720)%360;}}
   else for(let i=0;i<L;i++){const snr=sP[i]/amb[i];if(!(snr>=BEARING_SNR_FLOOR)){ob[i]=br()*360;continue;}const sigma=Math.min(90,BEARING_NOISE_K/Math.sqrt(snr));ob[i]=(Math.atan2(sE[i],sN[i])*180/Math.PI+sigma*gaussian(br)+720)%360;}
  }
  return out;
 }
 /** TPSW (Struzinski & Lowe 1984) over live bins, O(n) via prefix sums; result in `background`. */
 private tpsw(L:number):void{
  const x=this.power,c=this.clipped,bg=this.background,p=this.p0,N=TPSW.halfWindowBins,G=TPSW.halfGapBins,alpha=TPSW.clipFactor;
  for(let pass=0;pass<2;pass++){const src=pass===0?x:c;p[0]=0;for(let i=0;i<L;i++)p[i+1]=p[i]+src[i];
   for(let i=0;i<L;i++){const lo=Math.max(0,i-N),hi=Math.min(L-1,i+N),glo=Math.max(0,i-G),ghi=Math.min(L-1,i+G),n=(hi-lo+1)-(ghi-glo+1),mean=n>0?((p[hi+1]-p[lo])-(p[ghi+1]-p[glo]))/n:p[L]/L;
    if(pass===0){bg[i]=mean;}else bg[i]=Math.max(1e-30,mean/this.bias);}
   if(pass===0)for(let i=0;i<L;i++)c[i]=x[i]>alpha*bg[i]?bg[i]:x[i];}
 }
}
