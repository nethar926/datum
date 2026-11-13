/** User-cut save contract: a recipe (seed + clamped ScenarioParams + action log) that
 * re-renders the last ≤900 s of a procedural sim with full tool parity, plus an 8-bit
 * 0.5 dB fallback row pack used when check/modelVersion does not match.
 *
 * startSnapshot is omitted. Neither AcousticEngine nor CrewSnapshot can restore kinematics,
 * state history and generator state in a way that skips a pre-roll: CrewSnapshot still
 * rebuilds from the original scenario and replays from t=0.
 *
 * Difficulty filters use Wilson's UI names easy|medium|hard. The engine presets are
 * easy|regular|difficult (presetToParams / ScenarioGenParams.preset). Mapping:
 *   easy → easy, regular → medium, difficult → hard.
 * When no preset name is given, we compare clamped params to the three presets at that
 * seed; if none match, we derive a label from cpa/sea/quiet ranges.
 */
import {AcousticEngine} from '../engine.js';
import {applyCrewAction,CrewHasher,type CrewAction} from '../crewSync.js';
import {clampParams,generateScenario,presetToParams,type Difficulty,type ScenarioParams} from '../scenario/presets.js';
import {getClass} from '../catalog/derive.js';
import {createGeometry,geometry,type Track} from '../kinematics.js';
import {mpsToKnots} from '../units.js';
import {quantizeDb,dequantizeDb,quantizeBearing,dequantizeBearing,PRECISION_DB,DB_STEP} from '../warmRings.js';
import {RES_BINS,RES_DEFAULT,RES_FRAME_S,isResLevel,resParams} from '../res.js';
import {HISTORY_LATE_MARGIN_S,HISTORY_MAX_SPAN_S} from '../stateHistory.js';
import {ResLofarGenerator} from '../resGram.js';
import {isFeeding} from '../buoys.js';
import {DEMON_CARRIER_BAND} from './norm.js';
import type {Contact} from '../scenario.js';
import type {GramFilter,ResLevel} from '../protocol.js';
import type {Buoy} from '../buoys.js';
import {inferBuoyType} from '../buoys.js';
import {energyRowTimes,BEARING_ENERGY_BINS,BEARING_TIME_PERIOD_S,BEARING_ENERGY_PACK_VERSION,BEARING_ENERGY_SCALE} from '../bearingTime.js';

export const USER_CUT_VERSION=2;
export const USER_CUT_KIND='user';
export const USER_CUT_MODEL_VERSION='m4-usercut-2';
export const USER_CUT_WINDOW_S=900;
export const USER_CUT_FALLBACK_LABEL='Saved by an older version, analysis limited';
/** Per-buoy UI status when a fallback cut has no packed rows for that buoy. */
export const USER_CUT_NOT_SAVED_STATUS='notSaved';
export const USER_CUT_NOT_SAVED_LABEL='Not saved in this cut';
/** Max buoys packed into fallbackRows (on-screen set, deterministic id order). */
export const USER_CUT_FALLBACK_BUOY_CAP=4;
/** Prefill so the first window row has a full LSTI RES1 span plus late margin. */
export const USER_CUT_HISTORY_PREFILL_S=HISTORY_MAX_SPAN_S+HISTORY_LATE_MARGIN_S;

export type UserCutPlant='diesel'|'nuclear';
export type UserCutDifficulty='easy'|'medium'|'hard';
export type UserCutMode='exact'|'fallback'|'mismatch';
export type UserCutBuoyPlaybackStatus='saved'|'notSaved';
export type UserCutStreamKind='lofar'|'demon';

export interface UserCutFilters {
  plant:UserCutPlant;
  force:string;
  difficulty:UserCutDifficulty;
}

export interface UserCutRevealContact {
  classId:string;
  variantId?:string;
  hullId?:string;
  plant:UserCutPlant;
  force:string;
  country:string;
  mode:string;
  speedKn:number;
  depthM:number;
  cpaM:number;
  behaviour:string;
  kind:'submarine';
}

export interface UserCutReveal {contacts:UserCutRevealContact[]}

export interface UserCutRowHash {
  buoyId:number;
  kind:UserCutStreamKind;
  res?:ResLevel;
  hash:string;
}

export interface UserCutCheck {stateHashT1:string;rowHash:UserCutRowHash[]}

/** Packed 8-bit 0.5 dB (and optional 8-bit bearing) rows, zlib-deflate then base64.
 * Reuses warm-ring `quantizeDb` / `dequantizeDb` (step 0.5 dB, precision 0.25 dB, NaN=255).
 * Representable range is [0, 127] dB; values below 0 clip to 0, above 127 clip to 127.
 * encoding is `u8-0.5db-deflate-b64` when deflate was available, else `u8-0.5db-b64`. */
export type UserCutFallbackEncoding='u8-0.5db-deflate-b64'|'u8-0.5db-b64';

export interface UserCutFallbackStream {
  buoyId:number;
  kind:UserCutStreamKind;
  res?:ResLevel;
  filter?:GramFilter;
  bins:number;
  rowPeriodS:number;
  simT0:number;
  count:number;
  data:string;
  bearing?:string;
}

export interface UserCutFallbackRows {
  encoding:UserCutFallbackEncoding;
  precisionDb:number;
  dbStep:number;
  streams:UserCutFallbackStream[];
}

export interface UserCut {
  v:1|2;
  kind:'user';
  id:string;
  name:string;
  createdAt:string;
  modelVersion:string;
  seed:number;
  params:ScenarioParams;
  simT0:number;
  simT1:number;
  durationS:number;
  actions:CrewAction[];
  /** Omitted: no engine snapshot/restore can skip a pre-roll (see file header). */
  startSnapshot?:undefined;
  reveal:UserCutReveal;
  filters:UserCutFilters;
  check:UserCutCheck;
  fallbackRows?:UserCutFallbackRows;
  /** Buoy ids whose grams were packed into fallbackRows, already clamped and sorted. */
  fallbackBuoyIds?:number[];
  /** Single RES level packed into fallbackRows. */
  fallbackRes?:ResLevel;
  /** UTF-8 JSON byte length of the cut (fallback included, this field omitted from the count). */
  sizeBytes?:number;
  /** Packed 360-bin DIFAR bearing-energy rows (1 Hz) for fallbackBuoyIds. */
  bearingEnergy?:UserCutBearingEnergy;
}

export type UserCutBearingEnergyEncoding='u8-b64'|'u8-deflate-b64';
export interface UserCutBearingEnergyBuoy {
  buoyId:number;
  t0:number;
  count:number;
  encoding:UserCutBearingEnergyEncoding;
  data:string;
}
export type UserCutBearingEnergyScale='db-above-bg-0.1'|'max-norm-u8';
export interface UserCutBearingEnergy {
  /** 2 = dB-above-background u8; omitted or 1 = legacy max-normalised u8. */
  version?:number;
  /** Display mapping. Omitted on legacy packs (treat as max-norm-u8). */
  scale?:UserCutBearingEnergyScale;
  periodS:number;
  bins:number;
  fLo:number;
  fHi:number;
  simT0:number;
  simT1:number;
  buoys:UserCutBearingEnergyBuoy[];
  /** Raw uint8 bytes (buoys × rows × 360). */
  rawBytes:number;
}
export type DecodedBearingEnergyRow={buoyId:number;t0:number;count:number;rows:Uint8Array[]};
export type DecodedBearingEnergy={
  version:number;scale:UserCutBearingEnergyScale;
  periodS:number;bins:number;fLo:number;fHi:number;simT0:number;simT1:number;
  buoys:DecodedBearingEnergyRow[];
};


export interface MakeUserCutOptions {
  params:ScenarioParams;
  /** Single RES in view at save time. Preferred over `resInView`. Default 5. */
  viewRes?:ResLevel;
  /** On-screen buoy ids at save time. Clamped to 4 in ascending id order. Default: all scenario buoys. */
  visibleBuoyIds?:number[];
  /** @deprecated Prefer `viewRes`. If `viewRes` is omitted, the first valid entry is used. */
  resInView?:ResLevel[];
  actions?:CrewAction[];
  /** Default true: DEMON rows (512 bins @ 4 Hz) are cheap next to a RES stream. */
  includeDemon?:boolean;
  filter?:GramFilter;
  /** Engine preset name (`easy`/`regular`/`difficult`) or UI name (`medium`/`hard`). */
  preset?:string;
  id?:string;
  createdAt?:string;
}

export interface DecodedFallbackStream {
  buoyId:number;
  kind:UserCutStreamKind;
  res?:ResLevel;
  filter?:GramFilter;
  bins:number;
  rowPeriodS:number;
  simT0:number;
  count:number;
  data:Float32Array;
  bearing?:Float32Array;
}

export interface UserCutBuoyStatus {
  buoyId:number;
  status:UserCutBuoyPlaybackStatus;
  /** `USER_CUT_NOT_SAVED_LABEL` when status is `notSaved`. */
  label?:string;
}

export interface UserCutSession {
  cut:UserCut;
  mode:UserCutMode;
  label?:string;
  reveal:UserCutReveal;
  /** Exact mode: engine parked at simT0, ready to play to simT1. */
  engine?:AcousticEngine;
  fallback?:DecodedFallbackStream[];
  /** Per-buoy playback. In fallback mode unsaved buoys are `notSaved`. */
  buoyStatus:UserCutBuoyStatus[];
  bearingEnergy?:DecodedBearingEnergy;
}

export function filterDifficultyFromEngine(d:string):UserCutDifficulty{
  const x=d.toLowerCase();
  if(x==='easy')return 'easy';
  if(x==='difficult'||x==='hard')return 'hard';
  return 'medium';
}

export function engineDifficultyFromFilter(d:UserCutDifficulty):Difficulty{
  if(d==='easy')return 'easy';
  if(d==='hard')return 'difficult';
  return 'regular';
}

function paramsKey(p:ScenarioParams):string{return JSON.stringify(clampParams(p));}

/** Map a named preset, or match/derive from clamped params. */
export function inferFilterDifficulty(params:ScenarioParams,preset?:string):UserCutDifficulty{
  if(preset){
    const x=preset.toLowerCase();
    if(x==='easy')return 'easy';
    if(x==='hard'||x==='difficult')return 'hard';
    if(x==='medium'||x==='regular')return 'medium';
  }
  const p=clampParams(params);
  for(const d of ['easy','regular','difficult'] as const){
    if(paramsKey(p)===paramsKey(presetToParams(d,p.seed)))return filterDifficultyFromEngine(d);
  }
  // No preset match: derive from the same knobs the presets set (CPA band, sea, quiet).
  const cpaHi=p.cpaRangeKm[1],quiet=p.opState.quietProb,sea=p.seaState;
  if(cpaHi<=1.2&&sea<=2&&quiet<=0.1)return 'easy';
  if(p.cpaRangeKm[0]>=4||quiet>=0.8||sea>=4)return 'hard';
  return 'medium';
}

export function numericBuoyId(b:Buoy,index:number):number{
  return Number(String(b.id).replace(/\D/g,''))||index+1;
}

export function resolveViewRes(opts:{viewRes?:ResLevel;resInView?:ResLevel[]}):ResLevel{
  if(isResLevel(opts.viewRes))return opts.viewRes;
  return normalizeResInView(opts.resInView)[0]!;
}

/** Unique ids present in `available`, sorted ascending, clamped to `USER_CUT_FALLBACK_BUOY_CAP`. */
export function clampFallbackBuoyIds(ids:number[]|undefined,available:number[]):number[]{
  const allow=new Set(available.filter(id=>Number.isInteger(id)&&id>0));
  const src=ids&&ids.length?ids:available;
  const seen=new Set<number>(),out:number[]=[];
  for(const id of src){
    if(!Number.isInteger(id)||id<=0||!allow.has(id)||seen.has(id))continue;
    seen.add(id);out.push(id);
  }
  out.sort((a,b)=>a-b);
  return out.slice(0,USER_CUT_FALLBACK_BUOY_CAP);
}

export function engineBuoyIds(engine:AcousticEngine):number[]{
  return engine.scenario.buoys.map((b,i)=>numericBuoyId(b,i));
}

/** Scenario buoys after replaying drop actions (kinematics only, no gram history). */
export function inventoryBuoyIds(cut:UserCut):number[]{
  const params=clampParams(cut.params);
  const engine=recipeEngine({params,seed:cut.seed,actions:cut.actions,to:cut.simT1});
  return engineBuoyIds(engine).sort((a,b)=>a-b);
}

export function buildBuoyStatus(cut:UserCut,mode:UserCutMode):UserCutBuoyStatus[]{
  const all=inventoryBuoyIds(cut);
  const saved=new Set(cut.fallbackBuoyIds??[]);
  return all.map(buoyId=>{
    if(mode==='exact'||saved.has(buoyId))return {buoyId,status:'saved' as const};
    return {buoyId,status:'notSaved' as const,label:USER_CUT_NOT_SAVED_LABEL};
  });
}

function uniqueSortedIds(ids:number[]):number[]{
  return [...new Set(ids.filter(id=>Number.isInteger(id)&&id>0))].sort((a,b)=>a-b);
}

function derivedFallbackBuoyIds(cut:UserCut):number[]{
  const fromRows=(cut.fallbackRows?.streams??[]).map(s=>s.buoyId);
  if(fromRows.length)return uniqueSortedIds(fromRows);
  return uniqueSortedIds((cut.check.rowHash??[]).map(r=>r.buoyId));
}

function derivedFallbackRes(cut:UserCut):ResLevel{
  const fromRows=(cut.fallbackRows?.streams??[]).find(s=>s.kind==='lofar'&&isResLevel(s.res));
  if(fromRows&&isResLevel(fromRows.res))return fromRows.res;
  const fromHash=(cut.check.rowHash??[]).find(r=>r.kind==='lofar'&&isResLevel(r.res));
  if(fromHash&&isResLevel(fromHash.res))return fromHash.res;
  return RES_DEFAULT;
}

/** Upgrade a v1 cut (or any cut missing the cap fields) to the current format. */
export function migrateUserCut(cut:UserCut):UserCut{
  const next:UserCut={...cut};
  if(!next.fallbackBuoyIds?.length)next.fallbackBuoyIds=derivedFallbackBuoyIds(next);
  if(!isResLevel(next.fallbackRes))next.fallbackRes=derivedFallbackRes(next);
  next.v=USER_CUT_VERSION;
  next.sizeBytes=userCutSizeBytes(next);
  return next;
}

function classificationContacts(contacts:readonly Contact[]):Contact[]{
  return contacts.filter(c=>c.category!=='surface'&&c.classificationTarget!==false&&c.catalogRef);
}

function minCpaAlong(origin:{x:number;y:number;depth:number},legs:{at:number;course:number;speed:number;depth:number}[],buoy:Track):number{
  let x=origin.x,y=origin.y,depth=origin.depth,best=Infinity;
  for(let i=0;i<legs.length;i++){
    const leg=legs[i]!,t0=leg.at,t1=i+1<legs.length?legs[i+1]!.at:t0+1e6;
    const src:Track={x,y,depth,course:leg.course,speed:leg.speed};
    const g=createGeometry();
    geometry(src,buoy,g);
    const dt=Math.max(0,t1-t0);
    let tau=g.cpaTime;if(!Number.isFinite(tau))tau=0;if(tau<0)tau=0;if(tau>dt)tau=dt;
    const sx=Math.sin(leg.course)*leg.speed,sy=Math.cos(leg.course)*leg.speed;
    const r=Math.hypot(x+sx*tau-buoy.x,y+sy*tau-buoy.y,leg.depth-buoy.depth);
    if(r<best)best=r;
    x+=sx*dt;y+=sy*dt;depth=leg.depth;
  }
  return best;
}

function backToT0(contact:Contact,simT:number):{x:number;y:number;depth:number}{
  let x=contact.x,y=contact.y,depth=contact.depth,t=simT;
  const legs=contact.motion??[];
  for(let i=legs.length-1;i>=0;i--){
    const leg=legs[i]!;
    if(leg.at>=t)continue;
    const dt=t-Math.max(0,leg.at);
    x-=Math.sin(leg.course)*leg.speed*dt;
    y-=Math.cos(leg.course)*leg.speed*dt;
    depth=i>0?legs[i-1]!.depth:leg.depth;
    t=Math.max(0,leg.at);
    if(t<=0)break;
  }
  return {x,y,depth};
}

export function buildReveal(engine:AcousticEngine):UserCutReveal{
  const buoys=engine.scenario.buoys;
  const buoy:Track=buoys[0]??{x:0,y:0,depth:0,course:0,speed:0};
  const contacts=classificationContacts(engine.scenario.contacts);
  const simT=engine.time;
  const out:UserCutRevealContact[]=[];
  for(const c of contacts){
    const ref=c.catalogRef!;
    const klass=getClass(ref.classId);
    const plant=(klass.plant==='nuclear'?'nuclear':'diesel') as UserCutPlant;
    const origin=backToT0(c,simT);
    const legs=c.motion?.length?c.motion:[{at:0,course:c.course,speed:c.speed,depth:c.depth}];
    const cpa=minCpaAlong(origin,legs,buoy);
    const rec:UserCutRevealContact={
      classId:ref.classId,plant,force:klass.force,country:klass.country,
      mode:c.operatingMode??'normal',speedKn:mpsToKnots(c.speed),depthM:c.depth,cpaM:cpa,
      behaviour:c.behaviour??'transit',kind:'submarine',
    };
    if(ref.variantId)rec.variantId=ref.variantId;
    if(ref.hullId)rec.hullId=ref.hullId;
    out.push(rec);
  }
  return {contacts:out};
}

export function buildFilters(reveal:UserCutReveal,params:ScenarioParams,preset?:string):UserCutFilters{
  const first=reveal.contacts[0];
  return {
    plant:first?.plant??'diesel',
    force:first?.force??'Blue',
    difficulty:inferFilterDifficulty(params,preset),
  };
}

function allContactsOf(e:AcousticEngine):Contact[]{
  const s=e.scenario,pool=s.surfacePool??[];
  const base=s.contacts.filter(c=>!pool.some(p=>p.id===c.id));
  return pool.length?base.concat(pool):s.contacts.slice();
}

function armHistory(engine:AcousticEngine,res:ResLevel):number|undefined{
  const buoys=engine.scenario.buoys;
  for(let i=0;i<buoys.length;i++){
    const ch=buoys[i]!.rfChannel;if(!(ch>0))continue;
    const cfg=engine.subscribe({channel:ch,res,filter:'NB'}) as {streamId:number};
    return cfg.streamId;
  }
  return undefined;
}

function playActions(engine:AcousticEngine,actions:CrewAction[],to:number,fromIndex=0):number{
  let i=fromIndex;
  while(i<actions.length&&actions[i]!.simT<=to+1e-9){
    const a=actions[i]!;
    if(a.simT>engine.time)engine.advance(a.simT-engine.time);
    applyCrewAction(engine,a);
    i++;
  }
  if(to>engine.time)engine.advance(to-engine.time);
  return i;
}

/** Rebuild an engine from the recipe, optionally recording state history from `recordFrom`. */
export function recipeEngine(args:{params:ScenarioParams;seed:number;actions:CrewAction[];to:number;recordFrom?:number;historyRes?:ResLevel;demonBuoyIds?:number[]}):AcousticEngine{
  const params=clampParams(args.params);
  const engine=new AcousticEngine(generateScenario(params,args.seed),args.seed,{warmRes:true});
  const actions=[...args.actions].sort((a,b)=>a.seq-b.seq||a.simT-b.simT);
  const to=Math.max(0,args.to);
  const recordFrom=args.recordFrom;
  if(recordFrom===undefined||recordFrom>=to){playActions(engine,actions,to);return engine;}
  const startHist=Math.max(0,recordFrom);
  let i=playActions(engine,actions,startHist);
  const res=args.historyRes??RES_DEFAULT;
  armHistory(engine,res);
  if(args.demonBuoyIds){
    for(const id of args.demonBuoyIds){
      try{engine.subscribe({kind:'demon',buoyId:id,band:[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]]});}catch{/* detuned / unknown */}
    }
  }
  const frame=RES_FRAME_S;
  while(engine.time<to-1e-9){
    const nextAct=i<actions.length?actions[i]!.simT:Infinity;
    const target=Math.min(to,engine.time+frame,nextAct);
    const dt=target-engine.time;
    if(dt>1e-12)engine.advance(dt);
    if(i<actions.length&&actions[i]!.simT<=engine.time+1e-9){applyCrewAction(engine,actions[i]!);i++;}
  }
  return engine;
}

function resGrid(buoyIndex:number,nBuoys:number,res:ResLevel,historyStart:number):{start:number;rowRateHz:number;rowPhaseS:number;periodS:number}{
  const p=resParams(res),frames=Math.round(p.rowPeriodS/RES_FRAME_S),phase=Math.floor(buoyIndex*frames/Math.max(1,nBuoys))*RES_FRAME_S;
  const start=Math.floor((historyStart-phase)/p.rowPeriodS+1e-9)*p.rowPeriodS+phase;
  return {start,rowRateHz:p.rowRateHz,rowPhaseS:start+1/p.rowRateHz,periodS:p.rowPeriodS};
}

export interface ExactStreamRows {
  buoyId:number;
  kind:UserCutStreamKind;
  res?:ResLevel;
  filter?:GramFilter;
  bins:number;
  rowPeriodS:number;
  simT0:number;
  rows:{simT:number;data:Float32Array;bearing?:Float32Array}[];
}

function renderExactRes(engine:AcousticEngine,buoyIndex:number,res:ResLevel,filter:GramFilter,simT0:number,simT1:number,historyStart:number):ExactStreamRows{
  const sc=engine.scenario,b=sc.buoys[buoyIndex]!,fmax=sc.fMax??sc.fmax;
  const grid=resGrid(buoyIndex,sc.buoys.length,res,historyStart);
  const gen=new ResLofarGenerator(b,allContactsOf(engine),fmax,sc.seed,sc.environment,{res,filter:'NB'},RES_BINS);
  gen.setWaterColumn?.(sc.waterColumn);
  gen.setHistory(engine.history);
  const due=Math.max(0,Math.floor((engine.time-grid.start)*grid.rowRateHz+1e-9));
  const rows:{simT:number;data:Float32Array;bearing?:Float32Array}[]=[];
  let firstK=-1,lastK=-1;
  for(let k=0;k<due;k++){
    const simT=grid.rowPhaseS+k/grid.rowRateHz;
    if(simT<simT0-1e-9)continue;
    if(simT>simT1+1e-9)break;
    if(firstK<0)firstK=k;lastK=k;
  }
  if(firstK<0)return {buoyId:numericBuoyId(b,buoyIndex),kind:'lofar',res,filter,bins:RES_BINS,rowPeriodS:grid.periodS,simT0,rows:[]};
  gen.seekRowKey(firstK);
  for(let k=firstK;k<=lastK;k++){
    const tEnd=grid.start+(k+1)/grid.rowRateHz,simT=grid.rowPhaseS+k/grid.rowRateHz;
    const data=new Float32Array(RES_BINS);
    if(!isFeeding(b,tEnd)){data.fill(NaN);gen.seekRowKey(k+1);}
    else gen.generateAt(tEnd,data,0);
    const row:{simT:number;data:Float32Array;bearing?:Float32Array}={simT,data};
    if(b.type==='difar'&&gen.bearingRow)row.bearing=Float32Array.from(gen.bearingRow.subarray(0,RES_BINS));
    rows.push(row);
  }
  const t0=rows[0]?.simT??simT0;
  return {buoyId:numericBuoyId(b,buoyIndex),kind:'lofar',res,filter,bins:RES_BINS,rowPeriodS:grid.periodS,simT0:t0,rows};
}

function renderDemon(engine:AcousticEngine,buoyIndex:number,simT0:number,simT1:number):ExactStreamRows|undefined{
  const b=engine.scenario.buoys[buoyIndex]!;
  const id=numericBuoyId(b,buoyIndex);
  // Find a DEMON subscription for this buoy and drain the window.
  const configs=engine.configs();
  const cfg=configs.find(c=>c.kind==='demon'&&c.channel===b.rfChannel);
  if(!cfg)return undefined;
  const need=Math.ceil((simT1-simT0)*4)+8;
  const hist=engine.drainHistory(cfg.streamId,null,need);
  const rows=hist.filter(r=>r.simT>=simT0-1e-9&&r.simT<=simT1+1e-9).map(r=>({simT:r.simT,data:r.data,bearing:r.bearingDeg}));
  return {buoyId:id,kind:'demon',bins:512,rowPeriodS:0.25,simT0:rows[0]?.simT??simT0,rows};
}

export function hashRowData(data:Float32Array):string{
  const h=new CrewHasher();
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  h.mixInt(data.length);
  for(let i=0;i<data.length;i++)h.mixU32(view.getUint32(i*4,true));
  return h.hex;
}

export function stateHashAt(engine:AcousticEngine,t:number):string{
  const h=new CrewHasher();
  h.mixF64(t);
  h.mixU32(engine.scenario.seed>>>0);
  const contacts=engine.scenario.contacts;
  h.mixInt(contacts.length);
  for(const c of contacts){
    h.mixString(c.id);h.mixF64(c.x);h.mixF64(c.y);h.mixF64(c.depth);h.mixF64(c.course);h.mixF64(c.speed);
    h.mixBool(c.active!==false);
  }
  const buoys=engine.scenario.buoys;
  h.mixInt(buoys.length);
  for(const b of buoys){
    h.mixString(b.id);h.mixF64(b.x);h.mixF64(b.y);h.mixF64(b.depth);h.mixF64(b.course??0);h.mixF64(b.speed??0);
    h.mixInt(b.rfChannel);h.mixBool(!!b.placed);h.mixF64(b.deployedAt??NaN);
    if(b.plannedDrop){h.mixF64(b.plannedDrop.x);h.mixF64(b.plannedDrop.y);h.mixInt(b.plannedDrop.order);}
    h.mixF64(b.scuttledAt??NaN);
    h.mixBool(engine.weakSignal.get(b.id)??false);
  }
  const bearings=engine.autoBearings(t);
  h.mixInt(bearings.length);
  for(const b of bearings){
    h.mixInt(b.buoyId);h.mixString(String(b.contactId??''));h.mixF64(b.freqHz);h.mixF64(b.brgDeg);
    h.mixF64(b.quality);h.mixF64(b.snrDb);h.mixF64(b.sigmaDeg);
  }
  const tracks=engine.freqTrackBearings(t);
  h.mixInt(tracks.length);
  for(const tr of tracks){
    h.mixInt(tr.trackId);h.mixInt(tr.buoyId);h.mixF64(tr.freqHz);h.mixF64(tr.brgDeg);
    h.mixF64(tr.sigmaDeg);h.mixF64(tr.snrDb);h.mixF64(tr.quality);h.mixBool(!!tr.locked);h.mixString(String(tr.state??''));
  }
  return h.hex;
}

function lastRowHash(stream:ExactStreamRows):UserCutRowHash{
  const last=stream.rows[stream.rows.length-1];
  const rec:UserCutRowHash={buoyId:stream.buoyId,kind:stream.kind,hash:last?hashRowData(last.data):new CrewHasher().hex};
  if(stream.res!==undefined)rec.res=stream.res;
  return rec;
}

function nodeZlib():{deflateSync:(d:Uint8Array,o?:{level?:number})=>Uint8Array;inflateSync:(d:Uint8Array)=>Uint8Array}|null{
  const proc=(globalThis as {process?:{getBuiltinModule?:(m:string)=>unknown}}).process;
  const z=proc?.getBuiltinModule?.('node:zlib') as {deflateSync?:unknown;inflateSync?:unknown}|undefined;
  if(z&&typeof z.deflateSync==='function'&&typeof z.inflateSync==='function')return z as {deflateSync:(d:Uint8Array,o?:{level?:number})=>Uint8Array;inflateSync:(d:Uint8Array)=>Uint8Array};
  return null;
}

function b64encode(u:Uint8Array):string{
  const cs=0x8000;
  let bin='';
  for(let i=0;i<u.length;i+=cs)bin+=String.fromCharCode(...u.subarray(i,i+cs));
  return btoa(bin);
}
function b64decode(s:string):Uint8Array{
  const bin=atob(s),out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}

function packBytes(u:Uint8Array,preferDeflate:boolean):{encoding:UserCutFallbackEncoding;text:string}{
  const z=preferDeflate?nodeZlib():null;
  if(z){
    const c=z.deflateSync(u,{level:9});
    return {encoding:'u8-0.5db-deflate-b64',text:b64encode(c instanceof Uint8Array?c:new Uint8Array(c))};
  }
  return {encoding:'u8-0.5db-b64',text:b64encode(u)};
}

function unpackBytes(text:string,encoding:UserCutFallbackEncoding):Uint8Array{
  const raw=b64decode(text);
  if(encoding==='u8-0.5db-b64')return raw;
  const z=nodeZlib();
  if(!z)throw new Error('inflate requires node:zlib to decode deflate fallbackRows');
  const o=z.inflateSync(raw);
  return o instanceof Uint8Array?o:new Uint8Array(o);
}

function quantizePlane(rows:{data:Float32Array;bearing?:Float32Array}[],bins:number,kind:'db'|'bearing'):Uint8Array{
  const u=new Uint8Array(rows.length*bins);
  for(let r=0;r<rows.length;r++){
    const src=kind==='db'?rows[r]!.data:rows[r]!.bearing;
    const off=r*bins;
    if(!src){u.fill(255,off,off+bins);continue;}
    if(kind==='db'){for(let i=0;i<bins;i++)u[off+i]=quantizeDb(src[i]!);}
    else{for(let i=0;i<bins;i++)u[off+i]=quantizeBearing(src[i]!);}
  }
  return u;
}


function packEnergyBytes(u:Uint8Array):{encoding:UserCutBearingEnergyEncoding;text:string}{
  const z=nodeZlib();
  if(z){
    const c=z.deflateSync(u,{level:9});
    return {encoding:'u8-deflate-b64',text:b64encode(c instanceof Uint8Array?c:new Uint8Array(c))};
  }
  return {encoding:'u8-b64',text:b64encode(u)};
}
function unpackEnergyBytes(text:string,encoding:UserCutBearingEnergyEncoding):Uint8Array{
  const raw=b64decode(text);
  if(encoding==='u8-b64')return raw;
  const z=nodeZlib();
  if(!z)throw new Error('inflate requires node:zlib to decode bearingEnergy');
  const o=z.inflateSync(raw);
  return o instanceof Uint8Array?o:new Uint8Array(o);
}

/** Pack 1 Hz 360-bin energy rows for DIFAR buoys in `buoyIds` over [t0, t1]. */
export function packBearingEnergy(engine:AcousticEngine,t0:number,t1:number,buoyIds:number[]):UserCutBearingEnergy{
  const band=engine.getBearingEnergyBand();
  const times=energyRowTimes(t0,t1);
  const packed:UserCutBearingEnergyBuoy[]=[];
  let rawBytes=0;
  for(const id of buoyIds){
    const i=engine.scenario.buoys.findIndex((b,idx)=>numericBuoyId(b,idx)===id);
    if(i<0)continue;
    if(inferBuoyType(engine.scenario.buoys[i]!)!=='difar')continue;
    const hist=engine.bearingEnergyHistory(id,t0,t1);
    const u=new Uint8Array(times.length*BEARING_ENERGY_BINS);
    for(let k=0;k<times.length;k++){
      const tk=times[k]!;
      const row=hist.find(r=>Math.abs(r.t-tk)<=1e-9)??engine.bearingEnergy(id,tk);
      if(row)u.set(row.energy,k*BEARING_ENERGY_BINS);
    }
    rawBytes+=u.length;
    const p=packEnergyBytes(u);
    packed.push({buoyId:id,t0:times[0]??t0,count:times.length,encoding:p.encoding,data:p.text});
  }
  return {version:BEARING_ENERGY_PACK_VERSION,scale:BEARING_ENERGY_SCALE,periodS:BEARING_TIME_PERIOD_S,bins:BEARING_ENERGY_BINS,fLo:band[0],fHi:band[1],simT0:t0,simT1:t1,buoys:packed,rawBytes};
}

export function decodeBearingEnergy(pack:UserCutBearingEnergy):DecodedBearingEnergy{
  const buoys:DecodedBearingEnergyRow[]=[];
  for(const b of pack.buoys){
    const u=unpackEnergyBytes(b.data,b.encoding);
    const rows:Uint8Array[]=[];
    for(let k=0;k<b.count;k++)rows.push(u.slice(k*pack.bins,(k+1)*pack.bins));
    buoys.push({buoyId:b.buoyId,t0:b.t0,count:b.count,rows});
  }
  const version=pack.version===2?2:1;
  const scale=pack.scale??(version===2?BEARING_ENERGY_SCALE:'max-norm-u8');
  return {version,scale,periodS:pack.periodS,bins:pack.bins,fLo:pack.fLo,fHi:pack.fHi,simT0:pack.simT0,simT1:pack.simT1,buoys};
}

export function packFallback(streams:ExactStreamRows[]):UserCutFallbackRows{
  let encoding:UserCutFallbackEncoding='u8-0.5db-deflate-b64';
  const out:UserCutFallbackStream[]=[];
  for(const s of streams){
    if(!s.rows.length)continue;
    const db=quantizePlane(s.rows,s.bins,'db');
    const packed=packBytes(db,true);
    encoding=packed.encoding;
    const rec:UserCutFallbackStream={
      buoyId:s.buoyId,kind:s.kind,bins:s.bins,rowPeriodS:s.rowPeriodS,simT0:s.simT0,count:s.rows.length,data:packed.text,
    };
    if(s.res!==undefined)rec.res=s.res;
    if(s.filter)rec.filter=s.filter;
    if(s.rows.some(r=>r.bearing)){
      rec.bearing=packBytes(quantizePlane(s.rows,s.bins,'bearing'),true).text;
    }
    out.push(rec);
  }
  return {encoding,precisionDb:PRECISION_DB,dbStep:DB_STEP,streams:out};
}

export function decodeFallback(pack:UserCutFallbackRows):DecodedFallbackStream[]{
  const enc=pack.encoding;
  return pack.streams.map(s=>{
    const raw=unpackBytes(s.data,enc);
    const data=new Float32Array(s.bins*s.count);
    for(let i=0;i<raw.length&&i<data.length;i++)data[i]=dequantizeDb(raw[i]!);
    const rec:DecodedFallbackStream={buoyId:s.buoyId,kind:s.kind,bins:s.bins,rowPeriodS:s.rowPeriodS,simT0:s.simT0,count:s.count,data};
    if(s.res!==undefined)rec.res=s.res;
    if(s.filter)rec.filter=s.filter;
    if(s.bearing){
      const b=unpackBytes(s.bearing,enc),br=new Float32Array(s.bins*s.count);
      for(let i=0;i<b.length&&i<br.length;i++)br[i]=dequantizeBearing(b[i]!);
      rec.bearing=br;
    }
    return rec;
  });
}

function newUserCutId():string{
  const a=new Uint8Array(8);
  const c=(globalThis as {crypto?:{getRandomValues?:(x:Uint8Array)=>void}}).crypto;
  if(c?.getRandomValues)c.getRandomValues(a);
  else for(let i=0;i<8;i++)a[i]=Math.floor(Math.random()*256);
  return `user-${Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')}`;
}

function normalizeResInView(list?:ResLevel[]):ResLevel[]{
  const src=list&&list.length?list:[RES_DEFAULT];
  const seen=new Set<number>(),out:ResLevel[]=[];
  for(const r of src){if(!isResLevel(r)||seen.has(r))continue;seen.add(r);out.push(r);}
  if(!out.length)out.push(RES_DEFAULT);
  return out;
}

function collectStreams(engine:AcousticEngine,resInView:ResLevel[],filter:GramFilter,includeDemon:boolean,simT0:number,simT1:number,historyStart:number,buoyIds?:number[]):ExactStreamRows[]{
  const streams:ExactStreamRows[]=[];
  const buoys=engine.scenario.buoys;
  const allow=buoyIds?new Set(buoyIds):null;
  for(let i=0;i<buoys.length;i++){
    const id=numericBuoyId(buoys[i]!,i);
    if(allow&&!allow.has(id))continue;
    for(const res of resInView)streams.push(renderExactRes(engine,i,res,filter,simT0,simT1,historyStart));
    if(includeDemon){const d=renderDemon(engine,i,simT0,simT1);if(d)streams.push(d);}
  }
  return streams;
}

export function makeUserCut(engine:AcousticEngine,simT1:number,name:string,opts:MakeUserCutOptions):UserCut{
  const params=clampParams(opts.params);
  const seed=params.seed;
  const t1=Math.max(0,Math.min(Number.isFinite(simT1)?simT1:engine.time,engine.time));
  const t0=Math.max(0,t1-USER_CUT_WINDOW_S);
  const durationS=t1-t0;
  const viewRes=resolveViewRes(opts);
  const fallbackBuoyIds=clampFallbackBuoyIds(opts.visibleBuoyIds,engineBuoyIds(engine));
  const includeDemon=opts.includeDemon!==false;
  const filter=opts.filter??'NB';
  const actions=[...(opts.actions??[])].filter(a=>a.simT<=t1+1e-9).sort((a,b)=>a.seq-b.seq||a.simT-b.simT);
  const historyStart=Math.max(0,t0-USER_CUT_HISTORY_PREFILL_S);
  const demonIds=includeDemon?fallbackBuoyIds:undefined;
  const rendered=recipeEngine({params,seed,actions,to:t1,recordFrom:historyStart,historyRes:viewRes,demonBuoyIds:demonIds});
  const reveal=buildReveal(rendered);
  const filters=buildFilters(reveal,params,opts.preset);
  const streams=collectStreams(rendered,[viewRes],filter,includeDemon,t0,t1,historyStart,fallbackBuoyIds);
  rendered.refreshWeakSignal(t1);
  const check:UserCutCheck={stateHashT1:stateHashAt(rendered,t1),rowHash:streams.map(lastRowHash)};
  const fallbackRows=packFallback(streams);
  const cut:UserCut={
    v:USER_CUT_VERSION,kind:'user',id:opts.id??newUserCutId(),name,createdAt:opts.createdAt??new Date().toISOString(),
    modelVersion:USER_CUT_MODEL_VERSION,seed,params,simT0:t0,simT1:t1,durationS,actions,
    reveal,filters,check,fallbackRows,fallbackBuoyIds,fallbackRes:viewRes,
    bearingEnergy:packBearingEnergy(rendered,t0,t1,fallbackBuoyIds),
  };
  cut.sizeBytes=userCutSizeBytes(cut);
  return cut;
}

function checkMatches(cut:UserCut,stateHashT1:string,rowHash:UserCutRowHash[]):boolean{
  if(cut.modelVersion!==USER_CUT_MODEL_VERSION)return false;
  if(cut.check.stateHashT1!==stateHashT1)return false;
  if(cut.check.rowHash.length!==rowHash.length)return false;
  for(let i=0;i<rowHash.length;i++){
    const a=cut.check.rowHash[i]!,b=rowHash[i]!;
    if(a.buoyId!==b.buoyId||a.kind!==b.kind||a.res!==b.res||a.hash!==b.hash)return false;
  }
  return true;
}

export function loadUserCut(raw:UserCut):UserCutSession{
  if((raw.v!==1&&raw.v!==2)||raw.kind!=='user')throw new Error('Unsupported UserCut');
  const cut=migrateUserCut(raw);
  const params=clampParams(cut.params);
  const viewRes=isResLevel(cut.fallbackRes)?cut.fallbackRes:derivedFallbackRes(cut);
  const buoyIds=cut.fallbackBuoyIds??derivedFallbackBuoyIds(cut);
  const includeDemon=cut.check.rowHash.some(r=>r.kind==='demon')||!!cut.fallbackRows?.streams.some(s=>s.kind==='demon');
  const filter=(cut.fallbackRows?.streams.find(s=>s.filter)?.filter??'NB') as GramFilter;
  const historyStart=Math.max(0,cut.simT0-USER_CUT_HISTORY_PREFILL_S);
  let verified=false;
  try{
    const demonIds=includeDemon?buoyIds:undefined;
    const render=recipeEngine({params,seed:cut.seed,actions:cut.actions,to:cut.simT1,recordFrom:historyStart,historyRes:viewRes,demonBuoyIds:demonIds});
    const streams=collectStreams(render,[viewRes],filter,includeDemon,cut.simT0,cut.simT1,historyStart,buoyIds);
    render.refreshWeakSignal(cut.simT1);
    verified=checkMatches(cut,stateHashAt(render,cut.simT1),streams.map(lastRowHash));
  }catch{
    verified=false;
  }
  const reveal=cut.reveal;
  if(verified){
    const sessionEngine=recipeEngine({params,seed:cut.seed,actions:cut.actions,to:cut.simT0,recordFrom:historyStart,historyRes:viewRes});
    return {cut,mode:'exact',reveal,engine:sessionEngine,buoyStatus:buildBuoyStatus(cut,'exact'),bearingEnergy:cut.bearingEnergy?decodeBearingEnergy(cut.bearingEnergy):undefined};
  }
  if(cut.fallbackRows&&cut.fallbackRows.streams.length){
    return {cut,mode:'fallback',label:USER_CUT_FALLBACK_LABEL,reveal,fallback:decodeFallback(cut.fallbackRows),buoyStatus:buildBuoyStatus(cut,'fallback'),bearingEnergy:cut.bearingEnergy?decodeBearingEnergy(cut.bearingEnergy):undefined};
  }
  return {cut,mode:'mismatch',label:USER_CUT_FALLBACK_LABEL,reveal,buoyStatus:buildBuoyStatus(cut,'mismatch'),bearingEnergy:cut.bearingEnergy?decodeBearingEnergy(cut.bearingEnergy):undefined};
}

/** JSON byte length of a UserCut (UTF-8). `sizeBytes` is omitted from the count. startSnapshot is never present. */
export function userCutJsonBytes(cut:UserCut,opts?:{includeFallback?:boolean}):number{
  const {sizeBytes:_omit,...rest}=cut;
  const body=opts?.includeFallback===false?{...rest,fallbackRows:undefined}:rest;
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/** Cuts-list helper: UTF-8 JSON bytes including fallbackRows, excluding the `sizeBytes` field itself. */
export function userCutSizeBytes(cut:UserCut):number{
  return userCutJsonBytes(cut,{includeFallback:true});
}

/** Advance a recipe engine from t=0 to `to` with no gram / history (pre-roll timing). */
export function prerollRecipe(params:ScenarioParams,seed:number,actions:CrewAction[],to:number):{engine:AcousticEngine;ms:number}{
  const t0=performance.now();
  const engine=recipeEngine({params:clampParams(params),seed,actions,to});
  return {engine,ms:performance.now()-t0};
}

