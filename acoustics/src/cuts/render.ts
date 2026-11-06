import {getClass,resolveReference} from '../catalog/derive.js';
import {AcousticEngine} from '../engine.js';
import {knotsToMps} from '../units.js';
import type {GramConfig} from '../protocol.js';
import type {ScenarioInput} from '../scenario.js';
import {validateCutSeed} from './validate.js';
import type {CutSeed} from './types.js';

const DEG=Math.PI/180;
const ROW_DT=.25;
/** Wide enough for HYDP (≈200–1500 Hz) plus machinery; MF teaching window. */
export const CUT_FMAX=2000;
export const CUT_BINS=2048;

/** Build a minimal single-contact aviation scenario from a validated CutSeed. */
export function scenarioFromCut(cut:CutSeed):ScenarioInput {
 validateCutSeed(cut);
 const klass=getClass(cut.classId);
 resolveReference({classId:cut.classId,variantId:cut.variantId,hullId:cut.hullId});
 const v=knotsToMps(cut.speedKn),course=Math.PI/2,cpa=900,tCpa=Math.min(cut.durationS*.4,240);
 const x=-tCpa*v*Math.sin(course)+cpa*Math.cos(course);
 const y=-tCpa*v*Math.cos(course)-cpa*Math.sin(course);
 const wantsHydp=cut.classifyingLines.some(l=>l.lineFamily==='HYDP')&&!!klass.hydp;
 const hydpAt=Math.min(45,Math.max(15,Math.floor(cut.durationS*.08)));
 const traffic=cut.richness==='sparse'?0:cut.richness==='moderate'?.15:.35;
 const sea=cut.richness==='sparse'?0:cut.richness==='moderate'?2:3;
 const reactorOffline=cut.mode==='AIP'&&klass.plant==='nuclear';
 const motion=[{at:0,course,speed:v,depth:cut.depthM},...(wantsHydp?[{at:hydpAt,course:course+28*DEG,speed:v,depth:cut.depthM}]:[])];
 return {
  v:1,seed:cut.seed,mode:'aviation',bins:CUT_BINS,fmax:CUT_FMAX,fMax:CUT_FMAX,fBin:CUT_FMAX/(CUT_BINS-1),band:[0,CUT_FMAX],time:0,
  surfaceTraffic:traffic,
  ownship:{x:0,y:0,depth:0,course:0,speed:80},
  environment:{seaState:sea,shipping:traffic<.33?'light':traffic<.67?'moderate':'heavy',shippingDensity:traffic,soundSpeed:1500,spreading:'spherical',transition:1000},
  contacts:[{
   id:`cut-contact-${cut.id}`,category:'subsurface',classificationTarget:true,behaviour:'transit',
   catalogRef:{classId:cut.classId,variantId:cut.variantId,hullId:cut.hullId},
   operatingMode:cut.mode,...(reactorOffline?{reactorOffline:true}:{}),
   x,y,depth:cut.depthM,course,speed:v,motion,
   ...(wantsHydp?{transients:[{at:hydpAt,kind:'hydp',params:{}}]}:{}),
  }],
  buoys:[{id:'buoy-1',type:'difar',x:0,y:0,depth:60,course:0,speed:0,rfChannel:1,deployedAt:0,life:Math.max(7200,cut.durationS+600)}],
 };
}

/**
 * Fast-drain CUT session: wraps AcousticEngine so the host can pull LOFAR (+ DEMON)
 * rows as quickly as it can consume them — no wall-clock wait. Advances sim by one
 * LOFAR row period (0.25 s) whenever a drain is requested and no row is due yet.
 */
export class CutSession {
 readonly cut:CutSeed;
 readonly engine:AcousticEngine;
 readonly lofar:GramConfig;
 readonly demonStreamId:number;
 private readonly lofarBuf:Float32Array;
 private ended=false;
 constructor(cut:CutSeed){
  validateCutSeed(cut);
  this.cut=cut;
  this.engine=new AcousticEngine(scenarioFromCut(cut),cut.seed);
  this.lofar=this.engine.subscribe({channel:1,kind:'lofar',bins:CUT_BINS,band:[0,CUT_FMAX]});
  this.demonStreamId=this.engine.subscribe({kind:'demon',buoyId:1,band:[1000,Math.min(4000,CUT_FMAX)]});
  this.lofarBuf=new Float32Array(this.lofar.bins);
 }
 get simT():number{return this.engine.time;}
 get done():boolean{return this.ended||(this.engine.time>=this.cut.durationS&&this.engine.rowsReady(this.lofar.streamId)===0);}
 private ensureLofarRow():boolean{
  while(this.engine.rowsReady(this.lofar.streamId)===0){
   if(this.engine.time>=this.cut.durationS){this.ended=true;return false;}
   const dt=Math.min(ROW_DT,this.cut.durationS-this.engine.time);
   if(dt<=0){this.ended=true;return false;}
   this.engine.advance(dt);
  }
  return true;
 }
 /** Write next LOFAR row into caller-owned buffer. Returns row index, or -1 when done. */
 writeLofarRow(out:Float32Array,offset=0):number{
  if(!this.ensureLofarRow())return -1;
  return this.engine.writeRow(this.lofar.streamId,out,offset);
 }
 /** Write next DEMON row (shares sim clock with LOFAR). Returns row index or -1. */
 writeDemonRow(out:Float32Array,offset=0):number{
  if(!this.ensureLofarRow())return -1;
  if(this.engine.rowsReady(this.demonStreamId)===0){
   if(this.engine.time<this.cut.durationS)this.engine.advance(ROW_DT);
   if(this.engine.rowsReady(this.demonStreamId)===0)return -1;
  }
  return this.engine.writeRow(this.demonStreamId,out,offset);
 }
 /** Drain up to `maxRows` LOFAR rows as fast as the host can take them. */
 drainLofar(out:Float32Array,maxRows=Infinity):number{
  let n=0;while(n<maxRows){const i=this.writeLofarRow(out);if(i<0)break;n++;}return n;
 }
 /** Determinism helper: FNV-1a over the first `n` LOFAR rows (float32 bit patterns). */
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
