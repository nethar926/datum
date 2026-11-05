import { validateScenario, type Scenario, type Environment } from './scenario.js';
import { advance } from './kinematics.js';
import { isAlive, type ReceiverType, type Buoy } from './buoys.js';
import { LofarGenerator } from './lofar.js';
import type {GramConfig,Tactical,DropBuoy} from './protocol.js';
export interface BuoyRow { id:string; rfChannel:number; depth:number; type:ReceiverType; alive:boolean; bearing:number|null; row:Float32Array }
/** Deterministic mutable simulation; construction owns a JSON-safe copy. step has no allocations.
 * Callers may replace each result.row with an appropriately sized recycled buffer before step. */
export class AcousticEngine {
  readonly scenario:Scenario;readonly rows:BuoyRow[];readonly generators:LofarGenerator[];
  private readonly streams=new Map<number,number>();
  private readonly subscriptions=new Map<number,{config:GramConfig;start:number;read:number}>();
  private readonly legacyIndices=new Map<number,number>();
  private nextStreamId=1;
  private readonly bearingStorage=Array.from({length:128*8},()=>({buoyId:0,freqHz:0,brgDeg:0,quality:0}));
  private readonly tacticalState:Tactical={v:1,type:'tactical',simT:0,aircraft:{x:0,y:0,altM:300,hdgDeg:0,gsMps:0},buoys:[],bearings:[]};
  constructor(scenario:Scenario,seed?:number){if(seed!==undefined)scenario={...scenario,seed};validateScenario(scenario);this.scenario=structuredClone(scenario);const s=this.scenario;
    for(const c of s.contacts){for(const leg of c.motion)if(leg.at<=s.time){c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;}}
    this.generators=s.buoys.map(b=>new LofarGenerator(b,s.contacts,s.bins,s.fmax,s.seed,s.environment));
    s.buoys.forEach((_,i)=>{this.streams.set(i+1,i);this.legacyIndices.set(i+1,0);});
    this.rows=s.buoys.map((b,i)=>({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:this.generators[i].row}));
    this.syncTacticalBuoys();
  }
  get simT():number{return this.time;}
  get time():number {return this.scenario.time;}
  setEnvironment(environment:Environment):void {
    const next={...this.scenario,environment};validateScenario(next);
    this.scenario.environment={...environment};for(const generator of this.generators)generator.setEnvironment(environment);
  }
  registerStream(id:number,channel:number):void {const i=this.scenario.buoys.findIndex(b=>b.rfChannel===channel);if(i<0)throw new Error('Unknown RF channel');this.streams.set(id,i);if(!this.legacyIndices.has(id))this.legacyIndices.set(id,0);}
  addBuoy(b:Buoy):void {const next={...this.scenario,buoys:[...this.scenario.buoys,b]};validateScenario(next);if(this.scenario.buoys.some(x=>x.rfChannel===b.rfChannel))throw new Error('RF channel already used');this.scenario.buoys.push({...b});const owned=this.scenario.buoys[this.scenario.buoys.length-1];const g=new LofarGenerator(owned,this.scenario.contacts,this.scenario.bins,this.scenario.fmax,this.scenario.seed,this.scenario.environment);this.generators.push(g);this.rows.push({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:g.row});this.syncTacticalBuoys();}
  /** Subscription rows are ready at 4 Hz since subscribe; legacy registered streams remain pull-based.
   * If multiple rows accumulate, each is rendered using current geometry (no historical snapshot queue). */
  subscribe(req:{channel:number;kind:'lofar';bins?:number;band?:[number,number]}):GramConfig {
    const s=this.scenario;
    if(req.kind!=='lofar')throw new Error('Unsupported gram kind: M1 supports lofar only');
    if(req.bins!==undefined&&req.bins!==s.bins)throw new Error(`Unsupported bins: scenario requires ${s.bins}`);
    if(req.band!==undefined&&(req.band[0]!==0||req.band[1]!==s.fmax))throw new Error(`Unsupported band: scenario requires [0, ${s.fmax}] Hz`);
    while(this.streams.has(this.nextStreamId))this.nextStreamId++;
    const streamId=this.nextStreamId;this.registerStream(streamId,req.channel);this.nextStreamId++;
    const config:GramConfig={v:1,type:'gramConfig',simT:this.time,streamId,kind:'lofar',channel:req.channel,bins:s.bins,f0:0,fBin:s.fmax/(s.bins-1),rowRateHz:4,dbFloor:40,dbCeil:110};
    this.subscriptions.set(streamId,{config,start:this.time,read:0});return config;
  }
  unsubscribe(streamId:number):void{this.subscriptions.delete(streamId);this.streams.delete(streamId);this.legacyIndices.delete(streamId);}
  configs():GramConfig[]{return Array.from(this.subscriptions.values(),s=>s.config);}
  rowsReady(streamId:number):number{const s=this.subscriptions.get(streamId);return s?Math.max(0,Math.floor((this.time-s.start)*s.config.rowRateHz+1e-9)-s.read):(this.streams.has(streamId)?1:0);}
  writeRow(streamId:number,out:Float32Array,offset=0):number {
    const i=this.streams.get(streamId);if(i===undefined)throw new Error('Unknown streamId');
    if(!Number.isInteger(offset)||offset<0||out.length<offset+this.scenario.bins)throw new Error('Row size mismatch');
    const sub=this.subscriptions.get(streamId);if(sub&&this.rowsReady(streamId)===0)return -1;
    const rowIndex=sub?sub.read++:this.legacyIndices.get(streamId)??0;if(!sub)this.legacyIndices.set(streamId,rowIndex+1);
    const b=this.scenario.buoys[i];if(!isAlive(b,this.time)){out.fill(NaN,offset,offset+this.scenario.bins);this.generators[i].lineCount=0;return rowIndex;}this.generators[i].generate(out,offset);return rowIndex;
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
    }t.bearings.length=count;return t;
  }
  advance(dt:number):void {
    if(!Number.isFinite(dt)||dt<0||dt>1e6||this.scenario.time+dt>1e9)throw new Error('Invalid step dt');
    const s=this.scenario,from=s.time;s.time+=dt;advance(s.ownship,dt);
    for(const c of s.contacts){let t=from;for(const leg of c.motion)if(leg.at>from&&leg.at<=s.time){advance(c,leg.at-t);c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;t=leg.at;}advance(c,s.time-t);}
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
