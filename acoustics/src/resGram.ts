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
import {StateHistory} from './stateHistory.js';
import {RES_FRAME_S,RES_BINS,RES_DEFAULT,TILE_BINS,TPSW,BB_SMOOTH_OCTAVE,DIFFUSE_REFERENCE_BIN_HZ,HANN_75_AMPLITUDE_CORRELATION,resParams,resBand,tileBand,gammaUnit,tpswBias,isResLevel,type ResGramSettings,type ResParams,type ResBand,type TileBand} from './res.js';
import type {Contact,Environment} from './scenario.js';
import type {Buoy} from './buoys.js';
import type {SpeedGated} from './catalog/drivetrain.js';
import {resKernel,wasmKernelReady,ensureWasmKernel,wasmUploadTables,wasmClearOutputs,wasmProcessContact,wasmCopyOutputs,setResKernel,type ResKernel} from './wasm/kernel.js';
export {setResKernel,resKernel,ensureWasmKernel,wasmSimdSupported,wasmKernelStats,resetWasmKernelStats} from './wasm/kernel.js';
export type {ResKernel} from './wasm/kernel.js';
/** Bytes of the shared render scratch (counted once per process). */
export function sharedScratchBytes():number{let b=rowCacheBytes()+spanCacheBytes()+tableBytes()+accumBytes();for(const a of Object.values(SH))b+=a.byteLength;return b;}
/** Row path. 'fast' (default): per-frame spectra evaluated once per band and folded into sliding
 * per-row Welch accumulators (vernier bands and FULLBAND streams with ≤2 tiles), or a direct span
 * sum with the fast spectrum kernel (FULLBAND with more tiles). 'reference': the original exact
 * per-row re-evaluation (kept for tolerance tests). Both are deterministic. */
export type ResRowPath='fast'|'reference';
let ROW_PATH:ResRowPath='fast';
export function setResRowPath(p:ResRowPath):void{ROW_PATH=p;ACCUMS.clear();}
export function resRowPath():ResRowPath{return ROW_PATH;}
/** PROTOTYPE APPROXIMATION (Lead-approved for evaluation, NOT shipping; default OFF). When on, the
 * fast kernel evaluates the SMOOTH per-contact broadband envelope (source shape × Thorp absorption,
 * flow noise, and the slowly varying Lloyd's-mirror reflection amplitude q·exp(−2k²σ²sin²θ)) only at
 * coarse nodes (≤1/48 octave and ≤32 output bins apart) and interpolates linearly in power to the
 * output bins. The oscillatory Lloyd's-mirror phase term cos(kΔ) is still evaluated at EVERY output
 * bin, and the interference is split exactly as gain=(1−c)²+2c(1−cos kΔ) so the interpolated
 * envelope multiplies the fine-grid factor (the combined spectrum is never treated as smooth; nulls
 * stay at the exact fine-grid frequencies). Ambient is already a per-bin table (exact); spreading
 * and CZ gain are per-contact scalars (exact); tonals and swaths are exact. Reference path and
 * the flag-off fast path are unchanged. */
let COARSE_BB=false;
export function setCoarseBroadband(on:boolean):void{COARSE_BB=on;ACCUMS.clear();invalidateSpanCache();envEpoch++;}
export function coarseBroadband():boolean{return COARSE_BB;}
/** Coarse node spacing: 1/48 octave (relative step 2^(1/48)−1), clamped to [1,32] bins. */
export const COARSE_REL_STEP=2**(1/48)-1,COARSE_MAX_BINS=32;
const NODES=new Map<string,Int32Array>();
function coarseNodes(f0:number,df:number,L:number):Int32Array{
 const key=`${f0}|${df}|${L}`;let n=NODES.get(key);if(n)return n;const a:number[]=[0];
 for(let i=0;i<L-1;){const f=f0+i*df,st=Math.max(1,Math.min(COARSE_MAX_BINS,Math.floor(f*COARSE_REL_STEP/df)));i=Math.min(L-1,i+st);a.push(i);}
 n=Int32Array.from(a);NODES.set(key,n);if(NODES.size>64)NODES.delete(NODES.keys().next().value!);return n;
}
const CS={P:new Float64Array(TILE_BINS+1),E:new Float64Array(TILE_BINS+1),N:new Float64Array(TILE_BINS+1)};
/** FULLBAND streams with at most this many tiles use accumulators (memory-bounded static rule). */
export const ACCUM_MAX_TILES=2;
/** Band tables (ambient, shape, absorption/coherence exponents, BB half-widths) depend only on
 * (RES, f0, width, environment) — not on the buoy — so they are shared. LRU, bounded entries. */
interface BandTables{amb:Float64Array;shape:Float64Array;shapeEnbw:Float64Array;absE:Float64Array;cohE:Float64Array;halfWidth:Int32Array;bytes:number}
const TABLES=new Map<string,BandTables>();const TABLES_MAX=64;
function tableBytes():number{let b=0;for(const t of TABLES.values())b+=t.bytes;return b;}
/** Sliding Welch row accumulators shared by streams of the same (history, buoy, RES, band) — NB and
 * BB share one. Float32 sums (positive terms, ≤128 adds → rel. error ≲1e-5). */
class RowAccum{
 ver='';users=0;lastFold=NaN;readonly acc:Float32Array;readonly wsum:Float64Array;readonly rowE:Float64Array;readonly done:Uint8Array;
 constructor(readonly slots:number,readonly L:number,readonly q:number){this.acc=new Float32Array(slots*q*L);this.wsum=new Float64Array(slots);this.rowE=new Float64Array(slots).fill(NaN);this.done=new Uint8Array(slots);}
 reset():void{this.acc.fill(0);this.wsum.fill(0);this.rowE.fill(NaN);this.done.fill(0);this.lastFold=NaN;}
 get bytes():number{return this.acc.byteLength+this.wsum.byteLength+this.rowE.byteLength+this.done.byteLength;}
}
const ACCUMS=new Map<string,RowAccum>();
function accumBytes():number{let b=0;for(const a of ACCUMS.values())b+=a.bytes;return b;}
export function accumCount():number{return ACCUMS.size;}
/** Exact reuse of a span-averaged spectrum between streams that share (buoy, RES, window, tEnd) —
 * NB and BB of the same vernier band. Two entries of RES_BINS (reference path only; counted in
 * sharedScratchBytes). The cached arrays are copies of the same float64 computation, so rows are
 * bit-identical to recomputing. */
const ROW_CACHE_ENTRIES=2;
const ROW_CACHE=Array.from({length:ROW_CACHE_ENTRIES},()=>({key:'',L:0,P:new Float64Array(RES_BINS),E:new Float64Array(RES_BINS),N:new Float64Array(RES_BINS),S:new Float64Array(RES_BINS)}));
let rowCacheNext=0,envEpoch=0;
export function rowCacheBytes():number{let b=0;for(const c of ROW_CACHE)b+=c.P.byteLength*4;return b;}
/** Exact reuse of a span-averaged spectrum for the fast integrateHistory path (FULLBAND with
 * >ACCUM_MAX_TILES tiles, where sliding accumulators are not used). NB and BB of the same
 * (buoy, RES, f0, liveBins, tEnd) share one entry — the pre-filter modelled spectrum is
 * bit-identical across filters. Capacity = 8 (one RES2 tile set) with ring eviction: fixed bytes,
 * never grows with run length; counted in sharedScratchBytes. Stores P/E/N only (S = max(0,P−amb)
 * recomputed on hit — same formula as the miss path). Default ON; `setSpanCache(false)` disables
 * for bench isolation (test/bench only). Separate from FE retained display history — eviction must
 * never touch emitted rows. */
export const SPAN_CACHE_ENTRIES=8;
const SPAN_CACHE=Array.from({length:SPAN_CACHE_ENTRIES},()=>({key:'',L:0,P:new Float64Array(TILE_BINS),E:new Float64Array(TILE_BINS),N:new Float64Array(TILE_BINS)}));
let spanCacheNext=0,spanCacheHits=0,spanCacheMisses=0,spanCacheOn=true,spanEpoch=1;
export function spanCacheBytes():number{let b=0;for(const c of SPAN_CACHE)b+=c.P.byteLength*3;return b;}
export function spanCacheStats():{hits:number;misses:number;entries:number;enabled:boolean;epoch:number}{return {hits:spanCacheHits,misses:spanCacheMisses,entries:SPAN_CACHE_ENTRIES,enabled:spanCacheOn,epoch:spanEpoch};}
export function resetSpanCacheStats():void{spanCacheHits=0;spanCacheMisses=0;}
export function spanCacheEnabled():boolean{return spanCacheOn;}
/** Bench/test toggle. Disabling clears entries so a cold path is measured. Default remains ON. */
export function setSpanCache(on:boolean):void{spanCacheOn=on;clearSpanCache();}
/** Drop all entries and bump the generation id so keys cannot match a prior scenario/config. */
export function invalidateSpanCache():void{spanEpoch++;clearSpanCache();}
function clearSpanCache():void{for(const c of SPAN_CACHE)c.key='';spanCacheNext=0;}
interface Trk{x:number;y:number;depth:number;course:number;speed:number}
interface ResContact {contact:Contact;frequencies:Float64Array;powers:Float64Array;sigmaHz:Float64Array;gain:number;trk:Trk;act:boolean;srcDb:number;flowDb:number;flowFrac:number;cav:number;swG:Float64Array;swLo:Float64Array;swHi:Float64Array;swaths:{source:SpeedGated;loHz:number;hiHz:number;lo:number;hi:number}[]}
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
/** Shared scratch (single-threaded engine): every generator renders into these, so per-stream
 * retained memory is only its band tables, output row and AR(1) state. Read `expected` etc.
 * immediately after a render. */
const SH=(()=>{const n=TILE_BINS+1,f=()=>new Float64Array(n);return {P:f(),E:f(),N:f(),S:f(),FP:f(),FE:f(),FN:f(),FS:f(),power:f(),background:f(),clipped:f(),p0:f(),p1:f(),p2:f(),p3:f(),ab:f()};})();
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
 ambientBin:Float64Array;
 /** Noisy bin power after the χ²/AR(1) draw (linear, before NB/BB filtering). */
 readonly power:Float64Array;
 /** NB TPSW background (bias corrected) of the last NB row. */
 readonly background:Float64Array;
 private readonly signalEast:Float64Array;private readonly signalNorth:Float64Array;private readonly signalPower:Float64Array;
 private shape:Float64Array;private shapeEnbw:Float64Array;private absorptionExponent:Float64Array;private coherenceExponent:Float64Array;
 /** AR(1) state (K=1 only, allocated on demand; Float32). */
 private zr:Float32Array;private zi:Float32Array;
 private halfWidth:Int32Array;private readonly clipped:Float64Array;private tablesKey='';
 private readonly tileTables=new Map<number,{key:string;bins:number;t:BandTables}>();private readonly held=new Map<string,RowAccum>();
 private readonly p0:Float64Array;private readonly p1:Float64Array;private readonly p2:Float64Array;private readonly p3:Float64Array;
 /** Engine-wide source-state history (stateHistory.ts); null → snapshot fallback only. */
 private history:StateHistory|null=null;private buoyRing:Float64Array|null=null;private readonly bt:Trk={x:0,y:0,depth:0,course:0,speed:0};
 private fullAxisTiles=0;
 /** True when the last row was a real span average; false = explicit snapshot fallback (direct generate()/renderTile without history). */
 lastIntegrated=false;
 /** Count of rows that fell back to an instantaneous snapshot (diagnostic; cut/live paths keep this 0). */
 snapshotFallbacks=0;
 private readonly contacts:ResContact[];private readonly rng:Random;private readonly bearingRng:Random;private readonly baseSeed:number;private readonly bearingSeed:number;
 private readonly g=createGeometry();private readonly difar:boolean;private environment:Environment;private sigma=0;private bias=1;
 /** Per-tile AR(1) state for FULLBAND (K=1); vernier uses zr/zi directly. */
 private readonly tileAr=new Map<number,{zr:Float32Array;zi:Float32Array;lastRow:number}>();
 rowIndex=0;tileIndex=0;settings:ResGramSettings={res:RES_DEFAULT,filter:'NB'};params:ResParams=resParams(RES_DEFAULT);band:ResBand;
 constructor(readonly buoy:Buoy,contacts:Contact[],readonly fmax:number,seed:number,environment:Environment,settings:Partial<ResGramSettings>={},capacity:number=RES_BINS){
  if(!Number.isFinite(fmax)||fmax<=0)throw new Error('Invalid fmax');
  if(!Number.isInteger(capacity)||capacity<RES_BINS||capacity>TILE_BINS)throw new Error(`Invalid capacity (RES_BINS..TILE_BINS)`);
  this.capacity=capacity;this.bins=capacity===TILE_BINS?TILE_BINS:RES_BINS;
  this.row=new Float32Array(capacity);this.bearingRow=new Float32Array(capacity);this.expected=SH.P;this.ambientBin=SH.FP;this.power=SH.power;this.background=SH.background;
  this.signalEast=SH.E;this.signalNorth=SH.N;this.signalPower=SH.S;
  this.shape=this.shapeEnbw=this.absorptionExponent=this.coherenceExponent=SH.FP;
  this.zr=this.zi=new Float32Array(0);this.halfWidth=new Int32Array(0);this.clipped=SH.clipped;
  this.p0=SH.p0;this.p1=SH.p1;this.p2=SH.p2;this.p3=SH.p3;
  this.difar=buoy.type==='difar';this.baseSeed=deriveSeed(seed,`res:${buoy.id}`);this.bearingSeed=deriveSeed(seed,`resBearing:${buoy.id}`);this.rng=mulberry32(this.baseSeed);this.bearingRng=mulberry32(this.bearingSeed);this.environment={...environment};this.sigma=seaSurfaceSigma(environment.seaState);
  this.contacts=contacts.map(contact=>{contact.lines??=sourceLines(contact.params);const n=contact.lines.length,frequencies=new Float64Array(n),powers=new Float64Array(n),sigmaHz=new Float64Array(n);fillTonals(contact.params,frequencies,powers,contact.lines);for(let k=0;k<n;k++){const l=contact.lines[k];sigmaHz[k]=l.width==='diffuse'?(l.sigmaBins??2.5)*DIFFUSE_REFERENCE_BIN_HZ:0;}
   const swathSources=[...(contact.params.speedGated??[]).filter(w=>w.kind==='SWATH'),...(contact.params.eventSwaths??[])],swaths=swathSources.map(w=>({source:w,loHz:(w as {loHz:number}).loHz,hiHz:(w as {hiHz:number}).hiHz,lo:0,hi:-1}));
   return {contact,frequencies,powers,sigmaHz,swaths,gain:.9+.2*mulberry32(deriveSeed(seed,`contact:${contact.id}`))(),trk:{x:0,y:0,depth:0,course:0,speed:0} as Trk,act:true,srcDb:0,flowDb:NaN,flowFrac:0,cav:0,swG:new Float64Array(swaths.length),swLo:new Float64Array(swaths.length),swHi:new Float64Array(swaths.length)};});
  this.band=resBand(RES_DEFAULT,undefined,fmax);this.configure(normalizeResSettings(settings));
 }
 get liveBins():number{return this.band.liveBins;}
 get f0():number{return this.band.f0;}
 get fBin():number{return this.params.fBin;}
 /** Config-time: change RES/filter/vernier. Resets the row counter and AR(1) state. Vernier window is always RES_BINS. */
 configure(settings:ResGramSettings):void{
  const s=normalizeResSettings(settings);this.settings=s;this.params=resParams(s.res);this.band=resBand(s.res,s.vernierHz,this.fmax);this.bins=RES_BINS;this.tileIndex=0;this.rowIndex=0;this.tileAr.clear();this.tileTables.clear();this.releaseAccum();this.bias=tpswBias(this.params.edof);
  if(this.params.averages===1&&this.zr.length!==this.capacity){this.zr=new Float32Array(this.capacity);this.zi=new Float32Array(this.capacity);}
  this.applyWindow();this.prepareAccums();
 }
 /** Preallocate per-tile AR(1) buffers so renderTile stays allocation-free after setup. */
 /** Retained bytes owned by this generator (band tables, output rows, AR(1) state). Shared scratch and
  * the engine StateHistory are counted once by the engine. */
 retainedBytes():number{let b=this.row.byteLength+this.bearingRow.byteLength+this.zr.byteLength+this.zi.byteLength;for(const a of this.tileAr.values())b+=a.zr.byteLength+a.zi.byteLength;return b;}
 /** FULLBAND: AR(1) state per tile only when rows are single FFTs (K=1, RES1–3). No tile history. */
 prepareFullAxis(tileCount:number,_visibleTileIndex=0):void{
  this.fullAxisTiles=tileCount;this.releaseAccum();this.prepareAccums();if(this.params.averages!==1)return;
  for(let i=0;i<tileCount;i++)if(!this.tileAr.has(i))this.tileAr.set(i,{zr:new Float32Array(this.capacity),zi:new Float32Array(this.capacity),lastRow:-1});
 }
 /** Attach the engine-wide state history (same contact list/order as this generator). */
 setHistory(h:StateHistory|null):void{if(h&&h.contacts.length!==this.contacts.length)throw new Error('History contact list mismatch');this.history=h;this.buoyRing=h?h.buoyRing(this.buoy):null;this.releaseAccum();this.prepareAccums();}
 /** FULLBAND: point the live window at tile `tileIndex` without resetting the row counter. */
 selectTile(tileIndex:number,tileBins:number=TILE_BINS):TileBand{
  if(this.capacity<tileBins)throw new Error('Generator capacity too small for tileBins');
  const t=tileBand(this.settings.res,tileIndex,this.fmax,tileBins);
  this.tileIndex=t.tileIndex;this.bins=t.tileBins;
  this.band={f0:t.f0,fcHz:t.f0+(t.tileBins/2)*t.fBin,bandLimited:t.bandLimited,liveBins:t.liveBins,slid:false};
  this.applyWindow();return t;
 }
 private applyWindow():void{this.useTables();this.applySwathWindow();}
 /** Point this generator at the shared band tables for its current window (built on first use). */
 private useTables():void{
  const e=this.environment,tc=this.fullAxisTiles>0?this.tileTables.get(this.tileIndex):undefined;
  if(tc&&tc.bins===this.bins&&TABLES.get(tc.key)===tc.t){this.setTables(tc.key,tc.t);return;}
  const key=`${this.settings.res}|${this.band.f0}|${this.bins}|${this.band.liveBins}|${e.seaState}|${e.shipping}|${e.shippingDensity}|${e.soundSpeed}`;
  let t=TABLES.get(key);if(t){TABLES.delete(key);TABLES.set(key,t);}else{t=this.buildTables();TABLES.set(key,t);if(TABLES.size>TABLES_MAX)TABLES.delete(TABLES.keys().next().value!);}
  if(this.fullAxisTiles>0)this.tileTables.set(this.tileIndex,{key,bins:this.bins,t});this.setTables(key,t);
 }
 private setTables(key:string,t:BandTables):void{this.tablesKey=key;this.ambientBin=t.amb;this.shape=t.shape;this.shapeEnbw=t.shapeEnbw;this.absorptionExponent=t.absE;this.coherenceExponent=t.cohE;this.halfWidth=t.halfWidth;}
 private buildTables():BandTables{
  const e=this.environment,df=this.params.fBin,f0=this.band.f0,enbw=this.params.enbwHz,W=this.bins,L=this.band.liveBins,k=(2**(BB_SMOOTH_OCTAVE/2)-2**(-BB_SMOOTH_OCTAVE/2))/2,sigma=seaSurfaceSigma(e.seaState);
  const amb=new Float64Array(W),shape=new Float64Array(W),shapeEnbw=new Float64Array(W),absE=new Float64Array(W),cohE=new Float64Array(W),halfWidth=new Int32Array(W);
  for(let i=0;i<W;i++){halfWidth[i]=Math.round((f0+i*df)*k/df);const f=Math.max(df/2,f0+i*df),kk=2*Math.PI*f/e.soundSpeed;cohE[i]=-2*kk*kk*sigma*sigma;absE[i]=-thorp(f)*(Math.LN10/10);amb[i]=i<L?dbToPower(ambientLevel(f,e.seaState,e.shipping,e.shippingDensity))*enbw:NaN;shape[i]=1/(1+(f/400)**2);shapeEnbw[i]=shape[i]*enbw;}
  return {amb,shape,shapeEnbw,absE,cohE,halfWidth,bytes:W*(5*8+4)};
 }
 private applySwathWindow():void{const df=this.params.fBin,f0=this.band.f0,L=this.band.liveBins;for(const c of this.contacts)for(const w of c.swaths){w.lo=Math.max(0,Math.ceil((w.loHz-f0)/df));w.hi=Math.min(L-1,Math.floor((w.hiHz-f0)/df));}}
 setWaterColumn(profile:WaterColumnProfile|undefined):void{this.waterColumn=profile;}
 setEnvironment(e:Environment):void{envEpoch++;invalidateSpanCache();this.environment={...e};this.sigma=seaSurfaceSigma(e.seaState);this.tileTables.clear();this.useTables();}
 /** Release shared accumulators (engine calls on unsubscribe / generator replacement). */
 dispose():void{this.releaseAccum();}
 /** Acquire (allocate on first use) the shared accumulator for (history, buoy, RES, f0, L). Called at
  * config time for the stream's band/tiles so the row path allocates nothing. */
 private accumFor(f0:number,L:number):RowAccum{
  const h=this.history!,f=RES_FRAME_S,p=this.params,rpF=Math.max(1,Math.round(p.rowPeriodS/f)),spanF=Math.ceil(this.spanS/f-1e-9),slots=Math.ceil(spanF/rpF)+1,q=this.difar?3:1;
  const id=`${h.uid}|${this.historyBuoyKey()}|${this.settings.res}|${f0}|${L}|${q}`;
  let A=this.held.get(id);if(A)return A;let a=ACCUMS.get(id);if(!a||a.slots!==slots||a.L!==L||a.q!==q){a=new RowAccum(slots,L,q);ACCUMS.set(id,a);}a.users++;this.held.set(id,a);return a;
 }
 private prepareAccums():void{
  if(!this.history||ROW_PATH!=='fast')return;
  if(this.fullAxisTiles>0){if(this.fullAxisTiles<=ACCUM_MAX_TILES)for(let i=0;i<this.fullAxisTiles;i++){const t=tileBand(this.settings.res,i,this.fmax,TILE_BINS);this.accumFor(t.f0,t.liveBins);}}
  else this.accumFor(this.band.f0,this.band.liveBins);
 }
 private releaseAccum():void{for(const [k,a] of this.held)if(--a.users<=0&&ACCUMS.get(k)===a)ACCUMS.delete(k);this.held.clear();}
 generate(out:Float32Array=this.row,offset=0):Float32Array{
  const rowKey=this.rowIndex++;
  return this.render(rowKey,out,offset,false);
 }
 /** Engine path: render the row whose analysis span ends at tEnd (simT stamp = END of span). */
 generateAt(tEnd:number,out:Float32Array=this.row,offset=0):Float32Array{
  const rowKey=this.rowIndex++;return this.render(rowKey,out,offset,false,tEnd);
 }
 /** Analysis span (s) of one row: K Hann segments of length T, hop T/4 → T+(K−1)·T/4. */
 get spanS():number{const p=this.params;return p.integrationS+(p.averages-1)*p.hopS;}
 /** Welch power weighting of a record interval: Σ_m Hann²(segment m) averaged over 8 sub-points
  * of the frame (ts−f, ts]. Segment m spans [tEnd−m·hop−T, tEnd−m·hop]. */
 private frameWeight(ts:number,tEnd:number):number{
  const p=this.params,T=p.integrationS,hop=p.hopS,K=p.averages,f=RES_FRAME_S;let w=0;
  for(let q=0;q<8;q++){const t=ts-f+(q+.5)*f/8;for(let m=0;m<K;m++){const x=(t-(tEnd-m*hop-T))/T;if(x>0&&x<1){const s=Math.sin(Math.PI*x);w+=s*s*s*s;}}}
  return w;
 }
 /** Welch-weighted average of the modelled spectrum re-evaluated at every recorded frame in the
  * span → expected/signal*. False (snapshot fallback) when history does not cover the span.
  * When fast=true, the finished span average is stored in SPAN_CACHE so a second stream with the
  * same (buoy, RES, f0, L, tEnd) — typically FULLBAND BB after NB — reuses it bit-identically. */
 private integrateHistory(tEnd:number,fast=false):boolean{
  const h=this.history;if(!h||h.count===0)return false;const f=RES_FRAME_S,span=this.spanS,newest=h.t[h.slot(0)]!,oldest=h.t[h.slot(h.count-1)]!;
  if(newest<tEnd-1e-6||oldest-f>tEnd-span+1e-6)return false;
  const L=this.band.liveBins,difar=this.difar;
  let spanKey='';
  if(fast&&spanCacheOn){
   spanKey=`${spanEpoch}|${h.uid}|${this.historyBuoyKey()}|${this.settings.res}|${this.band.f0}|${L}|${tEnd}|${envEpoch}|${difar?1:0}|${COARSE_BB?1:0}|${h.last}`;
   for(const c of SPAN_CACHE)if(c.key===spanKey){const amb=this.ambientBin;SH.P.set(c.P.subarray(0,L));if(difar){SH.E.set(c.E.subarray(0,L));SH.N.set(c.N.subarray(0,L));for(let i=0;i<L;i++)SH.S[i]=Math.max(0,SH.P[i]!-amb[i]!);}spanCacheHits++;return true;}
  }
  const P=SH.P,E=SH.E,N=SH.N,S=SH.S,FP=SH.FP,FE=SH.FE,FN=SH.FN,FS=SH.FS;let wsum=0;
  P.fill(0,0,L);if(difar){E.fill(0,0,L);N.fill(0,0,L);S.fill(0,0,L);}
  for(let c=0;c<h.count;c++){const sl=h.slot(c),ts=h.t[sl]!;if(ts<=tEnd-span-1e-9)break;if(ts>tEnd+f)continue;const w=this.frameWeight(ts,tEnd);if(!(w>0))continue;
   this.loadFrame(sl);if(fast){this.coreFast(FP,FE,FN,FS);if(difar)for(let i=0;i<L;i++){P[i]+=w*FP[i]!;E[i]+=w*FE[i]!;N[i]+=w*FN[i]!;}else for(let i=0;i<L;i++)P[i]+=w*FP[i]!;}
   else{this.core(FP,FE,FN,FS);for(let i=0;i<L;i++)P[i]+=w*FP[i]!;if(difar)for(let i=0;i<L;i++){E[i]+=w*FE[i]!;N[i]+=w*FN[i]!;S[i]+=w*FS[i]!;}}wsum+=w;}
  if(!(wsum>0))return false;const k=1/wsum,amb=this.ambientBin;for(let i=0;i<L;i++)P[i]*=k;if(difar){if(fast)for(let i=0;i<L;i++){E[i]*=k;N[i]*=k;S[i]=Math.max(0,P[i]!-amb[i]!);}else for(let i=0;i<L;i++){E[i]*=k;N[i]*=k;S[i]*=k;}}
  if(fast&&spanCacheOn){const c=SPAN_CACHE[spanCacheNext]!;spanCacheNext=(spanCacheNext+1)%SPAN_CACHE_ENTRIES;c.key=spanKey;c.L=L;c.P.set(P.subarray(0,L));if(difar){c.E.set(E.subarray(0,L));c.N.set(N.subarray(0,L));}spanCacheMisses++;}
  return true;
 }
 private integrateCached(tEnd:number):boolean{
  const L=this.band.liveBins;if(L>RES_BINS)return this.integrateHistory(tEnd);
  const key=`${this.history?.uid??0}|${this.historyBuoyKey()}|${this.settings.res}|${this.band.f0}|${L}|${tEnd}|${envEpoch}|${this.difar?1:0}|${this.history?.last}`;
  for(const c of ROW_CACHE)if(c.key===key){SH.P.set(c.P.subarray(0,L));if(this.difar){SH.E.set(c.E.subarray(0,L));SH.N.set(c.N.subarray(0,L));SH.S.set(c.S.subarray(0,L));}return true;}
  if(!this.integrateHistory(tEnd))return false;
  const c=ROW_CACHE[rowCacheNext]!;rowCacheNext=(rowCacheNext+1)%ROW_CACHE_ENTRIES;c.key=key;c.L=L;c.P.set(SH.P.subarray(0,L));if(this.difar){c.E.set(SH.E.subarray(0,L));c.N.set(SH.N.subarray(0,L));c.S.set(SH.S.subarray(0,L));}
  return true;
 }
 private integrateRow(tEnd:number,perTile:boolean):boolean{
  if(ROW_PATH==='reference')return perTile?this.integrateHistory(tEnd):this.integrateCached(tEnd);
  if(!perTile||this.fullAxisTiles<=ACCUM_MAX_TILES){const r=this.integrateAccum(tEnd);if(r!==null)return r;}
  return this.integrateHistory(tEnd,true);
 }
 /** Fast path: sliding per-row Welch accumulators. Each 0.25 s frame's modelled spectrum is evaluated
  * once per (buoy, band) and added, Hann²-weighted, to every open row whose span contains it, in
  * ascending frame order — so a row's sum is the same whether it was reached by continuous play,
  * seek or replay. Null → not applicable (off-grid row); false → history does not cover the span. */
 private integrateAccum(tEnd:number):boolean|null{
  const h=this.history;if(!h||h.count===0)return false;const f=RES_FRAME_S,e=Math.round(tEnd/f);if(Math.abs(e*f-tEnd)>1e-7)return null;
  const span=this.spanS,newest=h.t[h.slot(0)]!,oldest=h.t[h.slot(h.count-1)]!;
  if(newest<tEnd-1e-6||oldest-f>tEnd-span+1e-6)return false;
  const p=this.params,rpF=Math.max(1,Math.round(p.rowPeriodS/f)),spanF=Math.ceil(span/f-1e-9),R=Math.ceil(spanF/rpF),slots=R+1,L=this.band.liveBins,q=this.difar?3:1;
  const A=this.accumFor(this.band.f0,L);
  const ver=`${this.tablesKey}|${envEpoch}|${COARSE_BB?1:0}`;if(A.ver!==ver){A.reset();A.ver=ver;}
  const slotOf=(x:number)=>((Math.round(x/rpF)%slots)+slots)%slots,s=slotOf(e);
  if(!(A.rowE[s]===e&&A.done[s]===1)){
   const open=(x:number)=>{const k=slotOf(x);if(A.rowE[k]===x)return;A.rowE[k]=x;A.done[k]=0;A.wsum[k]=0;A.acc.fill(0,k*q*L,(k+1)*q*L);};
   let from:number;
   if(A.lastFold===e-rpF&&((A.rowE[s]===e&&A.done[s]===0)||spanF<=rpF)){from=e-rpF+1;open(e);open(e+(R-1)*rpF);}
   else{A.reset();A.ver=ver;for(let r=0;r<R;r++)open(e+r*rpF);from=e-spanF+1;}
   const FP=SH.FP,FE=SH.FE,FN=SH.FN,FS=SH.FS,acc=A.acc,jn=Math.round(h.last/f);
   for(let j=from;j<=e;j++){const c=jn-j;if(c<0||c>=h.count)continue;const sl=h.slot(c),ts=h.t[sl]!;let loaded=false;
    for(let k=0;k<slots;k++){const x=A.rowE[k]!;if(!(x>=j)||A.done[k])continue;const w=this.frameWeight(ts,x*f);if(!(w>0))continue;
     if(!loaded){this.loadFrame(sl);this.coreFast(FP,FE,FN,FS);loaded=true;}
     const o=k*q*L;for(let i=0;i<L;i++)acc[o+i]+=w*FP[i]!;if(q===3){const oe=o+L,on=o+2*L;for(let i=0;i<L;i++){acc[oe+i]+=w*FE[i]!;acc[on+i]+=w*FN[i]!;}}A.wsum[k]+=w;}}
   A.lastFold=e;A.done[s]=1;
  }
  const wsum=A.wsum[s]!;if(!(wsum>0))return false;const kk=1/wsum,o=s*q*L,acc=A.acc,P=SH.P,amb=this.ambientBin;
  for(let i=0;i<L;i++)P[i]=acc[o+i]!*kk;
  if(q===3){const E=SH.E,N=SH.N,S=SH.S;for(let i=0;i<L;i++){E[i]=acc[o+L+i]!*kk;N[i]=acc[o+2*L+i]!*kk;S[i]=Math.max(0,P[i]!-amb[i]!);}}
  return true;
 }
 /** Same model as core() with per-bin exps replaced by a chunked exp recurrence (fast path):
  * exp(X[i]·s) with bin 0 exact, then 32-bin chunks whose exponent is the quadratic through the
  * chunk's first, middle and last bins — exact for the f² coherence exponent; for the smooth
  * rational absorption exponent the residual is its third difference. 3 exp per chunk instead of
  * one per bin. */
 private coreFast(P:Float64Array,sE:Float64Array,sN:Float64Array,sP:Float64Array):void{
  if(COARSE_BB){this.coreCoarse(P,sE,sN,sP);return;}
  if(resKernel()==='wasm'&&wasmKernelReady()){this.coreFastWasm(P,sE,sN,sP);return;}
  const e=this.environment,df=this.params.fBin,enbw=this.params.enbwHz,f0=this.band.f0,L=this.band.liveBins,difar=this.difar,bt=this.bt,AB=SH.ab,se=this.shapeEnbw,amb=this.ambientBin,coh=this.sigma!==0;
  for(let i=0;i<L;i++)P[i]=amb[i]!;if(difar){sE.fill(0,0,L);sN.fill(0,0,L);sP.fill(0,0,L);}
  for(let j=0;j<this.contacts.length;j++){
   const item=this.contacts[j]!,c=item.trk;if(!item.act)continue;const g=geometry(c,bt,this.g);
   const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
   const prop=e.propagation,czOn=prop?.czEnabled===true;
   const czEst=czOn||prop?.czForceGainLinear!==undefined?czEstimateFor(this.waterColumn,c.depth,bt.depth):null;
   const czGain=prop?.czForceGainLinear!==undefined?prop.czForceGainLinear:czPropagationGainLinear(g.range,czEst,{enabled:czOn});
   const level=dbToPower(item.srcDb)*item.gain*spread*czGain,km=Math.max(0,g.range-1)/1000;
   const flow=Number.isNaN(item.flowDb)?0:dbToPower(item.flowDb)*(g.range<=1?1:spread*item.flowFrac);
   const broadband=level*(.0001+item.cav),imageRange=Math.hypot(g.horizontal,c.depth+bt.depth),q=imageRange>0?g.range/imageRange:1,grazing2=imageRange>0?((c.depth+bt.depth)/imageRange)**2:0;
   const delta=pathDifference(g.horizontal,c.depth,bt.depth),phase=2*Math.PI*f0*delta/e.soundSpeed,step=2*Math.PI*df*delta/e.soundSpeed,dc=Math.cos(step),ds=Math.sin(step);let cp=Math.cos(phase),sp=Math.sin(phase);
   const sinB=Math.sin(g.bearing),cosB=Math.cos(g.bearing);
   // Absorption/coherence factors by the chunked exp recurrence, fused into the bin loop.
   const AE=this.absorptionExponent,CE=this.coherenceExponent,keep=item.swaths.length>0;
   for(let i0=0;i0<L;){const n=i0===0?1:Math.min(32,L-i0);let va:number,ra:number,rra:number,vc=1,rc=1,rrc=1;
    if(n<3){va=Math.exp(AE[i0]!*km);ra=n>1?Math.exp((AE[i0+1]!-AE[i0]!)*km):1;rra=1;if(coh){vc=Math.exp(CE[i0]!*grazing2);rc=n>1?Math.exp((CE[i0+1]!-CE[i0]!)*grazing2):1;}}
    else{const hh=(n-1)>>1,h2=n-1;let x0=AE[i0]!*km,x1=AE[i0+hh]!*km,x2=AE[i0+h2]!*km,bq=((x2-x0)/h2-(x1-x0)/hh)/(h2-hh),aq=(x1-x0)/hh-bq*hh;va=Math.exp(x0);ra=Math.exp(aq+bq);rra=Math.exp(2*bq);
     if(coh){x0=CE[i0]!*grazing2;x1=CE[i0+hh]!*grazing2;x2=CE[i0+h2]!*grazing2;bq=((x2-x0)/h2-(x1-x0)/hh)/(h2-hh);aq=(x1-x0)/hh-bq*hh;vc=Math.exp(x0);rc=Math.exp(aq+bq);rrc=Math.exp(2*bq);}}
    const i1=i0+n;
    if(difar&&!keep)for(let i=i0;i<i1;i++){const coherent=q*vc,gain=Math.max(0,1+coherent*coherent-2*coherent*cp),contrib=(broadband*gain+flow)*se[i]!*va;P[i]+=contrib;sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;
     const next=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=next;va*=ra;ra*=rra;vc*=rc;rc*=rrc;}
    else for(let i=i0;i<i1;i++){const coherent=q*vc,gain=Math.max(0,1+coherent*coherent-2*coherent*cp),contrib=(broadband*gain+flow)*se[i]!*va;P[i]+=contrib;if(difar){sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}if(keep)AB[i]=va;
     const next=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=next;va*=ra;ra*=rra;vc*=rc;rc*=rrc;}
    i0=i1;}
   for(let s=0;s<item.swaths.length;s++){const gs=item.swG[s]!;if(gs>0){const lo=Math.max(0,Math.ceil((item.swLo[s]!-f0)/df)),hi=Math.min(L-1,Math.floor((item.swHi[s]!-f0)/df)),lv=level*.0003*gs*enbw;for(let i=lo;i<=hi;i++){const contrib=lv*AB[i]!;P[i]+=contrib;if(difar){sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}}}}
   for(let k=0;k<item.frequencies.length;k++){
    const f=doppler(item.frequencies[k],g.sourceRadial,g.receiverRadial,e.soundSpeed),bin=(f-f0)/df,sigmaBins=item.sigmaHz[k]/df;
    if(bin<-2-4*sigmaBins||bin>L+1+4*sigmaBins)continue;
    const v=level*item.powers[k]*10**(-thorp(f)*km/10)*exactGain(f,g.horizontal,c.depth,bt.depth,e.soundSpeed,this.sigma);
    if(sigmaBins<1)depositHannLine(P,L,bin,v,difar,sE,sN,sP,sinB,cosB);else depositGaussianLine(P,L,bin,v,sigmaBins,difar,sE,sN,sP,sinB,cosB);
   }
  }
 }

 /** PROTOTYPE WASM SIMD kernel (setResKernel('wasm'); default 'js'). Broadband+Lloyd bin loop in
  * wasm linear memory; tonals/swaths remain JS (swath absorption via Math.exp, same as reference core).
  * Requires ensureWasmKernel() success; otherwise caller keeps the JS fast path. */
 private coreFastWasm(P:Float64Array,sE:Float64Array,sN:Float64Array,sP:Float64Array):void{
  const e=this.environment,df=this.params.fBin,enbw=this.params.enbwHz,f0=this.band.f0,L=this.band.liveBins,difar=this.difar,bt=this.bt,AB=SH.ab,se=this.shapeEnbw,amb=this.ambientBin,coh=this.sigma!==0,AE=this.absorptionExponent;
  wasmUploadTables(this.tablesKey,se,AE,this.coherenceExponent,L);
  wasmClearOutputs(L,difar);
  for(let j=0;j<this.contacts.length;j++){
   const item=this.contacts[j]!,c=item.trk;if(!item.act)continue;const g=geometry(c,bt,this.g);
   const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
   const prop=e.propagation,czOn=prop?.czEnabled===true;
   const czEst=czOn||prop?.czForceGainLinear!==undefined?czEstimateFor(this.waterColumn,c.depth,bt.depth):null;
   const czGain=prop?.czForceGainLinear!==undefined?prop.czForceGainLinear:czPropagationGainLinear(g.range,czEst,{enabled:czOn});
   const level=dbToPower(item.srcDb)*item.gain*spread*czGain,km=Math.max(0,g.range-1)/1000;
   const flow=Number.isNaN(item.flowDb)?0:dbToPower(item.flowDb)*(g.range<=1?1:spread*item.flowFrac);
   const broadband=level*(.0001+item.cav),imageRange=Math.hypot(g.horizontal,c.depth+bt.depth),q=imageRange>0?g.range/imageRange:1,grazing2=imageRange>0?((c.depth+bt.depth)/imageRange)**2:0;
   const delta=pathDifference(g.horizontal,c.depth,bt.depth),phase=2*Math.PI*f0*delta/e.soundSpeed,step=2*Math.PI*df*delta/e.soundSpeed;
   const sinB=Math.sin(g.bearing),cosB=Math.cos(g.bearing);
   wasmProcessContact({L,difar,coh,keepAb:false,broadband,flow,q,km,grazing2,phase,step,sinB,cosB});
  }
  wasmCopyOutputs(P,sE,sN,AB,L,difar,false);
  for(let i=0;i<L;i++)P[i]+=amb[i]!;
  for(let j=0;j<this.contacts.length;j++){
   const item=this.contacts[j]!,c=item.trk;if(!item.act)continue;const g=geometry(c,bt,this.g);
   const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
   const prop=e.propagation,czOn=prop?.czEnabled===true;
   const czEst=czOn||prop?.czForceGainLinear!==undefined?czEstimateFor(this.waterColumn,c.depth,bt.depth):null;
   const czGain=prop?.czForceGainLinear!==undefined?prop.czForceGainLinear:czPropagationGainLinear(g.range,czEst,{enabled:czOn});
   const level=dbToPower(item.srcDb)*item.gain*spread*czGain,km=Math.max(0,g.range-1)/1000;
   const sinB=Math.sin(g.bearing),cosB=Math.cos(g.bearing);
   if(item.swaths.length){for(let i=0;i<L;i++)AB[i]=Math.exp(AE[i]!*km);
    for(let s=0;s<item.swaths.length;s++){const gs=item.swG[s]!;if(gs>0){const lo=Math.max(0,Math.ceil((item.swLo[s]!-f0)/df)),hi=Math.min(L-1,Math.floor((item.swHi[s]!-f0)/df)),lv=level*.0003*gs*enbw;for(let i=lo;i<=hi;i++){const contrib=lv*AB[i]!;P[i]+=contrib;if(difar){sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}}}}}
   for(let k=0;k<item.frequencies.length;k++){
    const f=doppler(item.frequencies[k],g.sourceRadial,g.receiverRadial,e.soundSpeed),bin=(f-f0)/df,sigmaBins=item.sigmaHz[k]/df;
    if(bin<-2-4*sigmaBins||bin>L+1+4*sigmaBins)continue;
    const v=level*item.powers[k]*10**(-thorp(f)*km/10)*exactGain(f,g.horizontal,c.depth,bt.depth,e.soundSpeed,this.sigma);
    if(sigmaBins<1)depositHannLine(P,L,bin,v,difar,sE,sN,sP,sinB,cosB);else depositGaussianLine(P,L,bin,v,sigmaBins,difar,sE,sN,sP,sinB,cosB);
   }
  }
 }

 /** PROTOTYPE (flag COARSE_BB): coreFast with the smooth broadband envelope on coarse nodes — see
  * setCoarseBroadband. Contacts with swaths use the exact chunked loop (they need per-bin absorption). */
 private coreCoarse(P:Float64Array,sE:Float64Array,sN:Float64Array,sP:Float64Array):void{
  const e=this.environment,df=this.params.fBin,enbw=this.params.enbwHz,f0=this.band.f0,L=this.band.liveBins,difar=this.difar,bt=this.bt,AB=SH.ab,se=this.shapeEnbw,amb=this.ambientBin,coh=this.sigma!==0;
  const nd=coarseNodes(f0,df,L),M=nd.length,CP=CS.P,CEs=CS.E,CNs=CS.N;
  for(let i=0;i<L;i++)P[i]=amb[i]!;if(difar){sE.fill(0,0,L);sN.fill(0,0,L);sP.fill(0,0,L);}
  CP.fill(0,0,M);if(difar){CEs.fill(0,0,M);CNs.fill(0,0,M);}
  const AE=this.absorptionExponent,CE=this.coherenceExponent,OA=SH.p3;
  for(let j=0;j<this.contacts.length;j++){
   const item=this.contacts[j]!,c=item.trk;if(!item.act)continue;const g=geometry(c,bt,this.g);
   const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
   const prop=e.propagation,czOn=prop?.czEnabled===true;
   const czEst=czOn||prop?.czForceGainLinear!==undefined?czEstimateFor(this.waterColumn,c.depth,bt.depth):null;
   const czGain=prop?.czForceGainLinear!==undefined?prop.czForceGainLinear:czPropagationGainLinear(g.range,czEst,{enabled:czOn});
   const level=dbToPower(item.srcDb)*item.gain*spread*czGain,km=Math.max(0,g.range-1)/1000;
   const flow=Number.isNaN(item.flowDb)?0:dbToPower(item.flowDb)*(g.range<=1?1:spread*item.flowFrac);
   const broadband=level*(.0001+item.cav),imageRange=Math.hypot(g.horizontal,c.depth+bt.depth),q=imageRange>0?g.range/imageRange:1,grazing2=imageRange>0?((c.depth+bt.depth)/imageRange)**2:0;
   const delta=pathDifference(g.horizontal,c.depth,bt.depth),phase=2*Math.PI*f0*delta/e.soundSpeed,step=2*Math.PI*df*delta/e.soundSpeed,dc=Math.cos(step),ds=Math.sin(step);let cp=Math.cos(phase),sp=Math.sin(phase);
   const sinB=Math.sin(g.bearing),cosB=Math.cos(g.bearing),keep=item.swaths.length>0;
   // Smooth envelope at nodes: S=(b(1−c)²+flow)·env (summed over contacts), O=2bc·env (per contact).
   for(let k=0;k<M;k++){const i=nd[k]!,env=se[i]!*Math.exp(AE[i]!*km),cc=q*(coh?Math.exp(CE[i]!*grazing2):1),sm=(broadband*(1-cc)*(1-cc)+flow)*env;
    CP[k]+=sm;if(difar){CEs[k]+=sm*sinB;CNs[k]+=sm*cosB;}OA[k]=2*broadband*cc*env;}
   // Fine grid: exact cos(kΔ) recurrence at every output bin × interpolated amplitude.
   let i=0;for(let k=0;k<M-1||(k===0&&M===1);k++){const a=nd[k]!,b=M===1?a:nd[k+1]!,last=k>=M-2,n=b-a,oa=OA[k]!,d=n>0?(OA[k+1]!-oa)/n:0,end=last?b+1:b;
    if(difar)for(let m=0;i<end;i++,m++){const o=(oa+m*d)*(1-cp);P[i]+=o;sE[i]+=o*sinB;sN[i]+=o*cosB;const nx=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=nx;}
    else for(let m=0;i<end;i++,m++){P[i]+=(oa+m*d)*(1-cp);const nx=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=nx;}
    if(M===1)break;}
   if(keep){for(let i=0;i<L;i++)AB[i]=Math.exp(AE[i]!*km);
    for(let s=0;s<item.swaths.length;s++){const gs=item.swG[s]!;if(gs>0){const lo=Math.max(0,Math.ceil((item.swLo[s]!-f0)/df)),hi=Math.min(L-1,Math.floor((item.swHi[s]!-f0)/df)),lv=level*.0003*gs*enbw;for(let i=lo;i<=hi;i++){const contrib=lv*AB[i]!;P[i]+=contrib;if(difar){sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}}}}}
   for(let k=0;k<item.frequencies.length;k++){
    const f=doppler(item.frequencies[k],g.sourceRadial,g.receiverRadial,e.soundSpeed),bin=(f-f0)/df,sigmaBins=item.sigmaHz[k]/df;
    if(bin<-2-4*sigmaBins||bin>L+1+4*sigmaBins)continue;
    const v=level*item.powers[k]*10**(-thorp(f)*km/10)*exactGain(f,g.horizontal,c.depth,bt.depth,e.soundSpeed,this.sigma);
    if(sigmaBins<1)depositHannLine(P,L,bin,v,difar,sE,sN,sP,sinB,cosB);else depositGaussianLine(P,L,bin,v,sigmaBins,difar,sE,sN,sP,sinB,cosB);
   }
  }
  // Interpolate the contact-summed smooth envelope (linear in power) onto the output bins.
  for(let k=0;k<M;k++){const a=nd[k]!,b=k<M-1?nd[k+1]!:a+1,n=b-a,v=CP[k]!,d=k<M-1?(CP[k+1]!-v)/n:0;for(let m=0;m<n;m++)P[a+m]+=v+m*d;
   if(difar){const ve=CEs[k]!,de=k<M-1?(CEs[k+1]!-ve)/n:0,vn=CNs[k]!,dn=k<M-1?(CNs[k+1]!-vn)/n:0;for(let m=0;m<n;m++){sE[a+m]+=ve+m*de;sN[a+m]+=vn+m*dn;}}}
 }
 private historyBuoyKey():number{return this.history?this.history.buoyId(this.buoy):-1;}
 private loadLive():void{
  const b=this.buoy,bt=this.bt;bt.x=b.x;bt.y=b.y;bt.depth=b.depth;bt.course=b.course;bt.speed=b.speed;
  for(const it of this.contacts){const c=it.contact,p=c.params,t=it.trk;it.act=c.active!==false;t.x=c.x;t.y=c.y;t.depth=c.depth;t.course=c.course;t.speed=c.speed;
   if(!it.act)continue;fillTonals(p,it.frequencies,it.powers,c.lines);it.srcDb=sourceLevel(p,c.speed,c.depth);it.flowDb=p.flowNoiseDb===undefined?NaN:p.flowNoiseDb;it.flowFrac=p.flowRadiatedFraction??0;it.cav=p.cavitationPower??0;
   for(let s=0;s<it.swaths.length;s++){const w=it.swaths[s]!.source as {gain:number;loHz:number;hiHz:number};it.swG[s]=w.gain;it.swLo[s]=w.loHz;it.swHi[s]=w.hiHz;}}
 }
 private loadFrame(sl:number):void{
  const h=this.history!,d=h.data,base=sl*h.stride,br=this.buoyRing!,bo=sl*StateHistory.B_STRIDE,bt=this.bt;
  bt.x=br[bo]!;bt.y=br[bo+1]!;bt.depth=br[bo+2]!;bt.course=br[bo+3]!;bt.speed=br[bo+4]!;
  for(let j=0;j<this.contacts.length;j++){const it=this.contacts[j]!,L=h.layout[j]!,o=base+L.offset,t=it.trk;it.act=d[o]===1;t.x=d[o+1]!;t.y=d[o+2]!;t.depth=d[o+3]!;t.course=d[o+4]!;t.speed=d[o+5]!;
   it.srcDb=d[o+6]!;it.flowDb=d[o+7]!;it.flowFrac=d[o+8]!;it.cav=d[o+9]!;const n=Math.min(L.lines,it.frequencies.length);
   for(let k=0;k<n;k++){it.frequencies[k]=d[o+StateHistory.C_HEAD+k]!;it.powers[k]=d[o+StateHistory.C_HEAD+L.lines+k]!;}
   const so=o+StateHistory.C_HEAD+2*L.lines,m=Math.min(L.swaths,it.swaths.length);for(let s=0;s<m;s++){it.swG[s]=d[so+3*s]!;it.swLo[s]=d[so+3*s+1]!;it.swHi[s]=d[so+3*s+2]!;}}
 }
 /** Engine FULLBAND hook: render tile `tileIndex` for the row ending at tEnd. */
 renderTileAt(tileIndex:number,rowKey:number,tEnd:number,out:Float32Array=this.row,offset=0,tileBins:number=TILE_BINS):Float32Array{
  this.selectTile(tileIndex,tileBins);return this.render(rowKey,out,offset,true,tEnd);
 }
 /** FULLBAND: render one tile at an explicit rowKey (shared across tiles of the same row time). Does not bump rowIndex. */
 renderTile(tileIndex:number,rowKey:number,out:Float32Array=this.row,offset=0,tileBins:number=TILE_BINS):Float32Array{
  this.selectTile(tileIndex,tileBins);
  return this.render(rowKey,out,offset,true);
 }
 /** Instantaneous expected spectrum (ambient + contacts) at the current scenario state → expected/signal*. */
 private computeExpected():void{this.loadLive();this.core(SH.P,SH.E,SH.N,SH.S);}
 /** Modelled spectrum for the loaded state (live or a history frame) into P/sE/sN/sP. */
 private core(P:Float64Array,sE:Float64Array,sN:Float64Array,sP:Float64Array):void{
  const e=this.environment,df=this.params.fBin,enbw=this.params.enbwHz,f0=this.band.f0,L=this.band.liveBins,difar=this.difar,bt=this.bt;
  for(let i=0;i<L;i++)P[i]=this.ambientBin[i];if(difar){sE.fill(0,0,L);sN.fill(0,0,L);sP.fill(0,0,L);}
  for(let j=0;j<this.contacts.length;j++){
   const item=this.contacts[j]!,c=item.trk;if(!item.act)continue;const g=geometry(c,bt,this.g);
   const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
   const prop=e.propagation,czOn=prop?.czEnabled===true;
   const czEst=czOn||prop?.czForceGainLinear!==undefined?czEstimateFor(this.waterColumn,c.depth,bt.depth):null;
   const czGain=prop?.czForceGainLinear!==undefined?prop.czForceGainLinear:czPropagationGainLinear(g.range,czEst,{enabled:czOn});
   const level=dbToPower(item.srcDb)*item.gain*spread*czGain,km=Math.max(0,g.range-1)/1000;
   const flow=Number.isNaN(item.flowDb)?0:dbToPower(item.flowDb)*(g.range<=1?1:spread*item.flowFrac);
   const broadband=level*(.0001+item.cav),imageRange=Math.hypot(g.horizontal,c.depth+bt.depth),q=imageRange>0?g.range/imageRange:1,grazing2=imageRange>0?((c.depth+bt.depth)/imageRange)**2:0;
   const delta=pathDifference(g.horizontal,c.depth,bt.depth),phase=2*Math.PI*f0*delta/e.soundSpeed,step=2*Math.PI*df*delta/e.soundSpeed,dc=Math.cos(step),ds=Math.sin(step);let cp=Math.cos(phase),sp=Math.sin(phase);
   const sinB=Math.sin(g.bearing),cosB=Math.cos(g.bearing);
   for(let i=0;i<L;i++){const coherent=q*(this.sigma===0?1:Math.exp(this.coherenceExponent[i]*grazing2)),gain=Math.max(0,1+coherent*coherent-2*coherent*cp),contrib=(broadband*gain+flow)*this.shape[i]*Math.exp(this.absorptionExponent[i]*km)*enbw;P[i]+=contrib;if(difar){sP[i]+=contrib;sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}const next=cp*dc-sp*ds;sp=sp*dc+cp*ds;cp=next;}
   for(let s=0;s<item.swaths.length;s++){const gs=item.swG[s]!;if(gs>0){const lo=Math.max(0,Math.ceil((item.swLo[s]!-f0)/df)),hi=Math.min(L-1,Math.floor((item.swHi[s]!-f0)/df));for(let i=lo;i<=hi;i++){const contrib=level*.0003*gs*Math.exp(this.absorptionExponent[i]*km)*enbw;P[i]+=contrib;if(difar){sP[i]+=contrib;sE[i]+=contrib*sinB;sN[i]+=contrib*cosB;}}}}
   for(let k=0;k<item.frequencies.length;k++){
    const f=doppler(item.frequencies[k],g.sourceRadial,g.receiverRadial,e.soundSpeed),bin=(f-f0)/df,sigmaBins=item.sigmaHz[k]/df;
    if(bin<-2-4*sigmaBins||bin>L+1+4*sigmaBins)continue;
    const v=level*item.powers[k]*10**(-thorp(f)*km/10)*exactGain(f,g.horizontal,c.depth,bt.depth,e.soundSpeed,this.sigma);
    if(sigmaBins<1)depositHannLine(P,L,bin,v,difar,sE,sN,sP,sinB,cosB);else depositGaussianLine(P,L,bin,v,sigmaBins,difar,sE,sN,sP,sinB,cosB);
   }
  }
 }
 private render(rowKey:number,out:Float32Array,offset:number,perTileAr:boolean,tEnd?:number):Float32Array{
  const W=this.bins;
  if(!Number.isInteger(offset)||offset<0||out.length<offset+W)throw new Error('Row size mismatch');
  this.rng.reset!((this.baseSeed+Math.imul(rowKey,0x9e3779b9))>>>0);this.bearingRng.reset!((this.bearingSeed+Math.imul(rowKey,0x9e3779b9))>>>0);
  this.lastIntegrated=tEnd!==undefined&&this.integrateRow(tEnd,perTileAr);if(!this.lastIntegrated){this.computeExpected();this.snapshotFallbacks++;}
  const enbw=this.params.enbwHz,L=this.band.liveBins,difar=this.difar,P=this.expected,sE=this.signalEast,sN=this.signalNorth,sP=this.signalPower;
  // Noise: K=1 → exact AR(1) on complex amplitudes (correlated rows); K>1 → unit-mean χ²_ν gamma.
  const pw=this.power,rng=this.rng;
  if(this.params.averages===1){const a=HANN_75_AMPLITUDE_CORRELATION,b=Math.sqrt(1-a*a),h=Math.SQRT1_2;
   let zr=this.zr,zi=this.zi,cold=rowKey===0;
   if(perTileAr){let st=this.tileAr.get(this.tileIndex);if(!st){st={zr:new Float32Array(this.capacity),zi:new Float32Array(this.capacity),lastRow:-1};this.tileAr.set(this.tileIndex,st);}zr=st.zr;zi=st.zi;
    // Rows skipped while the tile was unprepared/unfilled: fast-forward the AR(1) chain with the same
    // per-row seeded draws so the noise is bit-identical to a tile that rendered every row.
    if(st.lastRow<rowKey-1){for(let r=st.lastRow+1;r<rowKey;r++){rng.reset!((this.baseSeed+Math.imul(r,0x9e3779b9))>>>0);for(let i=0;i<L;i++){zr[i]=a*zr[i]+b*h*gaussian(rng);zi[i]=a*zi[i]+b*h*gaussian(rng);}}rng.reset!((this.baseSeed+Math.imul(rowKey,0x9e3779b9))>>>0);cold=false;}
    else cold=st.lastRow!==rowKey-1;st.lastRow=rowKey;}
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
