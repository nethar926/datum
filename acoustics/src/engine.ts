import {configurePropulsion,updatePropulsion,writePlantTonals,writeHydpBurst,pickHydpShape,HYDP_MAX_ORDERS,applyIntermittentAuxPowers} from './catalog/plantModel.js';
import type {HydpSpec} from './catalog/drivetrain.js';
import {LineWander} from './lineModel.js';
import {surfaceCount,createSurfacePool,refreshSurfaceSignature} from './catalog/surface.js';
import {DemonStream} from './demonStream.js';
import {resolveReference,updateDerivedSignature} from './catalog/derive.js';
import type {ClassParams} from './catalog/schema.js';
import type {Contact} from './scenario.js';
import {mpsToKnots,clamp} from './units.js';
import { validateScenario, loadScenario, type Scenario, type ScenarioInput, type Environment } from './scenario.js';
import { advance } from './kinematics.js';
import { isAlive, isFeeding, isTuned, type ReceiverType, type Buoy } from './buoys.js';
import { LofarGenerator } from './lofar.js';
import {ResLofarGenerator,normalizeResSettings} from './resGram.js';
import {RES_BINS,RES_FRAME_S,TILE_BINS,tileCountFor,tileIndexForHz,priorityTileOrder,tileBand,type ResGramSettings} from './res.js';
import type {GramFilter,LofarBandPresetId} from './protocol.js';
import type {GramConfig,Tactical,DropBuoy,TruthContact} from './protocol.js';
import {isLofarBandPresetId,resolveLofarBand} from './bands.js';
/** @deprecated Retained for API compat; HYDP no longer curves high→fixed (Wilson squally bar). */
export const HYDP_START_OFFSET_PCT=1.5;
/** Simultaneous tuned RF channels (= FE field cap / bench budget). */
export const MAX_RF_CHANNELS=32;
export interface BuoyRow { id:string; rfChannel:number; depth:number; type:ReceiverType; alive:boolean; bearing:number|null; row:Float32Array }
/** Deterministic mutable simulation; construction owns a JSON-safe copy. step has no allocations.
 * Callers may replace each result.row with an appropriately sized recycled buffer before step. */
export class AcousticEngine {
  readonly scenario:Scenario;readonly rows:BuoyRow[];readonly generators:LofarGenerator[];
  private readonly lineWanders:LineWander[]=[];
  private readonly truthState:{contacts:TruthContact[]};
  private readonly allContacts:Contact[];
  private readonly baseContacts:Contact[];
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
  private readonly subscriptions=new Map<number,{config:GramConfig;start:number;read:number;renderer?:DemonStream;lofar?:LofarGenerator;res?:ResLofarGenerator;bandKey?:string;fullAxis?:{tileBins:number;tileCount:number;visibleTileIndex:number;viewFLo?:number;viewFHi?:number;scheduled:number;queue:{tileIndex:number;rowKey:number;hot:boolean;filled:boolean}[];lastTile:{tileIndex:number;tileBins:number;f0:number;fBin:number;liveBins:number;filled:boolean}}}>();
  /** Shared analytic LOFAR renderers keyed by buoyIndex:f0:fMax. Only subscribed buoy×band pairs
   * exist here; writeRow renders a pair only when that stream is drained. Refcounted on (un)subscribe. */
  private readonly lofarBandCache=new Map<string,{gen:LofarGenerator;refs:number}>();
  private readonly legacyIndices=new Map<number,number>();
  private nextStreamId=1;
  private readonly bearingStorage=Array.from({length:128*8},()=>({buoyId:0,freqHz:0,brgDeg:0,quality:0}));
  private readonly tacticalState:Tactical={v:1,type:'tactical',simT:0,aircraft:{x:0,y:0,altM:300,hdgDeg:0,gsMps:0},buoys:[],bearings:[]};
  constructor(scenario:ScenarioInput,seed?:number){if(seed!==undefined)scenario={...scenario,seed};const resolved=loadScenario(scenario);this.scenario=structuredClone(resolved);const s=this.scenario;
    s.surfacePool??=createSurfacePool(s.seed,Math.min(18,250-s.contacts.length));this.baseContacts=s.contacts.filter(c=>!s.surfacePool!.some(p=>p.id===c.id));this.allContacts=this.baseContacts.concat(s.surfacePool);
    if(s.surfacePool){const n=surfaceCount(s.surfaceTraffic??0,s.surfacePool.length);s.contacts.length=0;s.contacts.push(...this.baseContacts);for(let i=0;i<s.surfacePool.length;i++){s.surfacePool[i].active=i<n;if(i<n)s.contacts.push(s.surfacePool[i]);}}
    for(const c of this.allContacts){for(const leg of c.motion)if(leg.at<=s.time){c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;}}
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
    this.truthState={contacts:this.allContacts.map((c,i)=>({speedGated:c.params.speedGated??[],id:i+1,sourceId:c.id,label:c.catalogRef?`${c.params.label} ${resolveReference(c.catalogRef).klass.hulls.find(h=>h.id===c.catalogRef!.hullId)?.number??c.id}`:`${c.params.label} ${c.id}`,propulsion:c.params.propulsion!,spdKts:mpsToKnots(c.speed),active:c.active!==false,category:c.category??'subsurface',...(c.behaviour?{behaviour:c.behaviour}:{}),classificationTarget:c.category!=='surface'&&c.classificationTarget!==false,x:c.x,y:c.y,depthM:c.depth,crsDeg:c.course*180/Math.PI,spdMps:c.speed,lines:c.lines!.map(l=>({eda:l.eda,reactorId:l.reactorId,lineFamily:l.lineFamily,fundamentalHz:l.fundamentalHz,harmonic:l.harmonic,engineId:l.engineId,shaftIndex:l.shaftIndex,id:l.id!,family:l.family,f0Hz:l.hz,freqHz:l.frequencyHz??l.hz,power:l.power,stability:l.stability!,width:l.width!,sigmaBins:l.sigmaBins??0}))}))};this.tacticalState.truth=this.truthState;
    this.generators=s.buoys.map(b=>new LofarGenerator(b,this.allContacts,s.bins,s.band?.[1]??s.fMax??s.fmax,s.seed,s.environment,s.band?.[0]??0));
    s.buoys.forEach((_,i)=>{this.streams.set(i+1,i);this.legacyIndices.set(i+1,0);});
    this.rows=s.buoys.map((b,i)=>({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:this.generators[i].row}));
    s.classificationTargets??=this.baseContacts.filter(c=>c.category!=='surface'&&c.classificationTarget!==false).map(c=>c.id);this.syncTacticalBuoys();
  }
  get simT():number{return this.time;}
  get time():number {return this.scenario.time;}
  setEnvironment(environment:Environment):void {
    const next={...this.scenario,environment};validateScenario(next);
    this.scenario.environment={...environment};for(const generator of this.generators)generator.setEnvironment(environment);for(const sub of this.subscriptions.values()){sub.lofar?.setEnvironment(environment);sub.res?.setEnvironment(environment);sub.renderer?.setEnvironment(environment);}
  }
  setSurfaceTraffic(v:number):void{v=Number.isFinite(v)?clamp(v,0,1):.5;this.scenario.surfaceTraffic=v;const pool=this.scenario.surfacePool;if(pool){const n=surfaceCount(v,pool.length),contacts=this.scenario.contacts;contacts.length=this.baseContacts.length;for(let i=0;i<pool.length;i++){pool[i].active=i<n;if(i<n)contacts.push(pool[i]);}}this.setEnvironment({...this.scenario.environment,shippingDensity:v,shipping:v<.33?'light':v<.67?'moderate':'heavy'});}
  registerStream(id:number,channel:number):void {if(!(channel>0))throw new Error('Unknown RF channel');const i=this.scenario.buoys.findIndex(b=>b.rfChannel===channel);if(i<0)throw new Error('Unknown RF channel');this.streams.set(id,i);if(!this.legacyIndices.has(id))this.legacyIndices.set(id,0);}
  addBuoy(b:Buoy):void {const next={...this.scenario,buoys:[...this.scenario.buoys,b]};validateScenario(next);if(b.rfChannel>0&&this.scenario.buoys.some(x=>x.rfChannel===b.rfChannel))throw new Error('RF channel already used');this.scenario.buoys.push({...b});const owned=this.scenario.buoys[this.scenario.buoys.length-1];const g=new LofarGenerator(owned,this.allContacts,this.scenario.bins,this.scenario.fmax,this.scenario.seed,this.scenario.environment);this.generators.push(g);this.rows.push({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:g.row});this.syncTacticalBuoys();}
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
      const band=req.band??[1000,4000];if(band.length!==2||!band.every(Number.isFinite)||band[0]<20||band[1]>6000||band[1]-band[0]<1e-6)throw new Error('Invalid DEMON carrier band (20..6000 Hz)');
      while(this.streams.has(this.nextStreamId))this.nextStreamId++;const id=this.nextStreamId++,b=this.scenario.buoys[i];if(!isTuned(b))throw new Error('Buoy detuned');this.registerStream(id,b.rfChannel);
      const renderer=new DemonStream(b,this.allContacts,this.scenario.seed,band,this.scenario.environment),config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId:id,kind:'demon',channel:b.rfChannel,bins:512,f0:0,fBin:renderer.fBin,rowRateHz:4,dbFloor:0,dbCeil:30,demodBandHz:[band[0],band[1]]};
      this.subscriptions.set(id,{config,start:Math.floor(this.time*4)/4,read:0,renderer});return id;
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
    const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:req.channel,bins:s.bins,f0:band[0],fBin:(band[1]-band[0])/(s.bins-1),rowRateHz:4,dbFloor:40,dbCeil:110,...(fromPreset?{bandPreset:req.bandPreset}:{})};
    const index=this.streams.get(streamId)!,base=this.generators[index];
    let lofar:LofarGenerator|undefined,bandKey:string|undefined;
    if(base.f0===band[0]&&base.fmax===band[1])lofar=undefined;
    else{
      bandKey=`${index}:${band[0]}:${band[1]}`;
      let entry=this.lofarBandCache.get(bandKey);
      if(!entry){entry={gen:new LofarGenerator(s.buoys[index],this.allContacts,s.bins,band[1],s.seed,s.environment,band[0]),refs:0};this.lofarBandCache.set(bandKey,entry);}
      entry.refs++;lofar=entry.gen;
    }
    this.subscriptions.set(streamId,{config,start:Math.floor(this.time*4)/4,read:0,lofar,bandKey});return config;
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
    if(!gen||gen.capacity!==needCap)gen=new ResLofarGenerator(b,this.allContacts,fmax,s.seed,s.environment,settings,needCap);
    else gen.configure(settings);
    const p=gen.params,frames=Math.round(p.rowPeriodS/RES_FRAME_S),phase=Math.floor(i*frames/s.buoys.length)*RES_FRAME_S;
    if(fullAxis){
      const tileBins=TILE_BINS,tileCount=tileCountFor(fmax,p.fBin,tileBins);
      let visible=opts.visibleTileIndex;
      if(visible===undefined&&settings.vernierHz!==undefined)visible=tileIndexForHz(settings.vernierHz,p.fBin,tileBins,tileCount);
      if(visible===undefined)visible=old?.fullAxis?.visibleTileIndex??0;
      visible=Math.max(0,Math.min(tileCount-1,visible|0));
      const t0=tileBand(settings.res,visible,fmax,tileBins);
      gen.prepareFullAxis(tileCount);gen.selectTile(visible,tileBins);
      const viewFLo=old?.fullAxis?.viewFLo,viewFHi=old?.fullAxis?.viewFHi;
      const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:b.rfChannel,bins:tileBins,f0:0,fBin:p.fBin,rowRateHz:p.rowRateHz,dbFloor:settings.filter==='NB'?0:40,dbCeil:settings.filter==='NB'?30:110,res:settings.res,filter:settings.filter,bandHz:fmax,enbwHz:p.enbwHz,bandLimited:t0.bandLimited,liveBins:t0.liveBins,rowPhaseS:phase,fullAxis:true,tileBins,tileCount,visibleTileIndex:visible,...(viewFLo!==undefined&&viewFHi!==undefined?{viewFLo,viewFHi}:{})};
      const start=Math.floor((this.time-phase)/p.rowPeriodS+1e-9)*p.rowPeriodS+phase;
      this.subscriptions.set(streamId,{config,start,read:0,res:gen,fullAxis:{tileBins,tileCount,visibleTileIndex:visible,viewFLo,viewFHi,scheduled:0,queue:[],lastTile:{tileIndex:t0.tileIndex,tileBins,f0:t0.f0,fBin:t0.fBin,liveBins:t0.liveBins,filled:true}}});
      if(!this.legacyIndices.has(streamId))this.legacyIndices.set(streamId,0);return config;
    }
    const band=gen.band,config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:b.rfChannel,bins:RES_BINS,f0:band.f0,fBin:p.fBin,rowRateHz:p.rowRateHz,dbFloor:settings.filter==='NB'?0:40,dbCeil:settings.filter==='NB'?30:110,res:settings.res,filter:settings.filter,bandHz:p.bandHz,...(settings.vernierHz!==undefined?{fcHz:band.fcHz}:{}),enbwHz:p.enbwHz,bandLimited:band.bandLimited,liveBins:band.liveBins,rowPhaseS:phase};
    this.subscriptions.set(streamId,{config,start:Math.floor((this.time-phase)/p.rowPeriodS+1e-9)*p.rowPeriodS+phase,read:0,res:gen});if(!this.legacyIndices.has(streamId))this.legacyIndices.set(streamId,0);return config;
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
  unsubscribe(streamId:number):void{
    const sub=this.subscriptions.get(streamId);if(sub?.bandKey){const entry=this.lofarBandCache.get(sub.bandKey);if(entry&&--entry.refs<=0)this.lofarBandCache.delete(sub.bandKey);}
    this.subscriptions.delete(streamId);this.streams.delete(streamId);this.legacyIndices.delete(streamId);
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
    if(sub?.fullAxis&&sub.res){
      const fa=sub.fullAxis,job=fa.queue.shift()!;
      if(!isFeeding(b,this.time)){out.fill(NaN,offset,offset+bins);sub.res.bearingRow.fill(NaN);fa.lastTile={tileIndex:job.tileIndex,tileBins:fa.tileBins,f0:job.tileIndex*fa.tileBins*sub.config.fBin,fBin:sub.config.fBin,liveBins:0,filled:false};return rowIndex;}
      const t=tileBand(sub.config.res!,job.tileIndex,this.scenario.fMax??this.scenario.fmax,fa.tileBins);
      sub.res.renderTile(job.tileIndex,job.rowKey,out,offset,fa.tileBins);
      fa.lastTile={tileIndex:t.tileIndex,tileBins:t.tileBins,f0:t.f0,fBin:t.fBin,liveBins:t.liveBins,filled:true};
      // Mirror current tile on gramConfig so FE peeking config sees the last emitted slice.
      sub.config={...sub.config,f0:t.f0,liveBins:t.liveBins,bandLimited:t.bandLimited,simT:this.time};
      return rowIndex;
    }
    if(!isFeeding(b,this.time)){out.fill(NaN,offset,offset+bins);this.generators[i].lineCount=0;this.generators[i].bearingRow.fill(NaN);sub?.res?.bearingRow.fill(NaN);return rowIndex;}if(sub?.renderer)sub.renderer.write(out,offset);else if(sub?.res)sub.res.generate(out,offset);else (sub?.lofar??this.generators[i]).generate(out,offset);return rowIndex;
  }
  /** Copy the last generated per-bin DIFAR bearings (call after writeRow). NaN for omni/DEMON/dead. */
  writeBearingRow(streamId:number,out:Float32Array,offset=0):void {
    const i=this.streams.get(streamId);if(i===undefined)throw new Error('Unknown streamId');
    const sub=this.subscriptions.get(streamId),bins=sub?.config.bins??this.scenario.bins;
    if(!Number.isInteger(offset)||offset<0||out.length<offset+bins)throw new Error('Row size mismatch');
    const b=this.scenario.buoys[i];
    if(sub?.renderer||b.type!=='difar'||!isFeeding(b,this.time)){out.fill(NaN,offset,offset+bins);return;}
    out.set((sub?.res??sub?.lofar??this.generators[i]).bearingRow,offset);
  }
  dropBuoy(spec:DropBuoy):number {
    if(spec.kind!=='omni'&&spec.kind!=='difar')throw new Error('Receiver type pending approved plan');
    if(!(spec.channel>0)||!Number.isInteger(spec.channel))throw new Error('Invalid RF channel');
    let max=0;for(const b of this.scenario.buoys)max=Math.max(max,Number(b.id.replace(/\D/g,''))||0);
    const id=spec.id??max+1;if(!Number.isInteger(id)||id<1||id>2147483647)throw new Error('Invalid buoy id');
    this.addBuoy({id:`buoy-${id}`,rfChannel:spec.channel,type:spec.kind==='omni'?'passive-omni':'difar',x:spec.x,y:spec.y,depth:spec.hydrophoneDepthM,course:0,speed:0,deployedAt:this.time,life:spec.lifeS??7200});return id;
  }

  /** Numeric buoy id (`buoy-N` → N) or -1. */
  private buoyIndex(buoyId:number):number{return this.scenario.buoys.findIndex((b,i)=>(Number(b.id.replace(/\D/g,''))||i+1)===buoyId);}
  /** Lowest free RF channel in 1..max, or null when the pool is full. */
  lowestFreeChannel(max=MAX_RF_CHANNELS):number|null{const used=new Set<number>();for(const b of this.scenario.buoys)if(b.rfChannel>0)used.add(b.rfChannel);for(let ch=1;ch<=max;ch++)if(!used.has(ch))return ch;return null;}
  /** Release RF channel; buoy stays in the scenario for retune. Streams fill NaN while detuned. */
  detuneBuoy(buoyId:number):void{
    const i=this.buoyIndex(buoyId);if(i<0)throw new Error('Unknown buoyId');
    const b=this.scenario.buoys[i];if(!isTuned(b))return;
    b.rfChannel=0;this.rows[i].rfChannel=0;this.rows[i].alive=false;this.rows[i].bearing=null;this.generators[i].lineCount=0;
    for(const sub of this.subscriptions.values()){const si=this.streams.get(sub.config.streamId);if(si===i)sub.config.channel=0;}
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
    for(let i=0;i<this.allContacts.length;i++){const c=this.allContacts[i],out=this.truthState.contacts[i];out.active=c.active!==false;out.x=c.x;out.y=c.y;out.depthM=c.depth;out.crsDeg=(c.course*180/Math.PI+360)%360;out.spdMps=c.speed;out.spdKts=mpsToKnots(c.speed);for(let j=0;j<out.lines.length;j++){const line=c.lines![j],dst=out.lines[j];dst.f0Hz=line.hz;dst.freqHz=line.frequencyHz??line.hz;dst.power=line.power;dst.stability=line.stability!;dst.width=line.width!;dst.sigmaBins=line.sigmaBins??0;dst.eda=line.eda;dst.reactorId=line.reactorId;dst.lineFamily=line.lineFamily;dst.fundamentalHz=line.fundamentalHz;dst.harmonic=line.harmonic;dst.engineId=line.engineId;dst.shaftIndex=line.shaftIndex;}}return t;
  }
  advance(dt:number):void {
    if(!Number.isFinite(dt)||dt<0||dt>1e6||this.scenario.time+dt>1e9)throw new Error('Invalid step dt');
    const s=this.scenario,from=s.time;s.time+=dt;advance(s.ownship,dt);
    for(const c of this.allContacts){let t=from;for(const leg of c.motion)if(leg.at>from&&leg.at<=s.time){advance(c,leg.at-t);c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;t=leg.at;}advance(c,s.time-t);}
    const env=s.environment;for(const c of this.allContacts){c.params.waterTempC=env.temperatureC??15;c.params.waterSalinity=env.salinityPsu??35;if(c.params.plantSpec){c.params.reinforceBr1=c.params.plantSpec.reinforceBr1;c.params.psrHarmonicsStopAtBlades=c.params.plantSpec.psrHarmonicsStopAtBlades;}}for(const state of this.catalogStates){const c=state.contact;if(c.speed!==state.speed||c.depth!==state.depth){updateDerivedSignature(c.params,state.params,mpsToKnots(c.speed),c.depth,c.operatingMode??'normal');state.speed=c.speed;state.depth=c.depth;}}
    for(const state of this.surfaceStates){const c=state.contact;if(c.speed!==state.speed){refreshSurfaceSignature(c.params,state.type,mpsToKnots(c.speed));state.speed=c.speed;}}
    for(const c of this.allContacts){c.params.dutyClockS=s.time;applyIntermittentAuxPowers(c.params);}this.updateHydp();this.updateEngineRamps(false);this.updateSwaths();this.updateNarrowTransients();
    for(const w of this.lineWanders)w.advance(dt);
    for(let i=0;i<s.buoys.length;i++){
      const b=s.buoys[i],r=this.rows[i];advance(b,dt);r.alive=isFeeding(b,s.time);r.depth=b.depth;r.rfChannel=b.rfChannel;
      if(!r.alive){r.bearing=null;this.generators[i].lineCount=0;}
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
