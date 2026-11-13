import {configurePropulsion,updatePropulsion,writePlantTonals,writeHydpBurst,pickHydpShape,HYDP_MAX_ORDERS,applyIntermittentAuxPowers} from './catalog/plantModel.js';
import type {HydpSpec} from './catalog/drivetrain.js';
import {LineWander} from './lineModel.js';
import {surfaceCount,createSurfacePool,refreshSurfaceSignature} from './catalog/surface.js';
import {DemonStream,bumpDemonWeightTick} from './demonStream.js';
import {DEMON_CARRIER_BAND} from './cuts/norm.js';
import {resolveReference,updateDerivedSignature} from './catalog/derive.js';
import type {ClassParams} from './catalog/schema.js';
import type {Contact} from './scenario.js';
import {mpsToKnots,clamp} from './units.js';
import { validateScenario, loadScenario, type Scenario, type ScenarioInput, type Environment } from './scenario.js';
import { advance } from './kinematics.js';
import { isAlive, isFeeding, isTuned, type ReceiverType, type Buoy } from './buoys.js';
import { LofarGenerator } from './lofar.js';
import {ResLofarGenerator,normalizeResSettings} from './resGram.js';
import {RES_BINS,RES_FRAME_S,TILE_BINS,tileCountFor,tileIndexForHz,priorityTileOrder,tileBand,resSpanS,resParams,resBand,isIntegrationMode,isResLevel,type ResGramSettings,type IntegrationMode} from './res.js';
import type {GramFilter,LofarBandPresetId,ResLevel} from './protocol.js';
import type {GramConfig,Tactical,DropBuoy,TruthContact} from './protocol.js';
import {isLofarBandPresetId,resolveLofarBand} from './bands.js';
import {StateHistory} from './stateHistory.js';
import {WarmBank,type WarmHost} from './warmBank.js';
import {HISTORY_RING_SPAN_S,DrainHandle,PRECISION_DB,BEARING_PRECISION_DEG,type HistoryRow,type DrainState} from './warmRings.js';
export type {HistoryRow,DrainState} from './warmRings.js';
export {DrainHandle} from './warmRings.js';
export {HISTORY_RING_SPAN_S,historyRingRows,historyRingRowsForRes,PRECISION_DB,BEARING_STEP_DEG,BEARING_PRECISION_DEG} from './warmRings.js';

import {sharedScratchBytes,invalidateSpanCache} from './resGram.js';
import {buoyDeployStatus,linkQualityAt,weakSignalByStepping,BUOY_STATUS_SCREEN_ROWS,type BuoyStatus} from './buoyStatus.js';
import {DEFAULT_DROP_ALTITUDE_M,DEFAULT_DESCENT_RATE_MPS,DEFAULT_INTEGRATION_TIME_S,firstEmitTime,isPlaced,validateDrop,validateIntegration,liveTime,type BuoyStartMode} from './deploySequence.js';
import {btProfile, dropBtBuoy, type BtProfile, type BtProfileOpts, type BtDrop} from './btProfile.js';
import {autoBearingsFromState, sendBearingFromPeakAt, type AutoBearing, type AliPeakBearing, type ContactPose} from './autoBearings.js';
import {bfiBandSamplesForBuoy, type BfiBand, type BfiBandSamples} from './bfiBandSamples.js';
import {FreqTrackBook, freqTrackBearingsFromState, type FreqTrackBearing} from './freqTrack.js';
import {routeIsReady, pose, type PlaneRouteSpec} from './planeRoute.js';
import {createAisTrackSource,AIS_DEFAULT_COUNT,AIS_POSITION_JITTER_M,type AisType,type SeededAisTrackSource} from './aisTrackSource.js';
export {AIS_POSITION_JITTER_M} from './aisTrackSource.js';
import {DROP_CAPTURE_TOL_S, firstCaptureTime, isPlanned, type PlannedDrop} from './planeDrop.js';
/** @deprecated Retained for API compat; HYDP no longer curves high→fixed (Wilson squally bar). */
export const HYDP_START_OFFSET_PCT=1.5;
/** Simultaneous tuned RF channels (= FE field cap / bench budget). */
export const MAX_RF_CHANNELS=32;
/** Surface-only AIS track at a sim time. `x`/`y` are engine metres (Reveal frame: x east, y north).
 * `name` is the fictional deterministic signature label (`displayName` of the surface template).
 * Identity and reported heading/COG come from SeededAisTrackSource.decorate on the same truth pose.
 * `class` is an alias of `shipClass` for the web card. */
export interface AisTrack {id:string;name:string;x:number;y:number;/** degrees true, [0, 360) */crsDeg:number;spdMps:number;callsign:string;shipClass:string;class:string;type:AisType;hdgDeg:number|null;hdgAvailable:boolean}
/** Crew host policy. Nil/unset on the engine means solo mode (ungated). Field names match Swift HostPolicy. */
export interface HostPolicy {maxCrew?:number;allowLateJoin?:boolean;allowRevealLocation:boolean;allowAisConnectivity:boolean}
/** Reveal / AIS split: submarines only in Reveal; surface contacts only in AIS. */
export function isSubmarineContact(c:{category?:string}):boolean {return (c.category??'subsurface')!=='surface';}
/** Engine options (all default off = current behaviour, bit-exact goldens). Swift: SimEngineOptions. */
export interface AcousticEngineOptions {
  /** Drop-run buoys (Swift SimEngineOptions.deferUndeployed). While engine time < a buoy's deployedAt, every
   * `advance` silently consumes that buoy's due subscription rows: read cursors and FULLBAND row keys move exactly
   * as the NaN "aboard" rows of the default path would (drained every tick), with nothing rendered or emitted. Rows
   * from the first tick at/after deployedAt keep the same row index, row key and time-keyed noise seeds as the
   * default engine; the stream simply has no rows before that. */
  deferUndeployed?:boolean;
  /** When true, both STI and LSTI spans are ready immediately (pre-fill counts). Default false (cold):
   * LSTI is built on demand; after a switch, rows stay on STI until a real LSTI span of history exists. */
  lstiWarm?:boolean;
  /** When false, the per-(buoy, RES) / DEMON warm rings are not allocated (today's goldens, less CPU).
   * Default true: after StateHistory starts (first RES subscribe), STI FULLBAND/RES 1–9 and the
   * default DEMON band stay warm with time-sized rings. */
  warmRes?:boolean;
  /** History-ring span in seconds (default 900). `rows = ceil(spanS / P)` per RES (113/225/450) and DEMON (3600). */
  ringSpanS?:number;
  /** `lazy` (default): fill a (buoy, RES) ring on first setViewRes/drainHistory by generating from StateHistory (exact for the history window). `eager`: generate every RES 1–9 and default DEMON on every due row (64-buoy RSS bench). */
  warmFill?:'lazy'|'eager';
  /** `placed` (default) = today's goldens, already live. `unplaced` = no scenario buoys until addBuoy/dropBuoy. */
  buoyStartMode?:BuoyStartMode;
  autoDropPattern?:boolean;
  dropAltitudeM?:number;
  descentRateMps?:number;
  integrationTimeS?:number;
}
export interface BuoyRow { id:string; rfChannel:number; depth:number; type:ReceiverType; alive:boolean; bearing:number|null; row:Float32Array }
/** Deterministic mutable simulation; construction owns a JSON-safe copy. step has no allocations.
 * Callers may replace each result.row with an appropriately sized recycled buffer before step. */
export class AcousticEngine {
  readonly scenario:Scenario;readonly rows:BuoyRow[];readonly generators:LofarGenerator[];
  readonly options:{deferUndeployed:boolean;lstiWarm:boolean;warmRes:boolean;ringSpanS:number;warmFill:'lazy'|'eager'};readonly buoyStartMode:BuoyStartMode='placed';
  /** Rows dropped unrendered on undeployed buoys (options.deferUndeployed). */
  aboardRowsSkipped=0;
  private deployAltitudeM=DEFAULT_DROP_ALTITUDE_M;
  private deployDescentRateMps=DEFAULT_DESCENT_RATE_MPS;
  private deployIntegrationTimeS=DEFAULT_INTEGRATION_TIME_S;
  private readonly lineWanders:LineWander[]=[];
  private readonly truthState:{contacts:TruthContact[]};
  /** Reveal view (submarines only). Reused by tactical().truth. */
  private readonly revealState:{contacts:TruthContact[]};
  private readonly allContacts:Contact[];
  private readonly aisSource:SeededAisTrackSource;
  private backgroundAisSource:SeededAisTrackSource|undefined;
  /** Non-null only when this engine is attached to a crew session. Null is solo mode (ungated). */
  crewHostPolicy:HostPolicy|null=null;
  /** Crew session's noAisConnectivity. Ignored in solo mode. */
  crewNoAisConnectivity=false;
  get isCrewSession():boolean {return this.crewHostPolicy!=null;}
  get aisConnectivityAllowed():boolean {
    if(!this.crewHostPolicy)return true;
    if(this.crewNoAisConnectivity)return false;
    return this.crewHostPolicy.allowAisConnectivity;
  }
  get revealLocationAllowed():boolean {
    if(!this.crewHostPolicy)return true;
    return this.crewHostPolicy.allowRevealLocation;
  }
  /** Engine-wide source-state history shared by every RES stream. */
  readonly history:StateHistory;private historyOn=false;private historyStart=0;
  /** Sim time at construction (real-history origin for cold LSTI fill). */
  readonly startTime:number=0;
  /** Per-buoy requested integration mode (default `sti`). */
  private readonly integrationModes:IntegrationMode[]=[];

  private readonly baseContacts:Contact[];
  /** Pose of each allContacts entry at construction (after legs at aisStartTime are snapped). */
  private aisStarts:{x:number;y:number;depth:number;course:number;speed:number}[]=[];
  private aisStartTime=0;
  private readonly catalogStates:{contact:Contact;params:ClassParams;speed:number;depth:number}[]=[];
  private readonly streams=new Map<number,number>();
  /** m3-events: contacts with scheduled HYDP transients (fixed pair slots at `index`). */
  private readonly hydpStates:{contact:Contact;spec:HydpSpec;index:number;at:Float64Array;durationS:Float64Array}[]=[];
  /** m3 diesel-dyn: ratio-locked engine RPM knees (plantRpmScale lerp). */
  private readonly engineRampStates:{contact:Contact;catalog?:ClassParams;baseFraction:number;at:Float64Array;durationS:Float64Array;fromScale:Float64Array;toScale:Float64Array;lastScale:number}[]=[];
  /** Short broadband swath flashes (Wilson). */
  private readonly swathStates:{contact:Contact;at:Float64Array;durationS:Float64Array;loHz:Float64Array;hiHz:Float64Array}[]=[];
  /** Class-specific narrowband TRANSIENT arm windows. */
  private readonly narrowTransientStates:{contact:Contact;index:number;hz:number;harmonics:number;at:Float64Array;durationS:Float64Array}[]=[];
  /** m3-events: pool ships whose leg speed changes refresh their fictional signature in place. */
  private readonly surfaceStates:{contact:Contact;type:string;speed:number}[]=[];
  private warm!:WarmBank;
  private nextDrainId=1;
  private readonly drainJobs=new Map<number,{handle:DrainHandle;streamId:number;buoy:number;res:ResLevel|null;filter:GramFilter;band?:[number,number];onDrainProgress?:(handle:DrainHandle,fromRow:number,toRow:number)=>void}>();
  private readonly subscriptions=new Map<number,{config:GramConfig;start:number;read:number;renderer?:DemonStream;lofar?:LofarGenerator;res?:ResLofarGenerator;warmView?:{res:ResLevel;filter:GramFilter};lastWarmBrg?:Float32Array;bandKey?:string;fullAxis?:{tileBins:number;tileCount:number;visibleTileIndex:number;viewFLo?:number;viewFHi?:number;scheduled:number;queue:{tileIndex:number;rowKey:number;hot:boolean;filled:boolean}[];lastTile:{tileIndex:number;tileBins:number;f0:number;fBin:number;liveBins:number;filled:boolean}}}>();
  /** Shared analytic LOFAR renderers keyed by buoyIndex:f0:fMax. Only subscribed buoy×band pairs
   * exist here; writeRow renders a pair only when that stream is drained. Refcounted on (un)subscribe. */
  private readonly lofarBandCache=new Map<string,{gen:LofarGenerator;refs:number}>();
  private readonly legacyIndices=new Map<number,number>();
  private nextStreamId=1;
  private readonly bearingStorage=Array.from({length:128*8},()=>({buoyId:0,freqHz:0,brgDeg:0,quality:0}));
  private readonly tacticalState:Tactical={v:1,type:'tactical',simT:0,aircraft:{x:0,y:0,altM:300,hdgDeg:0,gsMps:0},buoys:[],bearings:[]};
  private readonly freqBook=new FreqTrackBook();
  private planeRoute:PlaneRouteSpec|null=null;
  /** weakSignal flags keyed by buoy id, last evaluated on the row clock at `this.time`. */
  weakSignal=new Map<string,boolean>();

  private nextPlannedOrder=0;
  constructor(scenario:ScenarioInput,seed?:number,options:AcousticEngineOptions={}){this.options={deferUndeployed:!!options.deferUndeployed,lstiWarm:!!options.lstiWarm,warmRes:options.warmRes!==false,ringSpanS:options.ringSpanS??HISTORY_RING_SPAN_S,warmFill:options.warmFill==='eager'?'eager':'lazy'};if(seed!==undefined)scenario={...scenario,seed};const resolved=loadScenario(scenario);this.scenario=structuredClone(resolved);const s=this.scenario;
    (this as {startTime:number}).startTime=s.time;
    this.integrationModes.length=0;for(let i=0;i<s.buoys.length;i++)this.integrationModes.push('sti');
    // unplaced clears buoys below — modes are rebuilt after that.
    this.deployAltitudeM=s.dropAltitudeM??options.dropAltitudeM??DEFAULT_DROP_ALTITUDE_M;
    this.deployDescentRateMps=s.descentRateMps??options.descentRateMps??DEFAULT_DESCENT_RATE_MPS;
    this.deployIntegrationTimeS=s.integrationTimeS??options.integrationTimeS??DEFAULT_INTEGRATION_TIME_S;
    this.buoyStartMode=options.buoyStartMode??s.buoyStartMode??'placed';
    const autoDrop=!!(options.autoDropPattern??s.autoDropPattern)&&this.buoyStartMode==='unplaced';
    const pattern=autoDrop||this.buoyStartMode==='unplaced'?s.buoys.slice():[];
    if(this.buoyStartMode==='unplaced'){s.buoys=[];this.integrationModes.length=0;}
    s.surfacePool??=createSurfacePool(s.seed,Math.min(18,250-s.contacts.length));this.baseContacts=s.contacts.filter(c=>!s.surfacePool!.some(p=>p.id===c.id));this.allContacts=this.baseContacts.concat(s.surfacePool);
    if(s.surfacePool){const n=surfaceCount(s.surfaceTraffic??0,s.surfacePool.length);s.contacts.length=0;s.contacts.push(...this.baseContacts);for(let i=0;i<s.surfacePool.length;i++){s.surfacePool[i].active=i<n;if(i<n)s.contacts.push(s.surfacePool[i]);}}
    for(const c of this.allContacts){for(const leg of c.motion)if(leg.at<=s.time){c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;}}
    this.aisStartTime=s.time;this.aisStarts=this.allContacts.map(c=>({x:c.x,y:c.y,depth:c.depth,course:c.course,speed:c.speed}));this.aisSource=createAisTrackSource({seed:s.seed,count:0});
    for(const c of this.allContacts)if(c.catalogRef)this.catalogStates.push({contact:c,params:resolveReference(c.catalogRef).params,speed:c.speed,depth:c.depth});
    for(const c of this.allContacts)if(c.params.plantSpec?.hydp&&c.transients?.some(x=>x.kind==='hydp'))c.params.hydpTransient={offsetFrac:0,gain:0,shape:pickHydpShape(s.seed,c.id)};
    for(const c of this.allContacts){configurePropulsion(c.params,s.seed,c.id,c.operatingMode??'normal');if(c.params.plantSpec){const state=this.catalogStates.find(s=>s.contact===c);if(state)updateDerivedSignature(c.params,state.params,mpsToKnots(c.speed),c.depth,c.operatingMode??'normal');else{updatePropulsion(c.params,c.params.shaftHz*60/c.params.plantSpec.maxPsrpm,c.operatingMode??'normal');writePlantTonals(c.params,c.operatingMode??'normal');}}const w=new LineWander(c.params,s.seed,c.id);c.lines=w.lines;this.lineWanders.push(w);}
    for(const c of this.allContacts){if(c.surface&&!c.catalogRef&&c.params.plantSpec&&c.motion.length>1){this.surfaceStates.push({contact:c,type:c.surface.type,speed:c.speed});}
      const spec=c.params.plantSpec?.hydp;if(c.params.hydpTransient&&spec){const list=c.transients!.filter(x=>x.kind==='hydp').sort((a,b)=>a.at-b.at);
      this.hydpStates.push({contact:c,spec,index:c.params.tonals!.findIndex(l=>l.lineFamily==='HYDP'),at:Float64Array.from(list,x=>x.at),durationS:Float64Array.from(list,x=>typeof x.params.durationS==='number'?x.params.durationS:spec.durationS)});}
      const ramps=(c.transients??[]).filter(x=>x.kind==='engine-ramp').sort((a,b)=>a.at-b.at);if(ramps.length&&c.params.plantSpec){const cat=this.catalogStates.find(s=>s.contact===c)?.params;const baseFraction=Math.max(0,c.params.shaftHz*60/c.params.plantSpec.maxPsrpm);this.engineRampStates.push({contact:c,catalog:cat,baseFraction,at:Float64Array.from(ramps,x=>x.at),durationS:Float64Array.from(ramps,x=>Number(x.params.durationS)),fromScale:Float64Array.from(ramps,x=>typeof x.params.fromScale==='number'?x.params.fromScale:1),toScale:Float64Array.from(ramps,x=>Number(x.params.toScale)),lastScale:NaN});c.params.plantRpmScale=1;}
      const swaths=(c.transients??[]).filter(x=>x.kind==='swath').sort((a,b)=>a.at-b.at);if(swaths.length){c.params.eventSwaths=swaths.map((x,i)=>({name:`SWATH-EVT-${i+1}`,kind:'SWATH' as const,loHz:Number(x.params.loHz),hiHz:Number(x.params.hiHz),active:false,gain:0}));this.swathStates.push({contact:c,at:Float64Array.from(swaths,x=>x.at),durationS:Float64Array.from(swaths,x=>Number(x.params.durationS)),loHz:Float64Array.from(swaths,x=>Number(x.params.loHz)),hiHz:Float64Array.from(swaths,x=>Number(x.params.hiHz))});}
      // Arm class-specific TRANSIENT slots from scheduled 'transient' events (or auto-seed one from sheet).
      const narrow=(c.transients??[]).filter(x=>x.kind==='transient').sort((a,b)=>a.at-b.at);const sheet=c.params.plantSpec?.classTransients??[];
      if(sheet.length){const idx=c.params.tonals!.findIndex(l=>l.lineFamily==='TRANSIENT');if(idx>=0){const events=narrow.length?narrow:[{at:90,kind:'transient' as const,params:{durationS:sheet[0].durationS,hz:sheet[0].hz,harmonics:sheet[0].harmonics.length}}];this.narrowTransientStates.push({contact:c,index:idx,hz:sheet[0].hz,harmonics:sheet[0].harmonics.length,at:Float64Array.from(events,x=>x.at),durationS:Float64Array.from(events,x=>Number(x.params.durationS))});}}
    }
    for(const c of this.allContacts){c.params.dutyClockS=s.time;applyIntermittentAuxPowers(c.params);}this.updateHydp();this.updateEngineRamps(true);this.updateSwaths();this.updateNarrowTransients();
    this.truthState={contacts:this.allContacts.map((c,i)=>({speedGated:c.params.speedGated??[],id:i+1,sourceId:c.id,label:c.catalogRef?`${c.params.label} ${resolveReference(c.catalogRef).klass.hulls.find(h=>h.id===c.catalogRef!.hullId)?.number??c.id}`:`${c.params.label} ${c.id}`,propulsion:c.params.propulsion!,spdKts:mpsToKnots(c.speed),active:c.active!==false,category:c.category??'subsurface',...(c.behaviour?{behaviour:c.behaviour}:{}),classificationTarget:c.category!=='surface'&&c.classificationTarget!==false,x:c.x,y:c.y,depthM:c.depth,crsDeg:c.course*180/Math.PI,spdMps:c.speed,lines:c.lines!.map(l=>({eda:l.eda,reactorId:l.reactorId,lineFamily:l.lineFamily,fundamentalHz:l.fundamentalHz,harmonic:l.harmonic,engineId:l.engineId,shaftIndex:l.shaftIndex,id:l.id!,family:l.family,f0Hz:l.hz,freqHz:l.frequencyHz??l.hz,power:l.power,stability:l.stability!,width:l.width!,sigmaBins:l.sigmaBins??0}))}))};for(const c of this.truthState.contacts)if(isSubmarineContact(c))c.kind='submarine';this.revealState={contacts:this.truthState.contacts.filter(c=>c.kind==='submarine')};this.tacticalState.truth=this.revealState;
    this.generators=s.buoys.map(b=>new LofarGenerator(b,this.allContacts,s.bins,s.band?.[1]??s.fMax??s.fmax,s.seed,s.environment,s.band?.[0]??0));
    this.syncPropagationContext();
    s.buoys.forEach((_,i)=>{this.streams.set(i+1,i);this.legacyIndices.set(i+1,0);});
    this.rows=s.buoys.map((b,i)=>({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:this.generators[i].row}));
    s.classificationTargets??=this.baseContacts.filter(c=>c.category!=='surface'&&c.classificationTarget!==false).map(c=>c.id);this.syncTacticalBuoys();
    this.history=new StateHistory(this.allContacts);invalidateSpanCache();
    if(autoDrop){
      for(const b of pattern){
        const order=this.nextPlannedOrder++;
        this.addBuoy({...b,placed:false,deployedAt:undefined,
          plannedDrop:{x:b.x,y:b.y,order},
          dropAltitudeM:s.dropAltitudeM??b.dropAltitudeM??this.deployAltitudeM,
          descentRateMps:s.descentRateMps??b.descentRateMps??this.deployDescentRateMps,
          integrationTimeS:s.integrationTimeS??b.integrationTimeS??this.deployIntegrationTimeS});
      }
    }
    this.warm=new WarmBank(this.asWarmHost());
  }
  private asWarmHost():WarmHost{
    const e=this;
    return {
      get time(){return e.time;},
      get scenario(){return e.scenario;},
      get allContacts(){return e.allContacts;},
      get history(){return e.history;},
      get historyOn(){return e.historyOn;},
      get options(){return e.options;},
      get startTime(){return e.startTime;},
      get historyStart(){return e.historyStart;},
      integrationMode(i){return e.integrationModes[i]??'sti';},
      liveTime(i){return liveTime(e.scenario.buoys[i]!);},
    };
  }
  /** Acoustics-side retained bytes for RES streams: shared state history + shared render scratch +
   * each RES generator's own tables/rows/AR state. Excludes FE-held row history. */
  retainedBytes():{history:number;scratch:number;streams:number;rings:number;total:number;perStream:number[]}{
    const per:number[]=[];for(const sub of this.subscriptions.values())if(sub.res)per.push(sub.res.retainedBytes());
    const history=this.historyOn?this.history.bytes:0,scratch=sharedScratchBytes(),streams=per.reduce((a,b)=>a+b,0),rings=this.warm.bytes();return {history,scratch,streams,rings,total:history+scratch+streams+rings,perStream:per};
  }
  get simT():number{return this.time;}
  get time():number {return this.scenario.time;}
  /** Status of buoy `index` (scenario.buoys order) for the RES `res` window on that buoy's row grid (row ends at
   * rowPhaseS + m·rowPeriodS, the grid of every RES stream of the buoy). Every RES is processed all the time,
   * so this depends only on time, deployedAt and the grid: a RES change never resets it. Read-only, O(1). */
  buoyStatus(index:number,res:ResLevel,screenRows=BUOY_STATUS_SCREEN_ROWS,atSimTime?:number):BuoyStatus{
    const bs=this.scenario.buoys,b=bs[index];if(!b)throw new Error('Unknown buoy index');
    void screenRows;
    return this.statusAt(b,index,res,atSimTime??this.time);
  }
  /** Same for the buoy and row grid of a subscribed stream (RES, FULLBAND, LOFAR or DEMON); undefined if unknown. */
  buoyStatusForStream(streamId:number,screenRows=BUOY_STATUS_SCREEN_ROWS,atSimTime?:number):BuoyStatus|undefined{
    const s=this.subscriptions.get(streamId),i=this.streams.get(streamId);if(!s||i===undefined)return undefined;
    void screenRows;
    const b=this.scenario.buoys[i]!;
    const res=(s.config.res??9) as ResLevel;
    return this.statusAt(b,i,res,atSimTime??this.time);
  }
  /** Plane pose at `t`, or null when no route is set (linkQuality is then 1). */
  planePoseAt(t:number){
    const spec=this.planeRoute;return (spec&&routeIsReady(spec))?pose(spec,t):null;
  }
  private statusAt(b:Buoy,index:number,res:ResLevel,t:number):BuoyStatus{
    const qualityAt=(tau:number)=>linkQualityAt({x:b.x,y:b.y},this.planePoseAt(tau));
    const st=buoyDeployStatus(t,b,this.planePoseAt(t),qualityAt);
    const out={...st,isTuned:isTuned(b),...this.integrationFields(index,res)};
    if(t===this.time)this.weakSignal.set(b.id,out.weakSignal);
    return out;
  }
  /** Recompute weakSignal for every buoy by stepping the row clock to `t` (default: now). */
  refreshWeakSignal(t=this.time):Map<string,boolean>{
    const bs=this.scenario.buoys;
    for(let i=0;i<bs.length;i++){
      const b=bs[i]!;
      const qualityAt=(tau:number)=>linkQualityAt({x:b.x,y:b.y},this.planePoseAt(tau));
      this.weakSignal.set(b.id,weakSignalByStepping(t,qualityAt));
    }
    return this.weakSignal;
  }
  /** Requested mode, current (emitting) span, and cold-LSTI fill. `res` selects the Δf used for the span. */
  integrationFields(index:number,res:ResLevel=9):Pick<BuoyStatus,'integrationMode'|'integrationSpanS'|'lstiFill'|'lstiEtaSeconds'>{
    const requested=this.integrationModes[index]??'sti';
    const p=resParams(res);
    const b=this.scenario.buoys[index];
    const origin=Math.max(this.startTime,b?liveTime(b):this.startTime);
    const avail=Math.max(0,this.time-origin);
    const lstiSpan=resSpanS(p,'lsti');
    const warm=this.options.lstiWarm;
    const ready=requested!=='lsti'||warm||avail+1e-9>=lstiSpan;
    const emitting:IntegrationMode=requested==='lsti'&&ready?'lsti':'sti';
    const lstiFill=requested!=='lsti'||warm?1:Math.min(1,avail/lstiSpan);
    return {integrationMode:requested,integrationSpanS:resSpanS(p,emitting),lstiFill,lstiEtaSeconds:lstiFill>=1?0:Math.max(0,lstiSpan-avail)};
  }
  /** Stream-config slice: requested mode and the span currently emitting (not lstiFill/eta). */
  gramIntegration(index:number,res:ResLevel):Pick<import('./protocol.js').GramConfig,'integrationMode'|'integrationSpanS'>{
    const f=this.integrationFields(index,res);return {integrationMode:f.integrationMode,integrationSpanS:f.integrationSpanS};
  }
  /** Set integration mode for one buoy (`buoyId`) or every buoy (`null`/`undefined` first arg, or a single-arg mode).
   * Does not restart any stream's row clock. DEMON generators are left untouched. */
  setIntegrationMode(mode:IntegrationMode):void;
  setIntegrationMode(buoyId:number|null|undefined,mode:IntegrationMode):void;
  setIntegrationMode(a:IntegrationMode|number|null|undefined,b?:IntegrationMode):void{
    let mode:IntegrationMode;let idxs:number[];
    if(typeof a==='string'){if(!isIntegrationMode(a))throw new Error("Invalid integration mode ('sti'|'lsti')");mode=a;idxs=this.scenario.buoys.map((_,i)=>i);}
    else{if(!isIntegrationMode(b))throw new Error("Invalid integration mode ('sti'|'lsti')");mode=b;idxs=a==null?this.scenario.buoys.map((_,i)=>i):[this.buoyIndex(a)];if(a!=null&&idxs[0]!<0)throw new Error('Unknown buoyId');}
    for(const i of idxs){if(i<0||i>=this.scenario.buoys.length)throw new Error('Unknown buoyId');this.integrationModes[i]=mode;this.syncIntegration(i);}
    invalidateSpanCache();
  }
  private applyIntegrationToGen(gen:ResLofarGenerator,i:number):void{
    const b=this.scenario.buoys[i]!;
    gen.setIntegrationMode(this.integrationModes[i]??'sti',{lstiWarm:this.options.lstiWarm,startTime:this.startTime,liveTime:liveTime(b)});
  }
  private syncIntegration(i:number):void{
    for(const [id,sub] of this.subscriptions){
      if(this.streams.get(id)!==i||!sub.res)continue;
      this.applyIntegrationToGen(sub.res,i);
      const f=this.integrationFields(i,(sub.config.res??9) as ResLevel);
      sub.config={...sub.config,integrationMode:f.integrationMode,integrationSpanS:f.integrationSpanS,simT:this.time};
    }
    this.warm.syncIntegration(i,gen=>this.applyIntegrationToGen(gen,i));
  }
  /** Push water-column context into LOFAR/DEMON/RES so CZ gain (when enabled) can evaluate. */
  private syncPropagationContext():void{
    const wc=this.scenario.waterColumn;
    for(const g of this.generators)g.setWaterColumn?.(wc);
    for(const sub of this.subscriptions.values()){
      sub.lofar?.setWaterColumn?.(wc);
      sub.res?.setWaterColumn?.(wc);
      sub.renderer?.setWaterColumn?.(wc);
    }
    this.warm?.setWaterColumn(wc);
  }
    setEnvironment(environment:Environment):void {
    const next={...this.scenario,environment};validateScenario(next);
    this.scenario.environment={...environment};for(const generator of this.generators)generator.setEnvironment(environment);for(const sub of this.subscriptions.values()){sub.lofar?.setEnvironment(environment);sub.res?.setEnvironment(environment);sub.renderer?.setEnvironment(environment);}
    this.warm?.setEnvironment(environment);
    this.syncPropagationContext();
  }
  setSurfaceTraffic(v:number):void{v=Number.isFinite(v)?clamp(v,0,1):.5;this.scenario.surfaceTraffic=v;const pool=this.scenario.surfacePool;if(pool){const n=surfaceCount(v,pool.length),contacts=this.scenario.contacts;contacts.length=this.baseContacts.length;for(let i=0;i<pool.length;i++){pool[i].active=i<n;if(i<n)contacts.push(pool[i]);}}this.setEnvironment({...this.scenario.environment,shippingDensity:v,shipping:v<.33?'light':v<.67?'moderate':'heavy'});}
  registerStream(id:number,channel:number):void {if(!(channel>0))throw new Error('Unknown RF channel');const i=this.scenario.buoys.findIndex(b=>b.rfChannel===channel);if(i<0)throw new Error('Unknown RF channel');this.streams.set(id,i);if(!this.legacyIndices.has(id))this.legacyIndices.set(id,0);}
  addBuoy(b:Buoy):void {
    if(b.placed===false){validateDrop(b.dropAltitudeM??this.deployAltitudeM,b.descentRateMps??this.deployDescentRateMps);validateIntegration(b.integrationTimeS??this.deployIntegrationTimeS);}
    if(isPlanned(b)&&!b.plannedDrop)b={...b,plannedDrop:{x:b.x,y:b.y,order:this.nextPlannedOrder++}};
    else if(b.plannedDrop)this.nextPlannedOrder=Math.max(this.nextPlannedOrder,b.plannedDrop.order+1);
    const next={...this.scenario,buoys:[...this.scenario.buoys,b]};validateScenario(next);if(b.rfChannel>0&&this.scenario.buoys.some(x=>x.rfChannel===b.rfChannel))throw new Error('RF channel already used');this.scenario.buoys.push({...b});const owned=this.scenario.buoys[this.scenario.buoys.length-1];const g=new LofarGenerator(owned,this.allContacts,this.scenario.bins,this.scenario.fmax,this.scenario.seed,this.scenario.environment);g.setWaterColumn?.(this.scenario.waterColumn);this.generators.push(g);this.rows.push({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:g.row});invalidateSpanCache();this.integrationModes.push('sti');this.syncTacticalBuoys();if(this.historyOn)this.warm.ensure();}
  /** Subscription rows are ready at 4 Hz since subscribe; legacy registered streams remain pull-based.
   * If multiple rows accumulate, each is rendered using current geometry (no historical snapshot queue). */
  subscribe(req:{kind:'demon';buoyId:number;band?:[number,number]}):number;
  /** RES mode: any of res/filter/vernierHz selects the RES 1–9 zoom-FFT gram (1024 bins, defaults
   * res 5, NB, full band). Without them the legacy 4 Hz analytic gram is kept for compatibility.
   * Named LOFAR band presets (ELF/VLF/LF/MF) apply only to the legacy 4 Hz path; explicit `band`
   * wins over `bandPreset` when both are given. */
  subscribe(req:{channel:number;kind?:'lofar';bins?:number;band?:[number,number];bandPreset?:LofarBandPresetId;res?:number;filter?:GramFilter;vernierHz?:number;fullAxis?:boolean;visibleTileIndex?:number}):GramConfig;
  subscribe(req:{channel?:number;buoyId?:number;kind?:'lofar'|'demon';bins?:number;band?:[number,number];bandPreset?:LofarBandPresetId;res?:number;filter?:GramFilter;vernierHz?:number;fullAxis?:boolean;visibleTileIndex?:number}):GramConfig|number {
    if(req.kind==='demon'){
      const i=this.scenario.buoys.findIndex((b,i)=>(Number(b.id.replace(/\D/g,''))||i+1)===req.buoyId);if(i<0)throw new Error('Unknown buoyId');
      const band=req.band??[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]];if(band.length!==2||!band.every(Number.isFinite)||band[0]<20||band[1]>6000||band[1]-band[0]<1e-6)throw new Error('Invalid DEMON carrier band (20..6000 Hz)');
      const b=this.scenario.buoys[i];if(!isTuned(b))throw new Error('Buoy detuned');
      // Idempotent: a live DEMON sub on the same buoy and carrier band is reused (existing stream id,
      // same read cursor). A different band, or a re-subscribe after unsubscribe, allocates a new stream.
      // LOFAR and RES are not idempotent: each subscribe has its own read cursor, and existing tests
      // and goldens assume a new stream id.
      for(const [id,sub] of this.subscriptions){const c=sub.config;if(c.kind==='demon'&&this.streams.get(id)===i&&c.demodBandHz?.[0]===band[0]&&c.demodBandHz?.[1]===band[1])return id;}
      while(this.streams.has(this.nextStreamId))this.nextStreamId++;const id=this.nextStreamId++;this.registerStream(id,b.rfChannel);
      const start=Math.floor(this.time*4)/4,rowRateHz=4;
      // One DemonStream: the warm-ring writer. writeRow copies from the ring (no second write).
      const slot=this.warm.ensureDemon(i,[band[0],band[1]]);slot.streamId=id;
      const renderer=slot.renderer;
      const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId:id,kind:'demon',channel:b.rfChannel,bins:512,f0:0,fBin:renderer.fBin,rowRateHz,rowPhaseS:start+1/rowRateHz,dbFloor:0,dbCeil:30,demodBandHz:[band[0],band[1]]};
      this.subscriptions.set(id,{config,start,read:0,renderer});return id;
    }

    const s=this.scenario;
    if(req.kind!==undefined&&req.kind!=='lofar')throw new Error('Unsupported gram kind: M1 supports lofar only');
    if(req.bandPreset!==undefined&&!isLofarBandPresetId(req.bandPreset))throw new Error('Unknown LOFAR band preset');
    if(req.res!==undefined||req.filter!==undefined||req.vernierHz!==undefined||req.fullAxis){
      if(req.fullAxis&&req.bins!==undefined&&req.bins!==TILE_BINS)throw new Error(`Unsupported bins: FULLBAND tiles use ${TILE_BINS}`);
      if(!req.fullAxis&&req.bins!==undefined&&req.bins!==RES_BINS)throw new Error(`Unsupported bins: RES grams use ${RES_BINS}`);
      if(req.band!==undefined||req.bandPreset!==undefined)throw new Error('band/bandPreset and res/filter/vernierHz are exclusive; use vernierHz');
      if(req.channel===undefined)throw new Error('LOFAR channel required');
      const settings=normalizeResSettings(req);while(this.streams.has(this.nextStreamId))this.nextStreamId++;
      const id=this.nextStreamId;this.registerStream(id,req.channel);this.nextStreamId++;
      return this.applyRes(id,settings,{fullAxis:!!req.fullAxis,visibleTileIndex:req.visibleTileIndex});
    }
    if(req.bins!==undefined&&req.bins!==s.bins)throw new Error(`Unsupported bins: scenario requires ${s.bins}`);
    // Precedence: explicit band > bandPreset > scenario default. bandPreset is stamped on
    // gramConfig only when it alone supplied the edges (no overriding explicit band).
    const fromPreset=req.band===undefined&&req.bandPreset!==undefined;
    const band=req.band!==undefined?resolveLofarBand(req.band):req.bandPreset!==undefined?resolveLofarBand(req.bandPreset):resolveLofarBand(s.band??[0,s.fMax??s.fmax]);
    while(this.streams.has(this.nextStreamId))this.nextStreamId++;
    const streamId=this.nextStreamId;if(req.channel===undefined)throw new Error('LOFAR channel required');this.registerStream(streamId,req.channel);this.nextStreamId++;
    const start=Math.floor(this.time*4)/4,rowRateHz=4;
    const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:req.channel,bins:s.bins,f0:band[0],fBin:(band[1]-band[0])/(s.bins-1),rowRateHz,rowPhaseS:start+1/rowRateHz,dbFloor:40,dbCeil:110,...(fromPreset?{bandPreset:req.bandPreset}:{})};
    const index=this.streams.get(streamId)!,base=this.generators[index];
    let lofar:LofarGenerator|undefined,bandKey:string|undefined;
    if(base.f0===band[0]&&base.fmax===band[1])lofar=undefined;
    else{
      bandKey=`${index}:${band[0]}:${band[1]}`;
      let entry=this.lofarBandCache.get(bandKey);
      if(!entry){const gen=new LofarGenerator(s.buoys[index],this.allContacts,s.bins,band[1],s.seed,s.environment,band[0]);gen.setWaterColumn?.(s.waterColumn);entry={gen,refs:0};this.lofarBandCache.set(bandKey,entry);}
      entry.refs++;lofar=entry.gen;
    }
    this.subscriptions.set(streamId,{config,start,read:0,lofar,bandKey});return config;
  }
  /** Change RES/filter/vernier on an existing LOFAR stream (legacy registered, legacy subscribed or
   * RES). Omitted fields keep the stream's current RES settings (legacy streams start from res 5,
   * NB, full band); vernierHz:null returns to full band. Restarts the row clock on the new period
   * grid (rows at multiples of P) and the row counter; returns the new gramConfig. */
  setGram(streamId:number,patch:{res?:number;filter?:GramFilter;vernierHz?:number|null;fullAxis?:boolean|null;visibleTileIndex?:number}):GramConfig{
    if(!this.streams.has(streamId))throw new Error('Unknown streamId');const sub=this.subscriptions.get(streamId);
    if(sub?.renderer||(sub&&sub.config.kind!=='lofar'))throw new Error('setGram applies to LOFAR streams only');
    const base:ResGramSettings=sub?.res?.settings??{res:5,filter:'NB'};
    const fullAxis=patch.fullAxis===null?false:patch.fullAxis??!!sub?.fullAxis;
    const visibleTileIndex=patch.visibleTileIndex??sub?.fullAxis?.visibleTileIndex;
    return this.applyRes(streamId,normalizeResSettings({res:patch.res??base.res,filter:patch.filter??base.filter,vernierHz:patch.vernierHz===null?undefined:patch.vernierHz??base.vernierHz}),{fullAxis,visibleTileIndex});
  }
  /** FULLBAND: set the visible frequency window (Hz). Drives visibleTileIndex from the window
   * centre and re-prioritises the pending tile queue (visible±1 hot). Does not restart the row
   * clock — safe for ~10 Hz pan/zoom. Re-emits gramConfig with viewFLo/viewFHi. */
  setViewWindow(streamId:number,win:{fLo:number;fHi:number}):GramConfig{
    const sub=this.subscriptions.get(streamId);if(!sub?.fullAxis||!sub.config.fullAxis)throw new Error('setViewWindow requires a FULLBAND stream');
    const {fLo,fHi}=win;if(!Number.isFinite(fLo)||!Number.isFinite(fHi)||!(fLo<fHi)||fLo<0||fHi>1e6)throw new Error('Invalid view window');
    const fa=sub.fullAxis,fBin=sub.config.fBin,centre=.5*(fLo+fHi);
    const visible=tileIndexForHz(centre,fBin,fa.tileBins,fa.tileCount);
    fa.visibleTileIndex=visible;fa.viewFLo=fLo;fa.viewFHi=fHi;
    // Reprioritise pending work: jobs for visible±1 become hot and jump ahead of backfill.
    if(fa.queue.length){
      const hotSet=new Set(priorityTileOrder(visible,fa.tileCount).slice(0,Math.min(3,fa.tileCount)));
      const hot:typeof fa.queue=[],bf:typeof fa.queue=[];
      for(const j of fa.queue){(hotSet.has(j.tileIndex)?hot:bf).push({...j,hot:hotSet.has(j.tileIndex)});}
      fa.queue=hot.concat(bf);
    }
    const t0=tileBand(sub.config.res!,visible,this.scenario.fMax??this.scenario.fmax,fa.tileBins);
    const config:GramConfig={...sub.config,simT:this.time,visibleTileIndex:visible,viewFLo:fLo,viewFHi:fHi,f0:t0.f0,liveBins:t0.liveBins,bandLimited:t0.bandLimited};
    sub.config=config;return config;
  }
  /** Current RES settings of a stream, or undefined for legacy/DEMON streams. */
  gramSettings(streamId:number):ResGramSettings|undefined{const r=this.subscriptions.get(streamId)?.res;return r?{...r.settings}:undefined;}
  private applyRes(streamId:number,settings:ResGramSettings,opts:{fullAxis?:boolean;visibleTileIndex?:number}={}):GramConfig{
    const i=this.streams.get(streamId)!,s=this.scenario,b=s.buoys[i],old=this.subscriptions.get(streamId),fmax=s.fMax??s.fmax,fullAxis=!!opts.fullAxis;
    // Recreate generator when capacity must change (vernier 1024 ↔ FULLBAND 4096).
    const needCap=fullAxis?TILE_BINS:RES_BINS;
    let gen=old?.res;
    if(!gen||gen.capacity!==needCap){gen?.dispose();gen=new ResLofarGenerator(b,this.allContacts,fmax,s.seed,s.environment,settings,needCap);gen.setWaterColumn?.(s.waterColumn);gen.setHistory(this.history);this.applyIntegrationToGen(gen,i);}
    // History starts with the first RES stream (pre-filled with the state at that instant).
    if(!this.historyOn){this.historyOn=true;this.historyStart=this.time;this.history.record(this.time);}
    else{gen.configure(settings);invalidateSpanCache();}
    this.warm.markDisplayed(i);this.warm.setViewed(i,settings.res);this.warm.ensure();
    const p=gen.params,frames=Math.round(p.rowPeriodS/RES_FRAME_S),phase=Math.floor(i*frames/s.buoys.length)*RES_FRAME_S;
    const start=Math.floor((this.time-phase)/p.rowPeriodS+1e-9)*p.rowPeriodS+phase,rowPhaseS=start+1/p.rowRateHz;
    if(fullAxis){
      const tileBins=TILE_BINS,tileCount=tileCountFor(fmax,p.fBin,tileBins);
      let visible=opts.visibleTileIndex;
      if(visible===undefined&&settings.vernierHz!==undefined)visible=tileIndexForHz(settings.vernierHz,p.fBin,tileBins,tileCount);
      if(visible===undefined)visible=old?.fullAxis?.visibleTileIndex??0;
      visible=Math.max(0,Math.min(tileCount-1,visible|0));
      const t0=tileBand(settings.res,visible,fmax,tileBins);
      gen.prepareFullAxis(tileCount,visible);gen.selectTile(visible,tileBins);
      const viewFLo=old?.fullAxis?.viewFLo,viewFHi=old?.fullAxis?.viewFHi;
      const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:b.rfChannel,bins:tileBins,f0:0,fBin:p.fBin,rowRateHz:p.rowRateHz,dbFloor:settings.filter==='NB'?0:40,dbCeil:settings.filter==='NB'?30:110,res:settings.res,filter:settings.filter,bandHz:fmax,enbwHz:p.enbwHz,bandLimited:t0.bandLimited,liveBins:t0.liveBins,rowPhaseS,fullAxis:true,tileBins,tileCount,visibleTileIndex:visible,...(viewFLo!==undefined&&viewFHi!==undefined?{viewFLo,viewFHi}:{}),...this.gramIntegration(i,settings.res)};
      this.subscriptions.set(streamId,{config,start,read:0,res:gen,fullAxis:{tileBins,tileCount,visibleTileIndex:visible,viewFLo,viewFHi,scheduled:0,queue:[],lastTile:{tileIndex:t0.tileIndex,tileBins,f0:t0.f0,fBin:t0.fBin,liveBins:t0.liveBins,filled:true}}});
      if(!this.legacyIndices.has(streamId))this.legacyIndices.set(streamId,0);return config;
    }
    const band=gen.band,config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:b.rfChannel,bins:RES_BINS,f0:band.f0,fBin:p.fBin,rowRateHz:p.rowRateHz,dbFloor:settings.filter==='NB'?0:40,dbCeil:settings.filter==='NB'?30:110,res:settings.res,filter:settings.filter,bandHz:p.bandHz,...(settings.vernierHz!==undefined?{fcHz:band.fcHz}:{}),enbwHz:p.enbwHz,bandLimited:band.bandLimited,liveBins:band.liveBins,rowPhaseS,...this.gramIntegration(i,settings.res)};
    // Vernier and FULLBAND are not warm — only a standard 1024-bin RES view copies from the ring.
    const warmOk=settings.vernierHz===undefined;
    if(warmOk)this.warm.ensureRes(i,settings.res);
    this.subscriptions.set(streamId,{config,start,read:0,res:gen,...(warmOk?{warmView:{res:settings.res,filter:(settings.filter??'NB') as GramFilter}}: {})});if(!this.legacyIndices.has(streamId))this.legacyIndices.set(streamId,0);return config;
  }
  /** Last FULLBAND tile metadata written by writeRow (test/FE introspection). */
  lastFullAxisTile(streamId:number):{tileIndex:number;tileBins:number;f0:number;fBin:number;liveBins:number;filled:boolean}|undefined{return this.subscriptions.get(streamId)?.fullAxis?.lastTile;}
  private enqueueFullAxis(sub:{fullAxis:{tileCount:number;visibleTileIndex:number;scheduled:number;queue:{tileIndex:number;rowKey:number;hot:boolean;filled:boolean}[]};start:number;config:GramConfig}):void{
    const fa=sub.fullAxis!;const due=Math.max(0,Math.floor((this.time-sub.start)*sub.config.rowRateHz+1e-9));
    while(fa.scheduled<due){
      const rowKey=fa.scheduled++,order=priorityTileOrder(fa.visibleTileIndex,fa.tileCount),hotN=Math.min(3,order.length);
      // Real renders only (filled:true). FE paints missing tiles dark/unfilled — no noise invented.
      const hot=order.slice(0,hotN).map(tileIndex=>({tileIndex,rowKey,hot:true,filled:true})),rest=order.slice(hotN).map(tileIndex=>({tileIndex,rowKey,hot:false,filled:true}));
      const prevHot=fa.queue.filter(j=>j.hot),prevBf=fa.queue.filter(j=>!j.hot);
      fa.queue=prevHot.concat(hot,prevBf,rest);
    }
  }
  /** Drop a subscribed stream and release its generator. Returns true if a live stream was
   * removed. An unknown id is a no-op (false) and never throws. Stream ids are never reused. */
  unsubscribe(streamId:number):boolean{
    const sub=this.subscriptions.get(streamId);if(!sub)return false;sub.res?.dispose();if(sub.bandKey){const entry=this.lofarBandCache.get(sub.bandKey);if(entry&&--entry.refs<=0)this.lofarBandCache.delete(sub.bandKey);}
    this.cancelDrainsForStream(streamId,'unsub');
    this.subscriptions.delete(streamId);this.streams.delete(streamId);this.legacyIndices.delete(streamId);if(sub.res)invalidateSpanCache();return true;
  }
  /** Active subscribed legacy-LOFAR buoy×band pairs (one entry per stream). Unused combinations
   * are not rendered: only these pairs have a cached renderer, and writeRow generates a row only
   * when that stream is drained. RES/DEMON streams are omitted. */
  lofarBandPairs():{streamId:number;channel:number;f0:number;fMax:number;bandPreset?:LofarBandPresetId}[]{
    const out:{streamId:number;channel:number;f0:number;fMax:number;bandPreset?:LofarBandPresetId}[]=[];
    for(const [streamId,sub] of this.subscriptions){const c=sub.config;if(c.kind!=='lofar'||c.res!==undefined)continue;out.push({streamId,channel:c.channel,f0:c.f0,fMax:c.f0+c.fBin*(c.bins-1),...(c.bandPreset?{bandPreset:c.bandPreset}:{})});}
    return out;
  }
  /** Number of distinct cached non-default buoy×band LOFAR renderers (test/FE introspection). */
  lofarBandCacheSize():number{return this.lofarBandCache.size;}
  configs():GramConfig[]{return Array.from(this.subscriptions.values(),s=>s.config);}
  rowsReady(streamId:number):number{const s=this.subscriptions.get(streamId);if(!s)return this.streams.has(streamId)?1:0;if(s.fullAxis){this.enqueueFullAxis(s as {fullAxis:NonNullable<typeof s.fullAxis>;start:number;config:GramConfig});return s.fullAxis.queue.length;}return Math.max(0,Math.floor((this.time-s.start)*s.config.rowRateHz+1e-9)-s.read);}
  /** Current stream config, including `rowPhaseS` (sim time of row 0) and `rowRateHz`. */
  streamConfig(streamId:number):GramConfig{const s=this.subscriptions.get(streamId);if(!s)throw new Error('Unknown streamId');return s.config;}
  /** Bytes held by engine-owned warm rings (RES 1–9 NB+BB + DEMON, including bearings). */
  ringBytes():number{return this.warm.bytes();}
  allocateRingCapacity():void{this.warm.allocateCapacity();}
  /** Change the view of a LOFAR/RES stream to `res` (optional filter / vernier) without minting a
   * new stream id. RES and NB/BB do not restart the row clock: the destination RES's warm ring
   * (running since history started) is attached and `rowPhaseS` / `rowRateHz` are that RES's.
   * A vernier change may still rebuild the stream (clock may restart) until a golden proves
   * vernier ≡ FULLBAND slice. Returns the updated gramConfig. */
  setViewRes(streamId:number,res:number,opts?:{filter?:GramFilter;vernierHz?:number|null}):GramConfig{
    const sub=this.subscriptions.get(streamId),i=this.streams.get(streamId);
    if(!sub||i===undefined)throw new Error('Unknown streamId');
    if(sub.renderer||sub.config.kind==='demon')throw new Error('setViewRes applies to LOFAR/RES streams only');
    if(!isResLevel(res))throw new Error('Invalid res');
    this.cancelDrainsForStream(streamId,'view');
    const vernierPatch=opts!==undefined&&Object.prototype.hasOwnProperty.call(opts,'vernierHz');
    if(vernierPatch){
      const filter=opts!.filter??sub.config.filter??'NB';
      const vernierHz=opts!.vernierHz===null||opts!.vernierHz===undefined?undefined:opts!.vernierHz;
      return this.applyRes(streamId,normalizeResSettings({res,filter,vernierHz}),{fullAxis:!!sub.fullAxis,visibleTileIndex:sub.fullAxis?.visibleTileIndex});
    }
    if(sub.fullAxis)throw new Error('setViewRes is for 1024-bin RES views (not FULLBAND)');
    this.warm.markDisplayed(i);this.warm.setViewed(i,res);this.warm.ensure();const slot=this.warm.ensureRes(i,res);
    const filter=(opts?.filter??sub.config.filter??'NB') as GramFilter;
    const fmax=this.scenario.fMax??this.scenario.fmax,p=resParams(res),band=resBand(res,undefined,fmax);
    const integ=this.gramIntegration(i,res),b=this.scenario.buoys[i]!;
    const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:b.rfChannel,bins:RES_BINS,f0:band.f0,fBin:p.fBin,rowRateHz:slot.rowRateHz,rowPhaseS:slot.rowPhaseS,dbFloor:filter==='NB'?0:40,dbCeil:filter==='NB'?30:110,res,filter,bandHz:p.bandHz,enbwHz:p.enbwHz,bandLimited:band.bandLimited,liveBins:band.liveBins,...integ};
    sub.config=config;sub.start=slot.start;sub.read=slot.written;sub.warmView={res,filter};
    return config;
  }
  /** Retained history of a stream, oldest first. For DEMON pass `res=null` (a non-null res throws).
   * For RES/LOFAR pass the ResLevel to read (may differ from the current view). Each row's
   * `simT` equals `rowPhaseS+k/rowRateHz`. 8-bit (non-displayed) rows are flagged `quantized`. */
  drainHistory(streamId:number,res:ResLevel|null,rows:number):HistoryRow[]{
    const sub=this.subscriptions.get(streamId),i=this.streams.get(streamId);
    if(!sub||i===undefined)throw new Error('Unknown streamId');
    if(this.historyOn){this.warm.ensure();this.warm.tick();}
    if(sub.renderer||sub.config.kind==='demon'){
      if(res!==null&&res!==undefined)throw new Error('drainHistory: DEMON requires res=null');
      const band=sub.config.demodBandHz??[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]];
      return this.warm.drainDemon(i,[band[0],band[1]],rows);
    }
    if(res===null||res===undefined)throw new Error('drainHistory: RES/LOFAR requires a ResLevel');
    if(!isResLevel(res))throw new Error('Invalid res');
    const filter=(sub.warmView?.filter??sub.config.filter??'NB') as GramFilter;
    return this.warm.drainRes(i,res,filter,rows);
  }
  /** Start a chunked most-recent-first drain. Returns immediately with a new handle whose
   * `rows` buffer is oldest-first, preallocated to `rows` entries, unfilled bins NaN (not
   * zero), and `filledFrom === rows.length`. Pump with `pumpDrain` (default ~16 ms budget).
   * `onDrainProgress(handle, fromRow, toRow)` fires with the inclusive range that just landed.
   * A running drain on the same stream is auto-cancelled (its handle freezes; no further
   * writes or events). Each call returns a new handle and a new buffer. */
  beginDrain(streamId:number,res:ResLevel|null,rows:number,opts?:{onDrainProgress?:(handle:DrainHandle,fromRow:number,toRow:number)=>void}):DrainHandle{
    const sub=this.subscriptions.get(streamId),i=this.streams.get(streamId);
    if(!sub||i===undefined)throw new Error('Unknown streamId');
    if(this.historyOn){this.warm.ensure();this.warm.tick();}
    const isDemon=!!(sub.renderer||sub.config.kind==='demon');
    if(isDemon){if(res!==null&&res!==undefined)throw new Error('beginDrain: DEMON requires res=null');}
    else{if(res===null||res===undefined)throw new Error('beginDrain: RES/LOFAR requires a ResLevel');if(!isResLevel(res))throw new Error('Invalid res');}
    this.cancelDrainsForStream(streamId,'auto');
    let bins=sub.config.bins,rowPhaseS=sub.config.rowPhaseS??0,rowRateHz=sub.config.rowRateHz,hasBearing=false,filter:GramFilter='NB';
    let band:[number,number]|undefined,written=0;
    if(isDemon){
      band=(sub.config.demodBandHz??[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]]) as [number,number];
      const slot=this.warm.demonSlot(i,band);
      if(slot){rowPhaseS=slot.rowPhaseS;rowRateHz=slot.rowRateHz;bins=512;written=slot.written;}
    }else{
      filter=(sub.warmView?.filter??sub.config.filter??'NB') as GramFilter;
      const slot=this.warm.ensureRes(i,res as ResLevel);
      rowPhaseS=slot.rowPhaseS;rowRateHz=slot.rowRateHz;bins=RES_BINS;written=slot.written;
      hasBearing=this.scenario.buoys[i]!.type==='difar';
    }
    const n=Math.min(Math.max(0,Math.floor(rows)),written);
    const buf:HistoryRow[]=[];
    for(let k=0;k<n;k++){
      const data=new Float32Array(bins);data.fill(Number.NaN);
      const row:HistoryRow={k,simT:rowPhaseS+k/rowRateHz,data};
      if(hasBearing){const b=new Float32Array(bins);b.fill(Number.NaN);row.bearingDeg=b;}
      buf.push(row);
    }
    const handle=new DrainHandle(this.nextDrainId++,streamId,isDemon?null:(res as ResLevel),buf);
    if(n===0)return handle;
    this.drainJobs.set(handle.id,{handle,streamId,buoy:i,res:isDemon?null:(res as ResLevel),filter,band,onDrainProgress:opts?.onDrainProgress});
    return handle;
  }
  /** Freeze a running drain: `filledFrom` and `rows` stay as they are; no further writes or
   * `onDrainProgress` events. A no-op on an already frozen or unknown handle. */
  cancelDrain(handle:DrainHandle|number):void{
    const id=typeof handle==='number'?handle:handle.id;
    const job=this.drainJobs.get(id);if(!job||job.handle.state!=='running')return;
    job.handle._setState('cancelled');
    this.drainJobs.delete(id);
  }
  private cancelDrainsForStream(streamId:number,_why:'auto'|'unsub'|'view'):void{
    for(const [id,job] of this.drainJobs){
      if(job.streamId!==streamId||job.handle.state!=='running')continue;
      job.handle._setState('cancelled');
      this.drainJobs.delete(id);
    }
  }
  /** Fill the next most-recent unfilled chunk. Default budget is 16 ms; pass `maxRows` to
   * bound the chunk in tests. Returns the handle's (possibly frozen) state. */
  pumpDrain(handle:DrainHandle,opts?:{budgetMs?:number;maxRows?:number}):DrainState{
    const job=this.drainJobs.get(handle.id);
    if(!job||job.handle.state!=='running')return handle.state;
    const h=job.handle,end=h.filledFrom;
    if(end<=0){h._setState('done');this.drainJobs.delete(h.id);return h.state;}
    if(this.historyOn){this.warm.ensure();this.warm.tick();}
    // Most-recent-first: fill a complete suffix [lo, end) then publish. maxRows is exact;
    // budgetMs (default 16) estimates a conservative row count (~0.5 ms/row).
    const maxRows=opts?.maxRows??Math.max(1,Math.round((opts?.budgetMs??16)/0.5));
    const lo=Math.max(0,end-maxRows);
    this.fillDrainRange(job,lo,end);
    if(h.state!=='running')return h.state;
    h._setFilledFrom(lo);
    job.onDrainProgress?.(h,lo,end-1);
    if(h.state!=='running')return h.state;
    if(lo<=0){h._setState('done');this.drainJobs.delete(h.id);}
    return h.state;
  }
  private fillDrainRange(job:{handle:DrainHandle;buoy:number;res:ResLevel|null;filter:GramFilter;band?:[number,number];onDrainProgress?:(handle:DrainHandle,fromRow:number,toRow:number)=>void},lo:number,end:number):void{
    const h=job.handle;if(h.state!=='running')return;
    if(job.res===null){
      const slot=this.warm.demonSlot(job.buoy,job.band??[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]]);
      if(!slot)return;
      for(let k=lo;k<end;k++){
        if(h.state!=='running')return;
        const row=h.rows[k]!;
        slot.ring.get(k,row.data);
      }
      return;
    }
    const slot=this.warm.ensureRes(job.buoy,job.res);
    if(job.filter==='BB'){
      const got=this.warm.deriveBBRange(slot,job.buoy,lo,end);
      for(const r of got){
        if(h.state!=='running')return;
        const dst=h.rows[r.k]!;
        dst.data.set(r.data);
        if(r.bearingDeg){if(!dst.bearingDeg)dst.bearingDeg=new Float32Array(r.bearingDeg.length);dst.bearingDeg.set(r.bearingDeg);dst.bearingQuantized=r.bearingQuantized;dst.bearingPrecisionDeg=r.bearingPrecisionDeg;}
        dst.quantized=r.quantized;dst.precisionDb=r.precisionDb;
      }
      return;
    }
    for(let k=lo;k<end;k++){
      if(h.state!=='running')return;
      const dst=h.rows[k]!;
      const flags=slot.nb.get(k,dst.data,dst.bearingDeg);
      if(flags?.quantized){dst.quantized=true;dst.precisionDb=PRECISION_DB;}
      if(flags?.hasBearing){dst.bearingQuantized=flags.bearingQuantized;if(flags.bearingQuantized)dst.bearingPrecisionDeg=BEARING_PRECISION_DEG;}
    }
  }
  /** Advance one subscription's read cursor to the latest due row without generating the
   * intermediate frames. With `out`, skips ready−1 then writeRow once (current geometry) and
   * returns that row index; without `out`, discards the whole backlog and returns the last
   * skipped index. Returns -1 when nothing is due. Legacy pull streams (no subscription) write
   * once when `out` is given. Typed-array `out` is caller-owned — no per-call allocation. */
  skipToLatest(streamId:number,out?:Float32Array,offset=0):number{
    const sub=this.subscriptions.get(streamId);
    if(!sub){if(!this.streams.has(streamId))throw new Error('Unknown streamId');return out?this.writeRow(streamId,out,offset):-1;}
    if(sub.fullAxis){
      const fa=sub.fullAxis,due=Math.max(0,Math.floor((this.time-sub.start)*sub.config.rowRateHz+1e-9));
      fa.scheduled=due;fa.queue.length=0;
      if(due>0){const rowKey=due-1;for(const tileIndex of priorityTileOrder(fa.visibleTileIndex,fa.tileCount).slice(0,Math.min(3,fa.tileCount)))fa.queue.push({tileIndex,rowKey,hot:true,filled:true});}
      sub.read=due*fa.tileCount-fa.queue.length;if(!out||!fa.queue.length)return fa.queue.length?sub.read:-1;return this.writeRow(streamId,out,offset);
    }
    const ready=this.rowsReady(streamId);if(ready<=0)return -1;
    if(out){if(ready>1)sub.read+=ready-1;return this.writeRow(streamId,out,offset);}
    sub.read+=ready;return sub.read-1;
  }
  writeRow(streamId:number,out:Float32Array,offset=0):number {
    const i=this.streams.get(streamId);if(i===undefined)throw new Error('Unknown streamId');
    const sub=this.subscriptions.get(streamId),bins=sub?.config.bins??this.scenario.bins;
    if(!Number.isInteger(offset)||offset<0||out.length<offset+bins)throw new Error('Row size mismatch');
    if(sub&&this.rowsReady(streamId)===0)return -1;
    const rowIndex=sub?sub.read++:this.legacyIndices.get(streamId)??0;if(!sub)this.legacyIndices.set(streamId,rowIndex+1);
    const b=this.scenario.buoys[i];
    if(sub?.renderer||sub?.config.kind==='demon'){
      this.warm.tick();
      const band=sub.config.demodBandHz??[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]];
      const dslot=this.warm.demonSlot(i,[band[0],band[1]]);
      if(dslot){
        const k=Math.round((sub.start-dslot.start)*dslot.rowRateHz)+rowIndex;
        if(dslot.ring.has(k)){dslot.ring.get(k,out.subarray(offset,offset+bins));return rowIndex;}
      }
    }
    if(sub?.warmView&&!sub.fullAxis){
      this.warm.tick();
      const slot=this.warm.resSlot(i,sub.warmView.res);
      if(slot){
        const k=Math.round((sub.start-slot.start)*slot.rowRateHz)+rowIndex;
        if(!sub.lastWarmBrg||sub.lastWarmBrg.length!==bins)sub.lastWarmBrg=new Float32Array(bins);
        if(!isFeeding(b,this.time)){out.fill(NaN,offset,offset+bins);sub.lastWarmBrg.fill(NaN);return rowIndex;}
        // Copy only Float32 ring rows. 8-bit (other RES on the same buoy, variant C) is not
        // bit-exact; fall through to generateAt so live goldens stay exact.
        if(slot.nb.isQuantized(k)){/* fall through */}
        else if(sub.warmView.filter==='BB'){
          if(k===slot.written-1){this.warm.mapLastBB(slot,out.subarray(offset,offset+bins),sub.lastWarmBrg);return rowIndex;}
          const derived=this.warm.deriveBB(slot,i,slot.written-k);
          const r=derived[0];
          if(r&&r.k===k){out.set(r.data,offset);if(r.bearingDeg)sub.lastWarmBrg.set(r.bearingDeg);else sub.lastWarmBrg.fill(NaN);return rowIndex;}
        }else if(slot.nb.has(k)){
          slot.nb.get(k,out.subarray(offset,offset+bins),sub.lastWarmBrg);
          return rowIndex;
        }
      }
    }
    if(sub?.fullAxis&&sub.res){
      const fa=sub.fullAxis,job=fa.queue.shift()!;
      if(!isFeeding(b,this.time)){out.fill(NaN,offset,offset+bins);sub.res.bearingRow.fill(NaN);fa.lastTile={tileIndex:job.tileIndex,tileBins:fa.tileBins,f0:job.tileIndex*fa.tileBins*sub.config.fBin,fBin:sub.config.fBin,liveBins:0,filled:false};return rowIndex;}
      const tEnd=sub.start+(job.rowKey+1)/sub.config.rowRateHz;
      const t=tileBand(sub.config.res!,job.tileIndex,this.scenario.fMax??this.scenario.fmax,fa.tileBins);
      sub.res.renderTileAt(job.tileIndex,job.rowKey,tEnd,out,offset,fa.tileBins);
      fa.lastTile={tileIndex:t.tileIndex,tileBins:t.tileBins,f0:t.f0,fBin:t.fBin,liveBins:t.liveBins,filled:true};
      // Mirror current tile on gramConfig so FE peeking config sees the last emitted slice.
      sub.config={...sub.config,f0:t.f0,liveBins:t.liveBins,bandLimited:t.bandLimited,simT:this.time};
      return rowIndex;
    }
    if(!isFeeding(b,this.time)){out.fill(NaN,offset,offset+bins);this.generators[i].lineCount=0;this.generators[i].bearingRow.fill(NaN);sub?.res?.bearingRow.fill(NaN);return rowIndex;}if(sub?.renderer)sub.renderer.write(out,offset,rowIndex);else if(sub?.res)sub.res.generateAt(sub.start+(rowIndex+1)/sub.config.rowRateHz,out,offset);else (sub?.lofar??this.generators[i]).generate(out,offset);return rowIndex;
  }
  /** Copy the last generated per-bin DIFAR bearings (call after writeRow). NaN for omni/DEMON/dead. */
  writeBearingRow(streamId:number,out:Float32Array,offset=0):void {
    const i=this.streams.get(streamId);if(i===undefined)throw new Error('Unknown streamId');
    const sub=this.subscriptions.get(streamId),bins=sub?.config.bins??this.scenario.bins;
    if(!Number.isInteger(offset)||offset<0||out.length<offset+bins)throw new Error('Row size mismatch');
    const b=this.scenario.buoys[i];
    if(sub?.warmView&&sub.lastWarmBrg){out.set(sub.lastWarmBrg,offset);return;}
    if(sub?.renderer||b.type!=='difar'||!isFeeding(b,this.time)){out.fill(NaN,offset,offset+bins);return;}
    out.set((sub?.res??sub?.lofar??this.generators[i]).bearingRow,offset);
  }
  dropBuoy(spec:DropBuoy):number {
    if(spec.kind!=='omni'&&spec.kind!=='difar')throw new Error('Receiver type pending approved plan');
    if(!(spec.channel>0)||!Number.isInteger(spec.channel))throw new Error('Invalid RF channel');
    let max=0;for(const b of this.scenario.buoys)max=Math.max(max,Number(b.id.replace(/\D/g,''))||0);
    const id=spec.id??max+1;if(!Number.isInteger(id)||id<1||id>2147483647)throw new Error('Invalid buoy id');
    const alt=spec.dropAltitudeM??this.deployAltitudeM,rate=spec.descentRateMps??this.deployDescentRateMps,integ=spec.integrationTimeS??this.deployIntegrationTimeS;
    validateDrop(alt,rate);validateIntegration(integ);
    const planned=!!(this.planeRoute&&routeIsReady(this.planeRoute));
    this.addBuoy({id:`buoy-${id}`,rfChannel:spec.channel,type:spec.kind==='omni'?'passive-omni':'difar',x:spec.x,y:spec.y,depth:spec.hydrophoneDepthM,course:0,speed:0,
      ...(planned?{}:{deployedAt:this.time}),life:spec.lifeS??7200,
      placed:false,dropAltitudeM:alt,descentRateMps:rate,integrationTimeS:integ,
      ...(planned?{plannedDrop:{x:spec.x,y:spec.y,order:this.nextPlannedOrder} as PlannedDrop}:{})});return id;
  }

  /** Arm or clear the aircraft route used to capture planned drops. Does not move ownship. Releases only happen on `advance`. */
  setPlaneRoute(spec:PlaneRouteSpec|null):void{this.planeRoute=spec;}
  private resolvePlannedDrops(t0:number,t1:number):void{
    const spec=this.planeRoute;if(!spec||!routeIsReady(spec))return;
    const hits:{i:number;t:number;order:number}[]=[];
    const buoys=this.scenario.buoys;
    for(let i=0;i<buoys.length;i++){
      const b=buoys[i]!;if(!isPlanned(b))continue;
      const d=b.plannedDrop??{x:b.x,y:b.y,order:i};
      const t=firstCaptureTime(spec,d.x,d.y,t0,t1);if(t!==null)hits.push({i,t,order:d.order});
    }
    hits.sort((a,c)=>a.t-c.t||a.order-c.order||a.i-c.i);
    const taken:number[]=[];
    for(const h of hits){
      if(taken.some(t=>Math.abs(t-h.t)<=DROP_CAPTURE_TOL_S))continue;
      taken.push(h.t);buoys[h.i]!.deployedAt=h.t;
    }
  }

  /** Numeric buoy id (`buoy-N` → N) or -1. */
  private buoyIndex(buoyId:number):number{return this.scenario.buoys.findIndex((b,i)=>(Number(b.id.replace(/\D/g,''))||i+1)===buoyId);}
  /** Lowest free RF channel in 1..max, or null when the pool is full. */
  lowestFreeChannel(max=MAX_RF_CHANNELS):number|null{const used=new Set<number>();for(const b of this.scenario.buoys)if(b.rfChannel>0)used.add(b.rfChannel);for(let ch=1;ch<=max;ch++)if(!used.has(ch))return ch;return null;}
  /** Release RF channel; buoy stays in the scenario for retune. LOFAR/RES fill NaN while detuned.
   * DEMON subscriptions on this buoy are dropped via `unsubscribe` (same cleanup); a later
   * re-subscribe after retune allocates a new stream id (ids are never reused). */
  detuneBuoy(buoyId:number):void{
    const i=this.buoyIndex(buoyId);if(i<0)throw new Error('Unknown buoyId');
    const b=this.scenario.buoys[i];if(!isTuned(b))return;
    b.rfChannel=0;this.rows[i].rfChannel=0;this.rows[i].alive=false;this.rows[i].bearing=null;this.generators[i].lineCount=0;
    for(const sub of this.subscriptions.values()){const si=this.streams.get(sub.config.streamId);if(si===i)sub.config.channel=0;}
    const drop:number[]=[];
    for(const [id,sub] of this.subscriptions){if(sub.renderer&&this.streams.get(id)===i)drop.push(id);}
    for(const id of drop)this.unsubscribe(id);
  }
  /** Boolean setter over detuneBuoy / tuneBuoy, matching Swift `setTuned`. Idempotent:
   * already in the requested state is a no-op (tune returns the current channel). Returns
   * the RF channel (0 when detuned). `channel` is used only when tuning a currently-detuned buoy. */
  setTuned(buoyId:number,tuned:boolean,channel?:number):number{
    const i=this.buoyIndex(buoyId);if(i<0)throw new Error('Unknown buoyId');
    if(!tuned){this.detuneBuoy(buoyId);return 0;}
    const b=this.scenario.buoys[i];
    if(isTuned(b)){
      if(channel!==undefined&&b.rfChannel!==channel)throw new Error('Buoy already tuned');
      return b.rfChannel;
    }
    return this.tuneBuoy(buoyId,channel);
  }
  /** Assign RF (host channel or lowest-free). Returns the assigned channel. */
  tuneBuoy(buoyId:number,channel?:number):number{
    const i=this.buoyIndex(buoyId);if(i<0)throw new Error('Unknown buoyId');
    const b=this.scenario.buoys[i];if(isTuned(b))throw new Error('Buoy already tuned');
    let ch=channel;if(ch===undefined){const free=this.lowestFreeChannel();if(free==null)throw new Error('NO CH');ch=free;}
    if(!(ch>0)||!Number.isInteger(ch))throw new Error('Invalid RF channel');
    if(this.scenario.buoys.some(x=>x.rfChannel===ch))throw new Error('RF channel already used');
    b.rfChannel=ch;this.rows[i].rfChannel=ch;this.rows[i].alive=isFeeding(b,this.time);
    for(const sub of this.subscriptions.values()){const si=this.streams.get(sub.config.streamId);if(si===i)sub.config.channel=ch;}
    return ch;
  }
  /** End this buoy's stream from the current sim time. Further rows are NaN / skipped like pre-live. Idempotent. */
  scuttleBuoy(buoyId:number):void{
    const i=this.buoyIndex(buoyId);if(i<0)throw new Error('Unknown buoyId');
    const b=this.scenario.buoys[i];
    if(typeof b.scuttledAt==='number'&&Number.isFinite(b.scuttledAt))return;
    b.scuttledAt=this.time;
    this.rows[i].alive=isFeeding(b,this.time);
  }
  /** Degrees true in [0, 360). Matches Swift SimEngine.degreesTrue / LiveEngine. */
  static degreesTrue(rad:number):number{let d=rad*180/Math.PI;d=d%360;if(d<0)d+=360;return d;}
  private aisPose(t:number,i:number):{x:number;y:number;depth:number;course:number;speed:number}{
    const s=this.aisStarts[i]!,c=this.allContacts[i]!;
    let x=s.x,y=s.y,depth=s.depth,course=s.course,speed=s.speed,tt=this.aisStartTime;
    const move=(dt:number)=>{x+=Math.sin(course)*speed*dt;y+=Math.cos(course)*speed*dt;};
    for(const leg of c.motion??[])if(leg.at>this.aisStartTime&&leg.at<=t){move(leg.at-tt);course=leg.course;speed=leg.speed;depth=leg.depth;tt=leg.at;}
    move(t-tt);return {x,y,depth,course,speed};
  }
  /** Surface-only AIS feed at `atSimTime`. Plot coordinates match Reveal. Fictional deterministic
   * names. Inactive pool ships, subsurface contacts, and classification targets are omitted.
   * Read-only: does not step or mutate the engine. Duplicate ids are returned once. */
  aisTracks(atSimTime:number=this.time):AisTrack[]{
    if(!Number.isFinite(atSimTime))throw new Error('Invalid AIS time');
    if(!this.aisConnectivityAllowed)return [];
    const seen=new Set<string>(),out:AisTrack[]=[];
    for(let i=0;i<this.allContacts.length;i++){
      const c=this.allContacts[i]!;
      if(c.category!=='surface'||c.active===false||c.classificationTarget===true)continue;
      if(seen.has(c.id))continue;seen.add(c.id);
      // Live pose at current sim time matches truth kinematics; closed-form replay otherwise.
      let x:number,y:number,crs:number,spd:number;
      if(atSimTime===this.time){x=c.x;y=c.y;crs=c.course;spd=c.speed;}
      else{const p=this.aisPose(atSimTime,i);x=p.x;y=p.y;crs=p.course;spd=p.speed;}
      const name=(c.params.label??'').trim();
      out.push(this.aisSource.decorate({id:c.id,name:name||c.id,x,y,crsDeg:AcousticEngine.degreesTrue(crs),spdMps:spd},atSimTime));
    }
    // Opt-in planner ships that make no gram signal. Off by default.
    if(this.scenario.backgroundAisOnly){
      if(!this.backgroundAisSource)this.backgroundAisSource=createAisTrackSource({seed:this.scenario.seed,count:AIS_DEFAULT_COUNT});
      for(const t of this.backgroundAisSource.aisTracks(atSimTime)){
        if(seen.has(t.id))continue;seen.add(t.id);
        out.push(t);
      }
    }
    return out;
  }
  /**
   * Full unfiltered truth list (surface and subsurface). Not the Reveal path;
   * use `truth()` / `truthContacts()` for Reveal. Not HostPolicy-gated.
   */
  allTruthContacts(atSimTime:number=this.time):TruthContact[]{
    if(!Number.isFinite(atSimTime))throw new Error('Invalid truth time');
    const out:TruthContact[]=[];
    for(let i=0;i<this.allContacts.length;i++){
      const c=this.allContacts[i]!,base=this.truthState.contacts[i]!;
      let x:number,y:number,depth:number,course:number,speed:number;
      if(atSimTime===this.time){x=c.x;y=c.y;depth=c.depth;course=c.course;speed=c.speed;}
      else{const p=this.aisPose(atSimTime,i);x=p.x;y=p.y;depth=p.depth;course=p.course;speed=p.speed;}
      const rec:TruthContact={...base,active:c.active!==false,x,y,depthM:depth,crsDeg:AcousticEngine.degreesTrue(course),spdMps:speed,spdKts:mpsToKnots(speed)};
      if(isSubmarineContact(c))rec.kind='submarine';else delete rec.kind;
      out.push(rec);
    }
    return out;
  }
  /** Ground-truth contact list for Reveal: submarines only, each with kind `'submarine'`.
   * Returns undefined in a crew session when HostPolicy.allowRevealLocation is false. Solo is ungated. */
  truthContacts(atSimTime:number=this.time):TruthContact[]|undefined{
    if(!this.revealLocationAllowed)return undefined;
    return this.allTruthContacts(atSimTime).filter(c=>c.kind==='submarine');
  }
  /** Reveal state (same gate and filter as `truthContacts()`). */
  truth(atSimTime:number=this.time):{contacts:TruthContact[]}|undefined{
    const contacts=this.truthContacts(atSimTime);
    return contacts?{contacts}:undefined;
  }
  /** Seeded BT/SSP for this scenario (Mackenzie 1981, fictional 3-layer shape). */
  btProfile(opts?:BtProfileOpts):BtProfile { return btProfile(this.scenario, opts); }
  /**
   * BT buoy drop: returns the scenario profile. Does not insert a BT receiver into
   * `scenario.buoys` (those stay omni/difar only). `dropBuoy({kind:'bt'})` still throws.
   */
  dropBtBuoy(spec:{x:number;y:number;id?:number;maxDepthM?:number;samples?:number}):BtDrop {
    let max=0;for(const b of this.scenario.buoys)max=Math.max(max,Number(b.id.replace(/\D/g,''))||0);
    const id=spec.id??max+1;if(!Number.isInteger(id)||id<1||id>2147483647)throw new Error('Invalid buoy id');
    return dropBtBuoy(this.scenario,{...spec,id});
  }
  /**
   * Auto DIFAR bearings at `atSimTime`: one strongest-SNR line per (feeding DIFAR buoy,
   * active contact) above `minQuality` (default 10 dB). Field names match Dorian's
   * PlotAutoFixes.Line (`buoyId`, `freqHz`, `brgDeg`, `quality`) plus `contactId`,
   * `snrDb`, `sigmaDeg`. Read-only: does not step or mutate the engine.
   */
  autoBearings(atSimTime:number=this.time, opts?:{minQuality?:number}):AutoBearing[] {
    if(!Number.isFinite(atSimTime))throw new Error('Invalid auto-bearing time');
    const s=this.scenario, dfHz=s.fBin??(s.fmax/Math.max(1,s.bins-1));
    const contacts:ContactPose[]=[];
    for(let i=0;i<this.allContacts.length;i++){
      const c=this.allContacts[i]!;
      const p=atSimTime===this.time?c:this.aisPose(atSimTime,i);
      contacts.push({id:c.id,x:p.x,y:p.y,depth:p.depth,course:p.course,speed:p.speed,active:c.active,lines:c.lines,params:c.params});
    }
    return autoBearingsFromState({buoys:s.buoys,contacts,environment:s.environment,seed:s.seed,atSimTime,minQuality:opts?.minQuality,dfHz});
  }
  /**
   * ALI peak-to-bearing: DIFAR math at a frequency or the strongest line in a band.
   * Returns `{bearingDeg, sigmaDeg, snrDb, freqHz}` for Dorian's AliEngineSource seam.
   */
  sendBearingFromPeak(buoyId:number, freqHzOrBand:number|[number,number], atSimTime:number=this.time):AliPeakBearing {
    if(!Number.isFinite(atSimTime))throw new Error('Invalid ALI time');
    const i=this.buoyIndex(buoyId);if(i<0)throw new Error('Unknown buoyId');
    const b=this.scenario.buoys[i]!;
    const s=this.scenario, dfHz=s.fBin??(s.fmax/Math.max(1,s.bins-1));
    const contacts:ContactPose[]=[];
    for(let j=0;j<this.allContacts.length;j++){
      const c=this.allContacts[j]!;
      const p=atSimTime===this.time?c:this.aisPose(atSimTime,j);
      contacts.push({id:c.id,x:p.x,y:p.y,depth:p.depth,course:p.course,speed:p.speed,active:c.active,lines:c.lines,params:c.params});
    }
    const freqHz=typeof freqHzOrBand==='number'?freqHzOrBand:undefined;
    const band=typeof freqHzOrBand==='number'?undefined:freqHzOrBand;
    return sendBearingFromPeakAt({buoy:b,buoyIndex:i,contacts,environment:s.environment,seed:s.seed,atSimTime,freqHz,band,dfHz});
  }
  /**
   * BFI per-band samples at `atSimTime` for Dorian's pointsFromBandSamples seam.
   * DIFAR only (throws on omni / unknown). Each band is a band-integrated
   * level-versus-bearing curve (`bearingDeg[]`, `levelDb[]`). Read-only.
   */
  bfiBandSamples(buoyId:number, bands?:BfiBand[], atSimTime:number=this.time):BfiBandSamples {
    if(!Number.isFinite(atSimTime))throw new Error('Invalid BFI time');
    const s=this.scenario, dfHz=s.fBin??(s.fmax/Math.max(1,s.bins-1));
    const contacts:ContactPose[]=[];
    for(let j=0;j<this.allContacts.length;j++){
      const c=this.allContacts[j]!;
      const p=atSimTime===this.time?c:this.aisPose(atSimTime,j);
      contacts.push({id:c.id,x:p.x,y:p.y,depth:p.depth,course:p.course,speed:p.speed,active:c.active,lines:c.lines,params:c.params});
    }
    return bfiBandSamplesForBuoy({buoys:s.buoys,buoyId,contacts,environment:s.environment,seed:s.seed,atSimTime,bands,dfHz});
  }
  /**
   * Start a DIFAR frequency track at `freqHz` (optional gate width, default 10 Hz).
   * Returns a numeric `trackId`. Throws on a non-DIFAR or unknown buoy. The track
   * is evaluated from the current sim time until `stopFreqTrack`.
   */
  startFreqTrack(buoyId:number, freqHz:number, gateHz?:number):number {
    return this.freqBook.start(buoyId, freqHz, gateHz, this.time, this.scenario.buoys);
  }
  /** Drop a persisted frequency track. Throws on an unknown `trackId`. */
  stopFreqTrack(trackId:number):void { this.freqBook.stop(trackId); }
  /**
   * Frequency-track bearings at `atSimTime`. Each record is
   * `{trackId, buoyId, freqHz, brgDeg, sigmaDeg, snrDb, quality, locked, state}`.
   * `quality` is SNR in dB (same as autoBearings). `locked` is true only while
   * `state` is `'tracking'`. Reconstructs coast/lost/reacquire from start.
   * Read-only: does not step or mutate engine time.
   */
  freqTrackBearings(atSimTime:number=this.time):FreqTrackBearing[] {
    if(!Number.isFinite(atSimTime))throw new Error('Invalid frequency-track time');
    const s=this.scenario, dfHz=s.fBin??(s.fmax/Math.max(1,s.bins-1));
    const contactsAt=(t:number)=>{
      const contacts:ContactPose[]=[];
      for(let j=0;j<this.allContacts.length;j++){
        const c=this.allContacts[j]!;
        const p=t===this.time?c:this.aisPose(t,j);
        contacts.push({id:c.id,x:p.x,y:p.y,depth:p.depth,course:p.course,speed:p.speed,active:c.active,lines:c.lines,params:c.params});
      }
      return contacts;
    };
    return freqTrackBearingsFromState({
      tracks:this.freqBook.specs(),buoys:s.buoys,contactsAt,
      environment:s.environment,seed:s.seed,atSimTime,dfHz,
    });
  }
    /** Inject/clear yellow fault health (engine-truth for FE chrome). */
  setBuoyFault(buoyId:number,fault:boolean):void{
    const i=this.buoyIndex(buoyId);if(i<0)throw new Error('Unknown buoyId');
    this.scenario.buoys[i].fault=!!fault;
  }
  private syncTacticalBuoys():void{this.tacticalState.buoys=this.scenario.buoys.map((b,i)=>({id:Number(b.id.replace(/\D/g,''))||i+1,channel:b.rfChannel,kind:b.type==='difar'?'difar':'omni',x:b.x,y:b.y,hydrophoneDepthM:b.depth,batteryFrac:1,lifeRemainingS:b.life,state:'live',health:b.fault?'fault':'ok'}));}
  /** Reuses the tactical object/records; callers needing snapshots should structuredClone it. */
  tactical():Tactical {
    const s=this.scenario,t=this.tacticalState;t.simT=this.time;const a=t.aircraft;a.x=s.ownship.x;a.y=s.ownship.y;a.hdgDeg=(s.ownship.course*180/Math.PI+360)%360;a.gsMps=s.ownship.speed;
    let count=0;for(let i=0;i<s.buoys.length;i++){const b=s.buoys[i],out=t.buoys[i];out.x=b.x;out.y=b.y;out.hydrophoneDepthM=b.depth;out.channel=b.rfChannel;out.lifeRemainingS=Math.max(0,b.deployedAt+b.life-this.time);out.batteryFrac=Math.max(0,Math.min(1,out.lifeRemainingS/b.life));out.state=this.time<b.deployedAt?'falling':isAlive(b,this.time)?'live':'dead';out.health=b.fault?'fault':'ok';
      if(b.type==='difar'&&isFeeding(b,this.time)){const g=this.generators[i];for(let j=0;j<g.lineCount;j++){const src=g.lines[j],dst=this.bearingStorage[count];dst.buoyId=out.id;dst.freqHz=src.freqHz;dst.brgDeg=src.brgDeg;dst.quality=src.quality;t.bearings[count++]=dst;}}
    }t.bearings.length=count;
    for(let i=0;i<this.allContacts.length;i++){const c=this.allContacts[i],out=this.truthState.contacts[i];out.active=c.active!==false;out.x=c.x;out.y=c.y;out.depthM=c.depth;out.crsDeg=(c.course*180/Math.PI+360)%360;out.spdMps=c.speed;out.spdKts=mpsToKnots(c.speed);for(let j=0;j<out.lines.length;j++){const line=c.lines![j],dst=out.lines[j];dst.f0Hz=line.hz;dst.freqHz=line.frequencyHz??line.hz;dst.power=line.power;dst.stability=line.stability!;dst.width=line.width!;dst.sigmaBins=line.sigmaBins??0;dst.eda=line.eda;dst.reactorId=line.reactorId;dst.lineFamily=line.lineFamily;dst.fundamentalHz=line.fundamentalHz;dst.harmonic=line.harmonic;dst.engineId=line.engineId;dst.shaftIndex=line.shaftIndex;}}
    if(this.revealLocationAllowed){
      this.revealState.contacts=this.truthState.contacts.filter(c=>isSubmarineContact(c));
      for(const c of this.revealState.contacts)c.kind='submarine';
      t.truth=this.revealState;
    }else{
      t.truth=undefined;
    }
    return t;
  }
  advance(dt:number):void {
    bumpDemonWeightTick();
    if(!Number.isFinite(dt)||dt<0||dt>1e6||this.scenario.time+dt>1e9)throw new Error('Invalid step dt');
    const s=this.scenario,from=s.time;s.time+=dt;advance(s.ownship,dt);
    for(const c of this.allContacts){let t=from;for(const leg of c.motion)if(leg.at>from&&leg.at<=s.time){advance(c,leg.at-t);c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;t=leg.at;}advance(c,s.time-t);}
    const env=s.environment;for(const c of this.allContacts){c.params.waterTempC=env.temperatureC??15;c.params.waterSalinity=env.salinityPsu??35;c.params.seaState=env.seaState;if(c.catalogRef){try{const {klass}=resolveReference(c.catalogRef);c.params.periscopeDepthM=klass.snorkelDepthM||18;}catch{/* */} }if(c.params.plantSpec){c.params.reinforceBr1=c.params.plantSpec.reinforceBr1;c.params.psrHarmonicsStopAtBlades=c.params.plantSpec.psrHarmonicsStopAtBlades;}}for(const state of this.catalogStates){const c=state.contact;if(c.speed!==state.speed||c.depth!==state.depth||(c.params.seaState??0)!==env.seaState){updateDerivedSignature(c.params,state.params,mpsToKnots(c.speed),c.depth,c.operatingMode??'normal');state.speed=c.speed;state.depth=c.depth;}}
    for(const state of this.surfaceStates){const c=state.contact;if(c.speed!==state.speed){refreshSurfaceSignature(c.params,state.type,mpsToKnots(c.speed));state.speed=c.speed;}}
    for(const c of this.allContacts){c.params.dutyClockS=s.time;applyIntermittentAuxPowers(c.params);}this.updateHydp();this.updateEngineRamps(false);this.updateSwaths();this.updateNarrowTransients();
    for(const w of this.lineWanders)w.advance(dt);
    for(let i=0;i<s.buoys.length;i++){
      const b=s.buoys[i],r=this.rows[i];advance(b,dt);r.alive=isFeeding(b,s.time);r.depth=b.depth;r.rfChannel=b.rfChannel;
      if(!r.alive){r.bearing=null;this.generators[i].lineCount=0;}
    }
    this.resolvePlannedDrops(from,s.time);
    // RES span averaging: one engine-wide source-STATE record per frame (stateHistory.ts); rows re-evaluate the modelled spectrum per frame (not a waveform FFT).
    if(this.historyOn)this.history.record(s.time);
    if(this.options.deferUndeployed)this.consumeAboardRows();
    if(this.historyOn){this.warm.ensure();this.warm.tick();}
    this.consumePreLiveRows();
  }
  /** options.deferUndeployed: drop the rows now due on subscriptions of buoys still aboard (time < deployedAt),
   * advancing each cursor as writeRow does for a non-feeding buoy (NaN row: no render, no RNG draw). */
  private consumeAboardRows():void{
    for(const [id,sub] of this.subscriptions){
      const i=this.streams.get(id);if(i===undefined)continue;const b=this.scenario.buoys[i];if(!b||!(isPlanned(b)||(typeof b.deployedAt==='number'&&this.time<b.deployedAt)))continue;
      if(sub.fullAxis){this.enqueueFullAxis(sub as {fullAxis:NonNullable<typeof sub.fullAxis>;start:number;config:GramConfig});const n=sub.fullAxis.queue.length;sub.read+=n;this.aboardRowsSkipped+=n;sub.fullAxis.queue.length=0;}
      else{const due=Math.max(0,Math.floor((this.time-sub.start)*sub.config.rowRateHz+1e-9));if(due>sub.read){this.aboardRowsSkipped+=due-sub.read;sub.read=due;}}
    }
  }
  /** Sequence buoys: skip rows that would emit before firstEmitTime. Placed buoys are untouched. */
  private consumePreLiveRows():void{
    for(const [id,sub] of this.subscriptions){
      const i=this.streams.get(id);if(i===undefined)continue;const b=this.scenario.buoys[i];if(!b||isPlaced(b))continue;
      const P=1/sub.config.rowRateHz,first=firstEmitTime(b,P);
      const skipUntil=Math.max(0,Math.floor((first-sub.start)*sub.config.rowRateHz-1e-9));
      const due=Math.max(0,Math.floor((this.time-sub.start)*sub.config.rowRateHz+1e-9));
      const target=Math.min(due,skipUntil);
      if(sub.fullAxis&&this.time<first){
        this.enqueueFullAxis(sub as {fullAxis:NonNullable<typeof sub.fullAxis>;start:number;config:GramConfig});
        const n=sub.fullAxis.queue.length;sub.read+=n;this.aboardRowsSkipped+=n;sub.fullAxis.queue.length=0;
      }else if(sub.read<target){this.aboardRowsSkipped+=target-sub.read;sub.read=target;}
    }
  }
  /** HYDP hydraulic burst (Wilson): speed-independent class Hz × harmonics; squally abrupt on/off
   * with tiny seeded fade. Latest-started window wins; outside every window slots are silent. */
  private updateHydp():void{const t=this.scenario.time;for(const h of this.hydpStates){const st=h.contact.params.hydpTransient!;st.offsetFrac=0;st.gain=0;
    for(let k=h.at.length-1;k>=0;k--){if(h.at[k]>t)continue;const tau=t-h.at[k],d=h.durationS[k];if(tau<d){const fade=Math.max(.02,st.shape.fadeS);st.gain=Math.max(0,Math.min(1,tau/fade,(d-tau)/fade));}break;}
    if(h.index>=0)writeHydpBurst(h.contact.params,h.index,h.spec,st);}}
  /** Smoothstep lerp of plantRpmScale through scheduled engine-ramp windows; ratio-locks CSR/CFR/EFR/EDA
   * (and coupled PSR/BR). Latest-started ramp wins; after the window the end scale holds. */
  private updateEngineRamps(force:boolean):void{const t=this.scenario.time;for(const r of this.engineRampStates){let scale=1;
    for(let k=r.at.length-1;k>=0;k--){if(r.at[k]>t)continue;const tau=t-r.at[k],d=r.durationS[k],u=d>0?Math.max(0,Math.min(1,tau/d)):1,s=u*u*(3-2*u);scale=r.fromScale[k]+(r.toScale[k]-r.fromScale[k])*s;break;}
    if(!force&&scale===r.lastScale)continue;r.lastScale=scale;const c=r.contact;c.params.plantRpmScale=scale;
    if(r.catalog)updateDerivedSignature(c.params,r.catalog,mpsToKnots(c.speed),c.depth,c.operatingMode??'normal');
    else if(c.params.plantSpec){updatePropulsion(c.params,r.baseFraction,c.operatingMode??'normal');writePlantTonals(c.params,c.operatingMode??'normal');}
    // Keep Signature.shaftHz aligned with scaled coupled shafts for LOFAR/DEMON consumers.
    if(c.params.propulsion?.shafts[0]){c.params.shaftHz=c.params.propulsion.shafts[0].hz;c.params.tonalHz=Math.max(.01,c.params.shaftHz*c.params.blades);}
  }}

  /** Short broadband swath flashes: gain=1 inside [at, at+duration), else 0. */
  private updateSwaths():void{const t=this.scenario.time;for(const s of this.swathStates){const list=s.contact.params.eventSwaths!;for(let i=0;i<s.at.length;i++){const on=t>=s.at[i]&&t<s.at[i]+s.durationS[i];list[i].active=on;list[i].gain=on?1:0;list[i].loHz=s.loHz[i];list[i].hiHz=s.hiHz[i];}}}
  /** Class-specific TRANSIENT lines: power while armed. */
  private updateNarrowTransients():void{const t=this.scenario.time;for(const n of this.narrowTransientStates){let gain=0;for(let k=n.at.length-1;k>=0;k--){if(n.at[k]>t)continue;if(t<n.at[k]+n.durationS[k])gain=1;break;}
   const lines=n.contact.params.tonals!;for(let h=0;h<n.harmonics;h++){const l=lines[n.index+h];if(!l||l.lineFamily!=='TRANSIENT')continue;l.power=gain*.08/((h+1)*(h+1));}}}
  step(dt:number):readonly BuoyRow[]{
    for(const r of this.rows)if(r.row.length!==this.scenario.bins)throw new Error('Missing row buffer');
    this.advance(dt);for(let i=0;i<this.rows.length;i++){const r=this.rows[i];if(r.alive){this.generators[i].generate(r.row);r.bearing=r.type==='difar'?this.generators[i].bearing:null;}else r.row.fill(NaN);}return this.rows;
  }
}
