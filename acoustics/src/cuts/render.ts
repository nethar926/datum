import {displayName,getClass,resolveReference,deriveSignature} from '../catalog/derive.js';
import {AcousticEngine} from '../engine.js';
import {knotsToMps} from '../units.js';
import {deriveSeed,mulberry32} from '../prng.js';
import {loadScenario,type ScenarioInput,type ContactTransient} from '../scenario.js';
import type {GramConfig} from '../protocol.js';
import type {TonalLine} from '../sourceModel.js';
import {validateCutSeed} from './validate.js';
import {bakeFidelityParams,applyRuntimeFidelity,looksOf} from './fidelity.js';
import type {CutSeed} from './types.js';

const DEG=Math.PI/180;
const ROW_DT=.25;
/** Wide enough for HYDP (≈200–1500 Hz) plus MSR/SSMA; MF teaching window. */
export const CUT_FMAX=2000;
export const CUT_BINS=2048;

/** Build a minimal single-contact aviation scenario from a validated CutSeed.
 * Contacts carry baked `params` (no catalogRef) so plantSpec overlays (SSMA etc.) survive loadScenario. */
export function scenarioFromCut(cut:CutSeed):ScenarioInput {
 validateCutSeed(cut);
 const {klass}=resolveReference({classId:cut.classId,variantId:cut.variantId,hullId:cut.hullId});
 const reactorOffline=cut.mode==='AIP'&&klass.plant==='nuclear';
 const state={mode:cut.mode,speedKn:cut.speedKn,depthM:cut.depthM,...(reactorOffline?{reactorOffline:true}:{})};
 let sig=deriveSignature(klass,cut.variantId,state);
 sig={...sig,label:displayName(klass.name)};
 bakeFidelityParams(sig,cut);
 const v=knotsToMps(cut.speedKn),course=Math.PI/2,cpa=900,tCpa=Math.min(cut.durationS*.4,240);
 const x=-tCpa*v*Math.sin(course)+cpa*Math.cos(course);
 const y=-tCpa*v*Math.cos(course)-cpa*Math.sin(course);
 const wantsHydp=cut.classifyingLines.some(l=>l.lineFamily==='HYDP')&&!!klass.hydp;
 const wantsKnee=looksOf(cut).has('engine-knee');
 const hydpAt=Math.min(45,Math.max(15,Math.floor(cut.durationS*.08)));
 // Knee start/duration vary by cut seed (Lead: not locked to last 20%; sketches are examples).
 const kneeRng=mulberry32(deriveSeed(cut.seed,'cut-knee'));
 const kneeAt=Math.floor(cut.durationS*(.35+.4*kneeRng()));
 const kneeDur=Math.max(20,Math.floor(cut.durationS*(.06+.12*kneeRng())));
 const kneeTo=Number((.78+.14*kneeRng()).toFixed(3));
 // HYDP: short squally bursts (Wilson ~1–3 s), seeded 1/2/3 count — not class durationS.
 const hydpRng=mulberry32(deriveSeed(cut.seed,'cut-hydp'));
 const hydpU=hydpRng(),hydpN=hydpU<.7?1:hydpU<.95?2:3,hydpDur=Number((1.2+hydpRng()*2.5).toFixed(2));
 const traffic=cut.richness==='sparse'?0:cut.richness==='moderate'?.15:.35;
 const sea=cut.richness==='sparse'?0:cut.richness==='moderate'?2:3;
 const motion=[{at:0,course,speed:v,depth:cut.depthM},...(wantsHydp?[{at:hydpAt,course:course+28*DEG,speed:v,depth:cut.depthM}]:[]),...(wantsKnee?[{at:kneeAt+kneeDur+10,course,speed:v*.85,depth:cut.depthM}]:[])];
 const transients:ContactTransient[]=[];
 if(wantsHydp){for(let k=0;k<hydpN;k++)transients.push({at:hydpAt+k*.4,kind:'hydp',params:{durationS:hydpDur}});}
 if(wantsKnee)transients.push({at:kneeAt,kind:'engine-ramp',params:{durationS:kneeDur,fromScale:1,toScale:kneeTo}});
 return {
  v:1,seed:cut.seed,mode:'aviation',bins:CUT_BINS,fmax:CUT_FMAX,fMax:CUT_FMAX,fBin:CUT_FMAX/(CUT_BINS-1),band:[0,CUT_FMAX],time:0,
  surfaceTraffic:traffic,
  ownship:{x:0,y:0,depth:0,course:0,speed:80},
  environment:{seaState:sea,shipping:traffic<.33?'light':traffic<.67?'moderate':'heavy',shippingDensity:traffic,soundSpeed:1500,spreading:'spherical',transition:1000},
  contacts:[{
   id:`cut-contact-${cut.id}`,category:'subsurface',classificationTarget:true,behaviour:'transit',
   // Bake classId into params only — catalogRef would re-derive and drop SSMA overlays.
   params:sig,operatingMode:cut.mode,...(reactorOffline?{reactorOffline:true}:{}),
   x,y,depth:cut.depthM,course,speed:v,motion,
   ...(transients.length?{transients}:{}),
  }],
  buoys:[{id:'buoy-1',type:'difar',x:0,y:0,depth:60,course:0,speed:0,rfChannel:1,deployedAt:0,life:Math.max(7200,cut.durationS+600)}],
 };
}

/**
 * Fast-drain CUT session: wraps AcousticEngine so the host can pull LOFAR (+ DEMON)
 * rows as quickly as it can consume them — no wall-clock wait.
 */
export class CutSession {
 readonly cut:CutSeed;
 readonly engine:AcousticEngine;
 readonly lofar:GramConfig;
 readonly demonStreamId:number;
 private readonly lofarBuf:Float32Array;
 private readonly rampBases=new Map<TonalLine,number>();
 private readonly engineHarmonicBases=new Map<TonalLine,number>();
 private ended=false;
 private disposed=false;
 constructor(cut:CutSeed){
  validateCutSeed(cut);
  this.cut=cut;
  const loaded=loadScenario(scenarioFromCut(cut));
  this.engine=new AcousticEngine(loaded,cut.seed);
  // Snapshot EDA powers at full output; propulsion-ramp uses catalog EDA riseS only (no mode switch).
  if(looksOf(cut).has('propulsion-ramp')){
   for(const l of this.contact.params.tonals??[])if(l.lineFamily==='EDA')this.rampBases.set(l,l.power);
   applyRuntimeFidelity(this.contact.params,cut,0,this.rampBases,this.engineHarmonicBases);
  }
  this.lofar=this.engine.subscribe({channel:1,kind:'lofar',bins:CUT_BINS,band:[0,CUT_FMAX]});
  this.demonStreamId=this.engine.subscribe({kind:'demon',buoyId:1,band:[1000,Math.min(4000,CUT_FMAX)]});
  this.lofarBuf=new Float32Array(this.lofar.bins);
 }
 private get contact(){return this.engine.scenario.contacts.find(c=>c.category!=='surface')??this.engine.scenario.contacts[0];}
 get simT():number{return this.engine.time;}
 get done():boolean{return this.disposed||this.ended||(this.engine.time>=this.cut.durationS&&this.engine.rowsReady(this.lofar.streamId)===0);}
 /** True after dispose(); FE should drop the session reference. */
 get isDisposed():boolean{return this.disposed;}
 /**
  * Tear down a finished/abandoned cut: unsubscribe LOFAR+DEMON streams, clear local buffers.
  * Idempotent. After dispose, writeLofarRow / writeDemonRow / drainLofar return -1 safely.
  */
 dispose():void{
  if(this.disposed)return;
  this.disposed=true;this.ended=true;
  try{this.engine.unsubscribe(this.lofar.streamId);}catch{/* already gone */}
  try{this.engine.unsubscribe(this.demonStreamId);}catch{/* already gone */}
  this.rampBases.clear();this.engineHarmonicBases.clear();
  this.lofarBuf.fill(0);
 }
 private ensureLofarRow():boolean{
  if(this.disposed)return false;
  while(this.engine.rowsReady(this.lofar.streamId)===0){
   if(this.engine.time>=this.cut.durationS){this.ended=true;return false;}
   const dt=Math.min(ROW_DT,this.cut.durationS-this.engine.time);
   if(dt<=0){this.ended=true;return false;}
   this.engine.advance(dt);
   applyRuntimeFidelity(this.contact.params,this.cut,this.engine.time,this.rampBases,this.engineHarmonicBases);
  }
  return true;
 }
 writeLofarRow(out:Float32Array,offset=0):number{
  if(this.disposed||!this.ensureLofarRow())return -1;
  return this.engine.writeRow(this.lofar.streamId,out,offset);
 }
 writeDemonRow(out:Float32Array,offset=0):number{
  if(this.disposed||!this.ensureLofarRow())return -1;
  if(this.engine.rowsReady(this.demonStreamId)===0){
   if(this.engine.time<this.cut.durationS){this.engine.advance(ROW_DT);applyRuntimeFidelity(this.contact.params,this.cut,this.engine.time,this.rampBases,this.engineHarmonicBases);}
   if(this.engine.rowsReady(this.demonStreamId)===0)return -1;
  }
  return this.engine.writeRow(this.demonStreamId,out,offset);
 }
 drainLofar(out:Float32Array,maxRows=Infinity):number{
  if(this.disposed)return -1;
  let n=0;while(n<maxRows){const i=this.writeLofarRow(out);if(i<0)break;n++;}return n;
 }
 checksumFirstRows(n:number):number{
  let hash=0x811c9dc5>>>0;
  for(let r=0;r<n;r++){
   const idx=this.writeLofarRow(this.lofarBuf);if(idx<0)break;
   const view=new DataView(this.lofarBuf.buffer,this.lofarBuf.byteOffset,this.lofarBuf.byteLength);
   for(let i=0;i<this.lofarBuf.length;i++){const u=view.getUint32(i*4,true);hash^=u;hash=Math.imul(hash,0x01000193)>>>0;}
  }
  return hash>>>0;
 }
}
