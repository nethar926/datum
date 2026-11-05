import {configurePropulsion,updatePropulsion,writePlantTonals} from './catalog/plantModel.js';
import {LineWander} from './lineModel.js';
import {surfaceCount,createSurfacePool} from './catalog/surface.js';
import {DemonStream} from './demonStream.js';
import {resolveReference,updateDerivedSignature} from './catalog/derive.js';
import type {ClassParams} from './catalog/schema.js';
import type {Contact} from './scenario.js';
import {mpsToKnots,clamp} from './units.js';
import { validateScenario, loadScenario, type Scenario, type ScenarioInput, type Environment } from './scenario.js';
import { advance } from './kinematics.js';
import { isAlive, type ReceiverType, type Buoy } from './buoys.js';
import { LofarGenerator } from './lofar.js';
import type {GramConfig,Tactical,DropBuoy,TruthContact} from './protocol.js';
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
  private readonly subscriptions=new Map<number,{config:GramConfig;start:number;read:number;renderer?:DemonStream;lofar?:LofarGenerator}>();
  private readonly legacyIndices=new Map<number,number>();
  private nextStreamId=1;
  private readonly bearingStorage=Array.from({length:128*8},()=>({buoyId:0,freqHz:0,brgDeg:0,quality:0}));
  private readonly tacticalState:Tactical={v:1,type:'tactical',simT:0,aircraft:{x:0,y:0,altM:300,hdgDeg:0,gsMps:0},buoys:[],bearings:[]};
  constructor(scenario:ScenarioInput,seed?:number){if(seed!==undefined)scenario={...scenario,seed};const resolved=loadScenario(scenario);this.scenario=structuredClone(resolved);const s=this.scenario;
    s.surfacePool??=createSurfacePool(s.seed,Math.min(18,250-s.contacts.length));this.baseContacts=s.contacts.filter(c=>!s.surfacePool!.some(p=>p.id===c.id));this.allContacts=this.baseContacts.concat(s.surfacePool);
    if(s.surfacePool){const n=surfaceCount(s.surfaceTraffic??0,s.surfacePool.length);s.contacts.length=0;s.contacts.push(...this.baseContacts);for(let i=0;i<s.surfacePool.length;i++){s.surfacePool[i].active=i<n;if(i<n)s.contacts.push(s.surfacePool[i]);}}
    for(const c of this.allContacts){for(const leg of c.motion)if(leg.at<=s.time){c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;}}
    for(const c of this.allContacts)if(c.catalogRef)this.catalogStates.push({contact:c,params:resolveReference(c.catalogRef).params,speed:c.speed,depth:c.depth});
    for(const c of this.allContacts){configurePropulsion(c.params,s.seed,c.id,c.operatingMode??'normal');if(c.params.plantSpec){const state=this.catalogStates.find(s=>s.contact===c);if(state)updateDerivedSignature(c.params,state.params,mpsToKnots(c.speed),c.depth,c.operatingMode??'normal');else{updatePropulsion(c.params,c.params.shaftHz*60/c.params.plantSpec.maxPsrpm,c.operatingMode??'normal');writePlantTonals(c.params,c.operatingMode??'normal');}}const w=new LineWander(c.params,s.seed,c.id);c.lines=w.lines;this.lineWanders.push(w);}
    this.truthState={contacts:this.allContacts.map((c,i)=>({speedGated:c.params.speedGated??[],id:i+1,sourceId:c.id,label:c.catalogRef?`${c.params.label} ${resolveReference(c.catalogRef).klass.hulls.find(h=>h.id===c.catalogRef!.hullId)?.number??c.id}`:`${c.params.label} ${c.id}`,propulsion:c.params.propulsion!,spdKts:mpsToKnots(c.speed),active:c.active!==false,category:c.category??'subsurface',classificationTarget:c.category!=='surface'&&c.classificationTarget!==false,x:c.x,y:c.y,depthM:c.depth,crsDeg:c.course*180/Math.PI,spdMps:c.speed,lines:c.lines!.map(l=>({eda:l.eda,reactorId:l.reactorId,lineFamily:l.lineFamily,fundamentalHz:l.fundamentalHz,harmonic:l.harmonic,engineId:l.engineId,shaftIndex:l.shaftIndex,id:l.id!,family:l.family,f0Hz:l.hz,freqHz:l.frequencyHz??l.hz,power:l.power,stability:l.stability!,width:l.width!,sigmaBins:l.sigmaBins??0}))}))};this.tacticalState.truth=this.truthState;
    this.generators=s.buoys.map(b=>new LofarGenerator(b,this.allContacts,s.bins,s.band?.[1]??s.fMax??s.fmax,s.seed,s.environment,s.band?.[0]??0));
    s.buoys.forEach((_,i)=>{this.streams.set(i+1,i);this.legacyIndices.set(i+1,0);});
    this.rows=s.buoys.map((b,i)=>({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:this.generators[i].row}));
    s.classificationTargets??=this.baseContacts.filter(c=>c.category!=='surface'&&c.classificationTarget!==false).map(c=>c.id);this.syncTacticalBuoys();
  }
  get simT():number{return this.time;}
  get time():number {return this.scenario.time;}
  setEnvironment(environment:Environment):void {
    const next={...this.scenario,environment};validateScenario(next);
    this.scenario.environment={...environment};for(const generator of this.generators)generator.setEnvironment(environment);for(const sub of this.subscriptions.values()){sub.lofar?.setEnvironment(environment);sub.renderer?.setEnvironment(environment);}
  }
  setSurfaceTraffic(v:number):void{v=Number.isFinite(v)?clamp(v,0,1):.5;this.scenario.surfaceTraffic=v;const pool=this.scenario.surfacePool;if(pool){const n=surfaceCount(v,pool.length),contacts=this.scenario.contacts;contacts.length=this.baseContacts.length;for(let i=0;i<pool.length;i++){pool[i].active=i<n;if(i<n)contacts.push(pool[i]);}}this.setEnvironment({...this.scenario.environment,shippingDensity:v,shipping:v<.33?'light':v<.67?'moderate':'heavy'});}
  registerStream(id:number,channel:number):void {const i=this.scenario.buoys.findIndex(b=>b.rfChannel===channel);if(i<0)throw new Error('Unknown RF channel');this.streams.set(id,i);if(!this.legacyIndices.has(id))this.legacyIndices.set(id,0);}
  addBuoy(b:Buoy):void {const next={...this.scenario,buoys:[...this.scenario.buoys,b]};validateScenario(next);if(this.scenario.buoys.some(x=>x.rfChannel===b.rfChannel))throw new Error('RF channel already used');this.scenario.buoys.push({...b});const owned=this.scenario.buoys[this.scenario.buoys.length-1];const g=new LofarGenerator(owned,this.allContacts,this.scenario.bins,this.scenario.fmax,this.scenario.seed,this.scenario.environment);this.generators.push(g);this.rows.push({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:g.row});this.syncTacticalBuoys();}
  /** Subscription rows are ready at 4 Hz since subscribe; legacy registered streams remain pull-based.
   * If multiple rows accumulate, each is rendered using current geometry (no historical snapshot queue). */
  subscribe(req:{kind:'demon';buoyId:number;band?:[number,number]}):number;
  subscribe(req:{channel:number;kind?:'lofar';bins?:number;band?:[number,number]}):GramConfig;
  subscribe(req:{channel?:number;buoyId?:number;kind?:'lofar'|'demon';bins?:number;band?:[number,number]}):GramConfig|number {
    if(req.kind==='demon'){
      const i=this.scenario.buoys.findIndex((b,i)=>(Number(b.id.replace(/\D/g,''))||i+1)===req.buoyId);if(i<0)throw new Error('Unknown buoyId');
      const band=req.band??[1000,4000];if(band.length!==2||!band.every(Number.isFinite)||band[0]<20||band[1]>6000||band[1]-band[0]<1e-6)throw new Error('Invalid DEMON carrier band (20..6000 Hz)');
      while(this.streams.has(this.nextStreamId))this.nextStreamId++;const id=this.nextStreamId++,b=this.scenario.buoys[i];this.registerStream(id,b.rfChannel);
      const renderer=new DemonStream(b,this.allContacts,this.scenario.seed,band,this.scenario.environment),config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId:id,kind:'demon',channel:b.rfChannel,bins:512,f0:0,fBin:renderer.fBin,rowRateHz:4,dbFloor:0,dbCeil:30,demodBandHz:[band[0],band[1]]};
      this.subscriptions.set(id,{config,start:Math.floor(this.time*4)/4,read:0,renderer});return id;
    }

    const s=this.scenario;
    if(req.kind!==undefined&&req.kind!=='lofar')throw new Error('Unsupported gram kind: M1 supports lofar only');
    if(req.bins!==undefined&&req.bins!==s.bins)throw new Error(`Unsupported bins: scenario requires ${s.bins}`);
    const band=req.band??s.band??[0,s.fMax??s.fmax];if(band.length!==2||!band.every(Number.isFinite)||band[0]<0||band[1]>1e6||band[1]-band[0]<1e-6)throw new Error('Invalid LOFAR band');
    while(this.streams.has(this.nextStreamId))this.nextStreamId++;
    const streamId=this.nextStreamId;if(req.channel===undefined)throw new Error('LOFAR channel required');this.registerStream(streamId,req.channel);this.nextStreamId++;
    const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:req.channel,bins:s.bins,f0:band[0],fBin:(band[1]-band[0])/(s.bins-1),rowRateHz:4,dbFloor:40,dbCeil:110};
    const index=this.streams.get(streamId)!,base=this.generators[index],lofar=base.f0===band[0]&&base.fmax===band[1]?undefined:new LofarGenerator(s.buoys[index],this.allContacts,s.bins,band[1],s.seed,s.environment,band[0]);
    this.subscriptions.set(streamId,{config,start:Math.floor(this.time*4)/4,read:0,lofar});return config;
  }
  unsubscribe(streamId:number):void{this.subscriptions.delete(streamId);this.streams.delete(streamId);this.legacyIndices.delete(streamId);}
  configs():GramConfig[]{return Array.from(this.subscriptions.values(),s=>s.config);}
  rowsReady(streamId:number):number{const s=this.subscriptions.get(streamId);return s?Math.max(0,Math.floor((this.time-s.start)*s.config.rowRateHz+1e-9)-s.read):(this.streams.has(streamId)?1:0);}
  writeRow(streamId:number,out:Float32Array,offset=0):number {
    const i=this.streams.get(streamId);if(i===undefined)throw new Error('Unknown streamId');
    const sub=this.subscriptions.get(streamId),bins=sub?.config.bins??this.scenario.bins;
    if(!Number.isInteger(offset)||offset<0||out.length<offset+bins)throw new Error('Row size mismatch');
    if(sub&&this.rowsReady(streamId)===0)return -1;
    const rowIndex=sub?sub.read++:this.legacyIndices.get(streamId)??0;if(!sub)this.legacyIndices.set(streamId,rowIndex+1);
    const b=this.scenario.buoys[i];if(!isAlive(b,this.time)){out.fill(NaN,offset,offset+bins);this.generators[i].lineCount=0;return rowIndex;}if(sub?.renderer)sub.renderer.write(out,offset);else (sub?.lofar??this.generators[i]).generate(out,offset);return rowIndex;
  }
  dropBuoy(spec:DropBuoy):number {
    if(spec.kind!=='omni'&&spec.kind!=='difar')throw new Error('Receiver type pending approved plan');
    let max=0;for(const b of this.scenario.buoys)max=Math.max(max,Number(b.id.replace(/\D/g,''))||0);
    const id=spec.id??max+1;if(!Number.isInteger(id)||id<1||id>2147483647)throw new Error('Invalid buoy id');
    this.addBuoy({id:`buoy-${id}`,rfChannel:spec.channel,type:spec.kind==='omni'?'passive-omni':'difar',x:spec.x,y:spec.y,depth:spec.hydrophoneDepthM,course:0,speed:0,deployedAt:this.time,life:spec.lifeS??7200});return id;
  }
  private syncTacticalBuoys():void{this.tacticalState.buoys=this.scenario.buoys.map((b,i)=>({id:Number(b.id.replace(/\D/g,''))||i+1,channel:b.rfChannel,kind:b.type==='difar'?'difar':'omni',x:b.x,y:b.y,hydrophoneDepthM:b.depth,batteryFrac:1,lifeRemainingS:b.life,state:'live'}));}
  /** Reuses the tactical object/records; callers needing snapshots should structuredClone it. */
  tactical():Tactical {
    const s=this.scenario,t=this.tacticalState;t.simT=this.time;const a=t.aircraft;a.x=s.ownship.x;a.y=s.ownship.y;a.hdgDeg=(s.ownship.course*180/Math.PI+360)%360;a.gsMps=s.ownship.speed;
    let count=0;for(let i=0;i<s.buoys.length;i++){const b=s.buoys[i],out=t.buoys[i];out.x=b.x;out.y=b.y;out.hydrophoneDepthM=b.depth;out.lifeRemainingS=Math.max(0,b.deployedAt+b.life-this.time);out.batteryFrac=Math.max(0,Math.min(1,out.lifeRemainingS/b.life));out.state=this.time<b.deployedAt?'falling':isAlive(b,this.time)?'live':'dead';
      if(b.type==='difar'&&isAlive(b,this.time)){const g=this.generators[i];for(let j=0;j<g.lineCount;j++){const src=g.lines[j],dst=this.bearingStorage[count];dst.buoyId=out.id;dst.freqHz=src.freqHz;dst.brgDeg=src.brgDeg;dst.quality=src.quality;t.bearings[count++]=dst;}}
    }t.bearings.length=count;
    for(let i=0;i<this.allContacts.length;i++){const c=this.allContacts[i],out=this.truthState.contacts[i];out.active=c.active!==false;out.x=c.x;out.y=c.y;out.depthM=c.depth;out.crsDeg=(c.course*180/Math.PI+360)%360;out.spdMps=c.speed;out.spdKts=mpsToKnots(c.speed);for(let j=0;j<out.lines.length;j++){const line=c.lines![j],dst=out.lines[j];dst.f0Hz=line.hz;dst.freqHz=line.frequencyHz??line.hz;dst.power=line.power;dst.stability=line.stability!;dst.width=line.width!;dst.sigmaBins=line.sigmaBins??0;dst.eda=line.eda;dst.reactorId=line.reactorId;dst.lineFamily=line.lineFamily;dst.fundamentalHz=line.fundamentalHz;dst.harmonic=line.harmonic;dst.engineId=line.engineId;dst.shaftIndex=line.shaftIndex;}}return t;
  }
  advance(dt:number):void {
    if(!Number.isFinite(dt)||dt<0||dt>1e6||this.scenario.time+dt>1e9)throw new Error('Invalid step dt');
    const s=this.scenario,from=s.time;s.time+=dt;advance(s.ownship,dt);
    for(const c of this.allContacts){let t=from;for(const leg of c.motion)if(leg.at>from&&leg.at<=s.time){advance(c,leg.at-t);c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;t=leg.at;}advance(c,s.time-t);}
    for(const state of this.catalogStates){const c=state.contact;if(c.speed!==state.speed||c.depth!==state.depth){updateDerivedSignature(c.params,state.params,mpsToKnots(c.speed),c.depth,c.operatingMode??'normal');state.speed=c.speed;state.depth=c.depth;}}
    for(const w of this.lineWanders)w.advance(dt);
    for(let i=0;i<s.buoys.length;i++){
      const b=s.buoys[i],r=this.rows[i];advance(b,dt);r.alive=isAlive(b,s.time);r.depth=b.depth;r.rfChannel=b.rfChannel;
      if(!r.alive){r.bearing=null;this.generators[i].lineCount=0;}
    }
  }
  step(dt:number):readonly BuoyRow[]{
    for(const r of this.rows)if(r.row.length!==this.scenario.bins)throw new Error('Missing row buffer');
    this.advance(dt);for(let i=0;i<this.rows.length;i++){const r=this.rows[i];if(r.alive){this.generators[i].generate(r.row);r.bearing=r.type==='difar'?this.generators[i].bearing:null;}else r.row.fill(NaN);}return this.rows;
  }
}
