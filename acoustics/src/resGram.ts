import {depositHannLine,depositGaussianLine} from './lineKernel.js';
import {deriveSeed,mulberry32,gaussian,type Random} from './prng.js';
import {dbToPower,powerToDb} from './units.js';
import {geometry,createGeometry} from './kinematics.js';
import {doppler} from './doppler.js';
import {exactGain,pathDifference,seaSurfaceSigma} from './lloydsMirror.js';
import {spreadingLoss,thorp} from './transmissionLoss.js';
import {czPropagationGainLinear,czEstimateFor} from './convergenceZone.js';
import type {WaterColumnProfile} from './waterColumn.js';
import {ambientLevel} from './ambientNoise.js';
import {sourceLevel,fillTonals,sourceLines} from './sourceModel.js';
import {BEARING_NOISE_K,BEARING_SNR_FLOOR} from './lofar.js';
import {RES_FRAME_S,RES_BINS,RES_DEFAULT,TILE_BINS,TPSW,BB_SMOOTH_OCTAVE,DIFFUSE_REFERENCE_BIN_HZ,HANN_75_AMPLITUDE_CORRELATION,resParams,resBand,tileBand,gammaUnit,tpswBias,isResLevel,type ResGramSettings,type ResParams,type ResBand,type TileBand} from './res.js';
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
 * Hot path (generate / renderTile) allocates nothing; configure/setEnvironment/selectTile are config-time.
 *
 * Capacity defaults to RES_BINS=1024 (vernier path). FULLBAND passes capacity=TILE_BINS and uses
 * selectTile + renderTile so the same line physics covers an arbitrary f0 tile window. */
/** Late-read margin kept in the snapshot ring (s). */
export const RING_LATE_MARGIN_S=8;
export class ResLofarGenerator {
  private waterColumn:WaterColumnProfile|undefined;
 /** Current output width (RES_BINS vernier, or TILE_BINS for a full-axis tile). */
 bins:number;
 readonly capacity:number;
 readonly row:Float32Array;
 /** Per-bin DIFAR bearing degrees true; NaN for omni and dead bins. */
 readonly bearingRow:Float32Array;
 /** Noise-free expected bin power (µPa² per ENBW), ambient included. */
 readonly expected:Float64Array;
 /** Ambient-only expected bin power. */
 readonly ambientBin:Float64Array;
 /** Noisy bin power after the χ²/AR(1) draw (linear, before NB/BB filtering). */
 readonly power:Float64Array;
 /** NB TPSW background (bias corrected) of the last NB row. */
 readonly background:Float64Array;
 private readonly signalEast:Float64Array;private readonly signalNorth:Float64Array;private readonly signalPower:Float64Array;
 private readonly shape:Float64Array;private readonly absorptionExponent:Float64Array;private readonly coherenceExponent:Float64Array;
 private readonly zr:Float64Array;private readonly zi:Float64Array;
 private readonly halfWidth:Int32Array;private readonly clipped:Float64Array;
 private readonly p0:Float64Array;private readonly p1:Float64Array;private readonly p2:Float64Array;private readonly p3:Float64Array;
 /** Window integration (engine path): per-frame expected-spectrum snapshots on the RES_FRAME_S grid. */
 private ring:Float32Array=new Float32Array(0);private ringDifar:Float32Array=new Float32Array(0);private ringT:Float64Array=new Float64Array(0);private ringN=0;private ringHead=0;private ringCount=0;private lastSampleT=-Infinity;
 private readonly contacts:ResContact[];private readonly rng:Random;private readonly bearingRng:Random;private readonly baseSeed:number;private readonly bearingSeed:number;
 private readonly g=createGeometry();private readonly difar:boolean;private environment:Environment;private sigma=0;private bias=1;
 /** Per-tile AR(1) state for FULLBAND (K=1); vernier uses zr/zi directly. */
 private readonly tileAr=new Map<number,{zr:Float64Array;zi:Float64Array;lastRow:number}>();
 rowIndex=0;tileIndex=0;settings:ResGramSettings={res:RES_DEFAULT,filter:'NB'};params:ResParams=resParams(RES_DEFAULT);band:ResBand;
 constructor(readonly buoy:Buoy,contacts:Contact[],readonly fmax:number,seed:number,environment:Environment,settings:Partial<ResGramSettings>={},capacity:number=RES_BINS){
  if(!Number.isFinite(fmax)||fmax<=0)throw new Error('Invalid fmax');
  if(!Number.isInteger(capacity)||capacity<RES_BINS||capacity>TILE_BINS)throw new Error(`Invalid capacity (RES_BINS..TILE_BINS)`);
  this.capacity=capacity;this.bins=capacity===TILE_BINS?TILE_BINS:RES_BINS;
  this.row=new Float32Array(capacity);this.bearingRow=new Float32Array(capacity);this.expected=new Float64Array(capacity);this.ambientBin=new Float64Array(capacity);this.power=new Float64Array(capacity);this.background=new Float64Array(capacity);
  this.signalEast=new Float64Array(capacity);this.signalNorth=new Float64Array(capacity);this.signalPower=new Float64Array(capacity);
  this.shape=new Float64Array(capacity);this.absorptionExponent=new Float64Array(capacity);this.coherenceExponent=new Float64Array(capacity);
  this.zr=new Float64Array(capacity);this.zi=new Float64Array(capacity);this.halfWidth=new Int32Array(capacity);this.clipped=new Float64Array(capacity);
  this.p0=new Float64Array(capacity+1);this.p1=new Float64Array(capacity+1);this.p2=new Float64Array(capacity+1);this.p3=new Float64Array(capacity+1);
  this.difar=buoy.type==='difar';this.baseSeed=deriveSeed(seed,`res:${buoy.id}`);this.bearingSeed=deriveSeed(seed,`resBearing:${buoy.id}`);this.rng=mulberry32(this.baseSeed);this.bearingRng=mulberry32(this.bearingSeed);this.environment={...environment};
  this.contacts=contacts.map(contact=>{contact.lines??=sourceLines(contact.params);const n=contact.lines.length,frequencies=new Float64Array(n),powers=new Float64Array(n),sigmaHz=new Float64Array(n);fillTonals(contact.params,frequencies,powers,contact.lines);for(let k=0;k<n;k++){const l=contact.lines[k];sigmaHz[k]=l.width==='diffuse'?(l.sigmaBins??2.5)*DIFFUSE_REFERENCE_BIN_HZ:0;}
   const swathSources=[...(contact.params.speedGated??[]).filter(w=>w.kind==='SWATH'),...(contact.params.eventSwaths??[])],swaths=swathSources.map(w=>({source:w,loHz:(w as {loHz:number}).loHz,hiHz:(w as {hiHz:number}).hiHz,lo:0,hi:-1}));
   return {contact,frequencies,powers,sigmaHz,swaths,gain:.9+.2*mulberry32(deriveSeed(seed,`contact:${contact.id}`))()};});
  this.band=resBand(RES_DEFAULT,undefined,fmax);this.configure(normalizeResSettings(settings));
 }
 get liveBins():number{return this.band.liveBins;}
 get f0():number{return this.band.f0;}
 get fBin():number{return this.params.fBin;}
 /** Config-time: change RES/filter/vernier. Resets the row counter and AR(1) state. Vernier window is always RES_BINS. */
 configure(settings:ResGramSettings):void{
  const s=normalizeResSettings(settings);this.settings=s;this.params=resParams(s.res);this.band=resBand(s.res,s.vernierHz,this.fmax);this.bins=RES_BINS;this.tileIndex=0;this.rowIndex=0;this.tileAr.clear();this.bias=tpswBias(this.params.edof);
  this.applyWindow();this.allocRing();
 }
 /** Preallocate per-tile AR(1) buffers so renderTile stays allocation-free after setup. */
 prepareFullAxis(tileCount:number):void{
  for(let i=0;i<tileCount;i++)if(!this.tileAr.has(i))this.tileAr.set(i,{zr:new Float64Array(this.capacity),zi:new Float64Array(this.capacity),lastRow:-1});
 }
 /** FULLBAND: point the live window at tile `tileIndex` without resetting the row counter. */
 selectTile(tileIndex:number,tileBins:number=TILE_BINS):TileBand{
  if(this.capacity<tileBins)throw new Error('Generator capacity too small for tileBins');
  const t=tileBand(this.settings.res,tileIndex,this.fmax,tileBins);
  this.tileIndex=t.tileIndex;this.bins=t.tileBins;
  this.band={f0:t.f0,fcHz:t.f0+(t.tileBins/2)*t.fBin,bandLimited:t.bandLimited,liveBins:t.liveBins,slid:false};
  this.applyWindow();return t;
 }
 private applyWindow():void{
  const df=this.params.fBin,f0=this.band.f0,L=this.band.liveBins,W=this.bins,k=(2**(BB_SMOOTH_OCTAVE/2)-2**(-BB_SMOOTH_OCTAVE/2))/2;
  for(let i=0;i<W;i++)this.halfWidth[i]=Math.round((f0+i*df)*k/df);
  for(const c of this.contacts)for(const w of c.swaths){w.lo=Math.max(0,Math.ceil((w.loHz-f0)/df));w.hi=Math.min(L-1,Math.floor((w.hiHz-f0)/df));}
  this.setEnvironment(this.environment);
 }
 setWaterColumn(profile:WaterColumnProfile|undefined):void{this.waterColumn=profile;}
 setEnvironment(e:Environment):void{
  this.environment={...e};this.sigma=seaSurfaceSigma(e.seaState);const df=this.params.fBin,f0=this.band.f0,enbw=this.params.enbwHz,W=this.bins;
  for(let i=0;i<W;i++){const f=Math.max(df/2,f0+i*df),k=2*Math.PI*f/e.soundSpeed;this.coherenceExponent[i]=-2*k*k*this.sigma*this.sigma;this.absorptionExponent[i]=-thorp(f)*(Math.LN10/10);this.ambientBin[i]=i<this.band.liveBins?dbToPower(ambientLevel(f,e.seaState,e.shipping,e.shippingDensity))*enbw:NaN;this.shape[i]=1/(1+(f/400)**2);}
 }
 generate(out:Float32Array=this.row,offset=0):Float32Array{
  const rowKey=this.rowIndex++;
  return this.render(rowKey,out,offset,false);
 }
 /** Engine hook: snapshot the instantaneous expected spectrum at every RES_FRAME_S grid point up to t
  * (state is the current one; engine advances in ≤ one frame per call on the cut/worker paths). */
 sample(t:number):void{
  const f=RES_FRAME_S,L=this.band.liveBins;if(this.ringN===0)return;
  let tk=Number.isFinite(this.lastSampleT)?this.lastSampleT+f:Math.floor(t/f+1e-9)*f;if(tk>t+1e-9)return;
  this.computeExpected();const P=this.expected,sE=this.signalEast,sN=this.signalNorth,sP=this.signalPower,difar=this.difar;
  for(;tk<=t+1e-9;tk+=f){const h=this.ringHead,o=h*L;for(let i=0;i<L;i++)this.ring[o+i]=P[i];if(difar){const d=3*o;for(let i=0;i<L;i++){this.ringDifar[d+3*i]=sE[i];this.ringDifar[d+3*i+1]=sN[i];this.ringDifar[d+3*i+2]=sP[i];}}
   this.ringT[h]=tk;this.ringHead=(h+1)%this.ringN;this.ringCount=Math.min(this.ringCount+1,this.ringN);this.lastSampleT=tk;}
 }
 /** Engine path: render the row whose analysis span ends at tEnd (simT stamp = window END). */
 generateAt(tEnd:number,out:Float32Array=this.row,offset=0):Float32Array{
  const rowKey=this.rowIndex++;return this.render(rowKey,out,offset,false,tEnd);
 }
 /** Analysis span (s) of one row: K Hann segments of length T, hop T/4 → T+(K−1)·T/4. */
 get spanS():number{const p=this.params;return p.integrationS+(p.averages-1)*p.hopS;}
 /** Rows may be pulled up to this late after their due time and still integrate from the ring. */
 private allocRing():void{
  const n=Math.ceil((this.spanS+RING_LATE_MARGIN_S)/RES_FRAME_S)+2,L=this.band.liveBins;
  if(this.ringN!==n||this.ring.length!==n*L){this.ringN=n;this.ring=new Float32Array(n*L);this.ringDifar=this.difar?new Float32Array(3*n*L):new Float32Array(0);this.ringT=new Float64Array(n);}
  this.ringHead=0;this.ringCount=0;this.lastSampleT=-Infinity;
 }
 /** Welch power weighting of a snapshot interval: Σ_m Hann²(segment m) averaged over 8 sub-points
  * of the frame (ts−f, ts]. Segment m spans [tEnd−m·hop−T, tEnd−m·hop]. */
 private frameWeight(ts:number,tEnd:number):number{
  const p=this.params,T=p.integrationS,hop=p.hopS,K=p.averages,f=RES_FRAME_S;let w=0;
  for(let q=0;q<8;q++){const t=ts-f+(q+.5)*f/8;for(let m=0;m<K;m++){const x=(t-(tEnd-m*hop-T))/T;if(x>0&&x<1){const s=Math.sin(Math.PI*x);w+=s*s*s*s;}}}
  return w;
 }
 /** Replace expected/signal* with the Welch-weighted average over the row's analysis span.
  * Falls back to the instantaneous spectrum when no snapshot overlaps (cold start). */
 private integrate(tEnd:number):void{
  const L=this.band.liveBins,P=this.expected,difar=this.difar,sE=this.signalEast,sN=this.signalNorth,sP=this.signalPower;let wsum=0,first=true;
  for(let c=0;c<this.ringCount;c++){const h=(this.ringHead-1-c+this.ringN)%this.ringN,w=this.frameWeight(this.ringT[h],tEnd);if(!(w>0))continue;const o=h*L;
   if(first){for(let i=0;i<L;i++)P[i]=0;if(difar){sE.fill(0);sN.fill(0);sP.fill(0);}first=false;}
   for(let i=0;i<L;i++)P[i]+=w*this.ring[o+i];if(difar){const d=3*o;for(let i=0;i<L;i++){sE[i]+=w*this.ringDifar[d+3*i];sN[i]+=w*this.ringDifar[d+3*i+1];sP[i]+=w*this.ringDifar[d+3*i+2];}}wsum+=w;}
  if(wsum>0){const k=1/wsum;for(let i=0;i<L;i++)P[i]*=k;if(difar)for(let i=0;i<L;i++){sE[i]*=k;sN[i]*=k;sP[i]*=k;}}
 }
 /** FULLBAND: render one tile at an explicit rowKey (shared across tiles of the same row time). Does not bump rowIndex. */
 renderTile(tileIndex:number,rowKey:number,out:Float32Array=this.row,offset=0,tileBins:number=TILE_BINS):Float32Array{
  this.selectTile(tileIndex,tileBins);
  return this.render(rowKey,out,offset,true);
 }
 /** Instantaneous expected spectrum (ambient + contacts) at the current scenario state → expected/signal*. */
 private computeExpected():void{
  const e=this.environment,df=this.params.fBin,enbw=this.params.enbwHz,f0=this.band.f0,L=this.band.liveBins,difar=this.difar,P=this.expected,sE=this.signalEast,sN=this.signalNorth,sP=this.signalPower;
  for(let i=0;i<L;i++)P[i]=this.ambientBin[i];if(difar){sE.fill(0);sN.fill(0);sP.fill(0);}
  for(let j=0;j<this.contacts.length;j++){
   const item=this.contacts[j],c=item.contact;if(c.active===false)continue;const g=geometry(c,this.buoy,this.g);
   fillTonals(c.params,item.frequencies,item.powers,c.lines);
   const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
   const prop=e.propagation,czOn=prop?.czEnabled===true;
   const czEst=czOn||prop?.czForceGainLinear!==undefined?czEstimateFor(this.waterColumn,c.depth,this.buoy.depth):null;
   const czGain=prop?.czForceGainLinear!==undefined?prop.czForceGainLinear:czPropagationGainLinear(g.range,czEst,{enabled:czOn});
   const level=dbToPower(sourceLevel(c.params,c.speed,c.depth))*item.gain*spread*czGain,km=Math.max(0,g.range-1)/1000;
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
 }
 private render(rowKey:number,out:Float32Array,offset:number,perTileAr:boolean,tEnd?:number):Float32Array{
  const W=this.bins;
  if(!Number.isInteger(offset)||offset<0||out.length<offset+W)throw new Error('Row size mismatch');
  this.rng.reset!((this.baseSeed+Math.imul(rowKey,0x9e3779b9))>>>0);this.bearingRng.reset!((this.bearingSeed+Math.imul(rowKey,0x9e3779b9))>>>0);
  this.computeExpected();if(tEnd!==undefined&&!perTileAr)this.integrate(tEnd);
  const enbw=this.params.enbwHz,L=this.band.liveBins,difar=this.difar,P=this.expected,sE=this.signalEast,sN=this.signalNorth,sP=this.signalPower;
  // Noise: K=1 → exact AR(1) on complex amplitudes (correlated rows); K>1 → unit-mean χ²_ν gamma.
  const pw=this.power,rng=this.rng;
  if(this.params.averages===1){const a=HANN_75_AMPLITUDE_CORRELATION,b=Math.sqrt(1-a*a),h=Math.SQRT1_2;
   let zr=this.zr,zi=this.zi,cold=rowKey===0;
   if(perTileAr){let st=this.tileAr.get(this.tileIndex);if(!st){st={zr:new Float64Array(this.capacity),zi:new Float64Array(this.capacity),lastRow:-1};this.tileAr.set(this.tileIndex,st);}cold=st.lastRow!==rowKey-1;zr=st.zr;zi=st.zi;st.lastRow=rowKey;}
   if(cold)for(let i=0;i<L;i++){zr[i]=h*gaussian(rng);zi[i]=h*gaussian(rng);}else for(let i=0;i<L;i++){zr[i]=a*zr[i]+b*h*gaussian(rng);zi[i]=a*zi[i]+b*h*gaussian(rng);}
   // Vernier path keeps zr/zi on the instance fields when not per-tile.
   if(!perTileAr){/* already wrote this.zr/zi */}else{/* tile map holds state */}
   for(let i=0;i<L;i++)pw[i]=P[i]*(zr[i]*zr[i]+zi[i]*zi[i]);}
  else{const shape=this.params.edof/2;for(let i=0;i<L;i++)pw[i]=P[i]*gammaUnit(rng,shape);}
  const bb=this.settings.filter==='BB';
  if(bb){const p0=this.p0;p0[0]=0;for(let i=0;i<L;i++)p0[i+1]=p0[i]+pw[i];for(let i=0;i<L;i++){const h=this.halfWidth[i],lo=Math.max(0,i-h),hi=Math.min(L-1,i+h);out[offset+i]=powerToDb((p0[hi+1]-p0[lo])/(hi-lo+1)/enbw);}}
  else{this.tpsw(L);for(let i=0;i<L;i++)out[offset+i]=powerToDb(pw[i]/this.background[i]);}
  out.fill(NaN,offset+L,offset+W);
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
