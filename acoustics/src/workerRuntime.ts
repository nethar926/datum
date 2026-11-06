import {AcousticEngine} from './engine.js';
import {cpaScenario,lloydsCpaScenario} from './scenario.js';
import {isAlive,isFeeding} from './buoys.js';
import type {GramConfig,GramRows,Tactical,WorkerRequest,WorkerResponse} from './protocol.js';
type Frame={message:GramRows;transfer:ArrayBuffer[]};
/** Row period: legacy grams 0.25 s; RES grams P=1/rowRateHz (exact: 8, 4 or 2 s). */
const periodOf=(c:GramConfig):number=>c.res===undefined?.25:1/c.rowRateHz;
const phaseOf=(c:GramConfig):number=>c.rowPhaseS??0;
const due=(period:number,t:number,phase=0):boolean=>period===.25||Math.abs((t-phase)/period-Math.round((t-phase)/period))<1e-9;
/** M1 worker controller, independently testable without Worker/Node APIs. Fixed three-batch pool.
 * Commands/config changes may allocate; tick/writeRow allocate no sample/row arrays. */
export class WorkerRuntime {
  engine?:AcousticEngine;
  private seed=42;private rate=1;private nextId=1;private nextRow=.25;
  private readonly configs:GramConfig[]=[];
  private readonly indices=new Map<number,number>();
  /** Packed batch groups: fixed legacy 4 Hz LOFAR/DEMON groups by bin count, then one RES 1024-bin
   * group per (row period P, row phase) present, ordered P desc, phase asc. Every stream in a group is
   * due on the same 0.25 s tick (t = k·P + rowPhaseS). Rebuilt on (un)subscribe/setGram only. */
  private readonly groups:{bins:number;period:number;phase:number;tiled:boolean;configs:GramConfig[];pool:Frame[]}[]=[{bins:1024,period:.25},{bins:512,period:.25},{bins:4096,period:.25}].map(g=>({...g,phase:0,tiled:false,configs:[] as GramConfig[],pool:[] as Frame[]}));
  private readonly scratch=new Float32Array(4096);
  private timer:ReturnType<typeof setInterval>|undefined;
  private readonly bearingStore=Array.from({length:128*8},()=>({buoyId:0,freqHz:0,brgDeg:0,quality:0}));
  private readonly tactical:Tactical={v:1,type:'tactical',simT:0,aircraft:{x:0,y:0,altM:300,hdgDeg:0,gsMps:0},buoys:[],bearings:[]};
  constructor(private readonly emit:(message:WorkerResponse,transfer?:ArrayBuffer[])=>void){}
  get simT():number{return this.engine?.time??0;}
  dispose():void{if(this.timer!==undefined){clearInterval(this.timer);this.timer=undefined;}}
  command(m:WorkerRequest):void{try{
    if(m.v!==1||!Number.isFinite(m.simT))throw new Error('Expected v1 and finite simT');
    if(m.type==='init'){
      if(m.scenarioId!=='cpa-pass'&&m.scenarioId!=='m1-cpa-pass'&&m.scenarioId!=='m2-lloyds-cpa')throw new Error('Unknown scenarioId; M1 supports cpa-pass');
      const s=m.scenarioId==='m2-lloyds-cpa'?lloydsCpaScenario(m.seed):cpaScenario();s.seed=m.seed;const engine=new AcousticEngine(s);this.dispose();this.engine=engine;this.seed=m.seed;this.rate=1;this.nextId=1;this.nextRow=.25;this.configs.length=0;this.indices.clear();
      for(const b of engine.scenario.buoys)this.subscribe(b.rfChannel);this.rebuildPool();this.rebuildTactical();this.sendTactical();return;
    }
    const e=this.engine;if(!e)throw new Error('Initialize first');
    switch(m.type){
      case 'play':if(this.timer===undefined)this.timer=setInterval(()=>this.tick(.25*this.rate),250);break;
      case 'pause':this.dispose();break;
      case 'setRate':if(!Number.isFinite(m.x)||m.x<.1||m.x>64)throw new Error('Rate must be 0.1..64');this.rate=m.x;break;
      case 'setSurfaceTraffic':e.setSurfaceTraffic(m.value);this.sendTactical();break;
      case 'seek':this.seek(m.simT);break;
      case 'dropBuoy':{
        if(m.kind!=='omni'&&m.kind!=='difar')throw new Error('Receiver type pending approved plan');
        if(!(m.channel>0)||!Number.isInteger(m.channel))throw new Error('Invalid RF channel');
        const id=m.id??(Math.max(0,...this.tactical.buoys.map(b=>b.id))+1);
        if(!Number.isInteger(id)||id<1||this.tactical.buoys.some(b=>b.id===id))throw new Error('Invalid buoy id');
        e.addBuoy({id:`buoy-${id}`,rfChannel:m.channel,type:m.kind==='omni'?'passive-omni':'difar',x:m.x,y:m.y,depth:m.hydrophoneDepthM,course:0,speed:0,deployedAt:e.time,life:m.lifeS??7200});
        this.rebuildTactical();this.sendTactical();break;
      }
      case 'subscribe':{
        if(m.kind==='demon'){
          if(m.buoyId===undefined)throw new Error('DEMON requires buoyId');
          const id=e.subscribe({kind:'demon',buoyId:m.buoyId,band:m.demodBandHz??m.band}),config=e.configs().find(c=>c.streamId===id)!;
          this.configs.push(config);this.indices.set(id,0);this.emit(config);this.rebuildPool();break;
        }
        if(m.kind!==undefined&&m.kind!=='lofar')throw new Error('Unsupported gram kind');
        if(m.channel===undefined)throw new Error('LOFAR requires channel');
        if(m.res!==undefined||m.filter!==undefined||m.vernierHz!==undefined||m.fullAxis){
          const config=e.subscribe({channel:m.channel,kind:'lofar',bins:m.bins,band:m.band,bandPreset:m.bandPreset,res:m.res,filter:m.filter,vernierHz:m.vernierHz,fullAxis:m.fullAxis,visibleTileIndex:m.visibleTileIndex});
          const existing=this.configs.find(c=>c.channel===config.channel&&c.res===config.res&&c.filter===config.filter&&!!c.fullAxis===!!config.fullAxis&&c.f0===config.f0&&c.fcHz===config.fcHz&&c.visibleTileIndex===config.visibleTileIndex);
          if(existing){e.unsubscribe(config.streamId);this.emit({...existing,simT:e.time});}else{this.configs.push(config);this.indices.set(config.streamId,0);this.emit(config);this.rebuildPool();}break;
        }
        const config=e.subscribe({channel:m.channel,kind:'lofar',bins:m.bins,band:m.band,bandPreset:m.bandPreset});
        const existing=this.configs.find(c=>c.res===undefined&&c.channel===config.channel&&c.kind==='lofar'&&c.f0===config.f0&&Math.abs(c.f0+c.fBin*(c.bins-1)-(config.f0+config.fBin*(config.bins-1)))<1e-8&&c.bandPreset===config.bandPreset);
        if(existing){e.unsubscribe(config.streamId);this.emit({...existing,simT:e.time});}else{this.configs.push(config);this.indices.set(config.streamId,0);this.emit(config);this.rebuildPool();}break;
      }
      case 'setGram':{
        const i=this.configs.findIndex(c=>c.streamId===m.streamId);if(i<0)throw new Error('Unknown streamId');if(this.configs[i].kind!=='lofar')throw new Error('setGram applies to LOFAR streams only');
        const config=e.setGram(m.streamId,{res:m.res,filter:m.filter,vernierHz:m.vernierHz,fullAxis:m.fullAxis,visibleTileIndex:m.visibleTileIndex});this.configs[i]=config;this.emit(config);this.rebuildPool();break;
      }
      case 'setViewWindow':{
        const i=this.configs.findIndex(c=>c.streamId===m.streamId);if(i<0)throw new Error('Unknown streamId');
        const config=e.setViewWindow(m.streamId,{fLo:m.fLo,fHi:m.fHi});this.configs[i]=config;this.emit(config);break;
      }
      case 'unsubscribe':{const i=this.configs.findIndex(c=>c.streamId===m.streamId);if(i>=0){this.configs.splice(i,1);this.indices.delete(m.streamId);e.unsubscribe(m.streamId);this.rebuildPool();}break;}
      case 'skipToLatest':{
        if(!this.configs.some(c=>c.streamId===m.streamId))throw new Error('Unknown streamId');
        // Cursor-only: discard the stream's pending backlog without emitting intermediate gramRows.
        // FE host that wants the newest sample calls engine.skipToLatest(id, out) directly.
        const idx=e.skipToLatest(m.streamId);if(idx>=0)this.indices.set(m.streamId,idx+1);break;
      }
      case 'detuneBuoy':e.detuneBuoy(m.buoyId);this.sendTactical();break;
      case 'tuneBuoy':e.tuneBuoy(m.buoyId,m.channel);this.sendTactical();break;
      case 'setBuoyFault':e.setBuoyFault(m.buoyId,m.fault);this.sendTactical();break;
      case 'release':this.release(m.buffers);break;
      default:throw new Error('Unknown command');
    }
  }catch(error){this.error(error);}}
  private error(error:unknown):void{this.emit({v:1,type:'error',simT:this.simT,message:error instanceof Error?error.message:'Worker error'});}
  private subscribe(channel:number):void{
    const e=this.engine!;while(this.configs.some(c=>c.streamId===this.nextId))this.nextId++;const id=this.nextId++;e.registerStream(id,channel);const config:GramConfig={v:1,type:'gramConfig',simT:e.time,streamId:id,kind:'lofar',channel,bins:e.scenario.bins,f0:0,fBin:e.scenario.fmax/(e.scenario.bins-1),rowRateHz:4,dbFloor:40,dbCeil:110};
    this.configs.push(config);this.indices.set(id,0);this.emit(config);
  }
  private frame(ids:Int32Array,indices:Uint32Array,data:Float32Array,bearingDeg:Float32Array,tiles?:{tileIndex:Int32Array;tileBins:Int32Array;tileF0:Float32Array;filled:Uint8Array}):Frame{
    const message:GramRows={v:1,type:'gramRows',simT:this.simT,streamIds:ids,rowIndex:indices,data,bearingDeg,...(tiles?{tileIndex:tiles.tileIndex,tileBins:tiles.tileBins,tileF0:tiles.tileF0,filled:tiles.filled}:{})};
    const transfer:ArrayBuffer[]=[ids.buffer as ArrayBuffer,indices.buffer as ArrayBuffer,data.buffer as ArrayBuffer,bearingDeg.buffer as ArrayBuffer];
    if(tiles)transfer.push(tiles.tileIndex.buffer as ArrayBuffer,tiles.tileBins.buffer as ArrayBuffer,tiles.tileF0.buffer as ArrayBuffer,tiles.filled.buffer as ArrayBuffer);
    return {message,transfer};
  }
  private rebuildPool():void{
    this.groups.length=3;const keys=new Map<string,{bins:number;period:number;phase:number;tiled:boolean}>();
    // Vernier RES only in phased groups; FULLBAND streams are drained as singleton tile frames in tick.
    for(const c of this.configs)if(c.res!==undefined&&!c.fullAxis)keys.set(`${c.bins}@${periodOf(c)}@${phaseOf(c)}`,{bins:c.bins,period:periodOf(c),phase:phaseOf(c),tiled:false});
    for(const k of [...keys.values()].sort((a,b)=>b.period-a.period||a.phase-b.phase||a.bins-b.bins))this.groups.push({bins:k.bins,period:k.period,phase:k.phase,tiled:false,configs:[],pool:[]});
    // Dedicated singleton pool for FULLBAND tile emits (bins=TILE_BINS).
    if(this.configs.some(c=>c.fullAxis))this.groups.push({bins:4096,period:.25,phase:0,tiled:true,configs:[],pool:[]});
    for(const g of this.groups){g.pool.length=0;g.configs.length=0;for(const c of this.configs){if(g.tiled){if(c.fullAxis)g.configs.push(c);continue;}if(c.fullAxis)continue;if(c.bins===g.bins&&periodOf(c)===g.period&&(g.period===.25||phaseOf(c)===g.phase))g.configs.push(c);}
      const n=g.tiled?1:g.configs.length;if(!g.tiled&&!n)continue;if(g.tiled){for(let i=0;i<6;i++)g.pool.push(this.frame(new Int32Array(1),new Uint32Array(1),new Float32Array(g.bins),new Float32Array(g.bins),{tileIndex:new Int32Array(1),tileBins:new Int32Array(1),tileF0:new Float32Array(1),filled:new Uint8Array(1)}));}
      else if(n)for(let i=0;i<3;i++)g.pool.push(this.frame(new Int32Array(n),new Uint32Array(n),new Float32Array(n*g.bins),new Float32Array(n*g.bins)));}
  }
  private release(buffers:ArrayBuffer[]):void{
    // 4 = legacy/RES vernier; 8 = FULLBAND (+ tileIndex/tileBins/tileF0/filled).
    if(buffers.length%4!==0&&buffers.length%8!==0)throw new Error('Release complete batches: ids, rowIndex, data, bearingDeg[, tileIndex, tileBins, tileF0, filled]');
    let step=4;
    if(buffers.length%8===0){const n0=buffers[0].byteLength/4;if(buffers.length>=8&&buffers[4]?.byteLength===n0*4&&buffers[7]?.byteLength===n0)step=8;}
    for(let i=0;i<buffers.length;i+=step){const a=buffers[i],b=buffers[i+1],c=buffers[i+2],d=buffers[i+3];
      if(!(a instanceof ArrayBuffer)||!(b instanceof ArrayBuffer)||!(c instanceof ArrayBuffer)||!(d instanceof ArrayBuffer))throw new Error('Invalid release buffer');
      const n=a.byteLength/4;if(!n||b.byteLength!==a.byteLength||d.byteLength!==c.byteLength)continue;
      const bins=c.byteLength/(n*4),g=this.groups.find(g=>g.bins===bins&&(step===8?g.tiled:!g.tiled)&&((g.tiled&&g.pool.length<6)||(!g.tiled&&g.configs.length===n&&g.pool.length<3)));if(!g)continue;
      const tiles=step===8?{tileIndex:new Int32Array(buffers[i+4]),tileBins:new Int32Array(buffers[i+5]),tileF0:new Float32Array(buffers[i+6]),filled:new Uint8Array(buffers[i+7])}:undefined;
      g.pool.push(this.frame(new Int32Array(a),new Uint32Array(b),new Float32Array(c),new Float32Array(d),tiles));
    }
  }
  private emitFullAxisTile(c:GramConfig):void{
    const e=this.engine!;if(e.rowsReady(c.streamId)<=0)return;
    const g=this.groups.find(g=>g.tiled&&g.bins===c.bins);const frame=g?.pool.pop();
    if(!frame){e.writeRow(c.streamId,this.scratch);return;}
    const m=frame.message;m.simT=e.time;m.streamIds[0]=c.streamId;
    const rowIndex=e.writeRow(c.streamId,m.data,0);m.rowIndex[0]=rowIndex;this.indices.set(c.streamId,rowIndex+1);
    e.writeBearingRow(c.streamId,m.bearingDeg!,0);
    const tile=e.lastFullAxisTile(c.streamId);if(tile&&m.tileIndex&&m.tileBins&&m.tileF0&&m.filled){m.tileIndex[0]=tile.tileIndex;m.tileBins[0]=tile.tileBins;m.tileF0[0]=tile.f0;m.filled[0]=tile.filled?1:0;}
    const cfg=e.configs().find(x=>x.streamId===c.streamId);if(cfg){const i=this.configs.findIndex(x=>x.streamId===c.streamId);if(i>=0)this.configs[i]=cfg;}
    this.emit(m,frame.transfer);
  }
  /** Exactly one incremental row per subscribed stream. Pool starvation drops rows but keeps sim time.
   * FULLBAND streams emit tile slices (visible±1 hot, then backfill) as singleton 4096-bin frames. */
  tick(dt:number):void{try{
    const e=this.engine;if(!e)throw new Error('Initialize first');
    if(!Number.isFinite(dt)||dt<0||dt>1e6||e.time+dt>1e9)throw new Error('Invalid tick dt');
    const target=e.time+dt;
    while(this.nextRow<=target){const t=this.nextRow;e.advance(t-e.time);this.nextRow+=.25;
      for(const c of this.configs)if(!c.fullAxis&&due(periodOf(c),t,phaseOf(c)))this.indices.set(c.streamId,(this.indices.get(c.streamId)??0)+1);
      for(const g of this.groups){if(g.tiled||!g.configs.length||!due(g.period,t,g.phase))continue;const frame=g.pool.pop();
        if(frame){const m=frame.message;m.simT=e.time;for(let i=0;i<g.configs.length;i++){const c=g.configs[i];m.streamIds[i]=c.streamId;m.rowIndex[i]=this.indices.get(c.streamId)!-1;e.writeRow(c.streamId,m.data,i*g.bins);e.writeBearingRow(c.streamId,m.bearingDeg!,i*g.bins);}this.emit(m,frame.transfer);}
        else for(const c of g.configs)e.writeRow(c.streamId,this.scratch);
      }
      for(const c of this.configs){if(!c.fullAxis)continue;
        // Hot path on the stream's row-period tick: drain visible±1 (≤3). Otherwise backfill ≤2.
        const hot=due(periodOf(c),t,phaseOf(c)),budget=hot?3:2;
        for(let n=0;n<budget&&e.rowsReady(c.streamId)>0;n++)this.emitFullAxisTile(c);
      }
    }
    e.advance(target-e.time);
    this.sendTactical();
  }catch(error){this.error(error);}}
  private rebuildTactical():void{const e=this.engine!;this.tactical.buoys=e.scenario.buoys.map((b,i)=>({id:Number(b.id.replace(/\D/g,''))||i+1,channel:b.rfChannel,kind:b.type==='difar'?'difar':'omni',x:b.x,y:b.y,hydrophoneDepthM:b.depth,batteryFrac:1,lifeRemainingS:b.life,state:'live',health:b.fault?'fault':'ok'}));}
  private sendTactical():void{
    const e=this.engine!,s=e.scenario,t=this.tactical;t.simT=e.time;t.aircraft.x=s.ownship.x;t.aircraft.y=s.ownship.y;t.aircraft.hdgDeg=(s.ownship.course*180/Math.PI+360)%360;t.aircraft.gsMps=s.ownship.speed;
    let count=0;for(let i=0;i<s.buoys.length;i++){const b=s.buoys[i],out=t.buoys[i];out.x=b.x;out.y=b.y;out.hydrophoneDepthM=b.depth;out.channel=b.rfChannel;out.lifeRemainingS=Math.max(0,b.deployedAt+b.life-e.time);out.batteryFrac=Math.max(0,Math.min(1,out.lifeRemainingS/b.life));out.state=e.time<b.deployedAt?'falling':isAlive(b,e.time)?'live':'dead';out.health=b.fault?'fault':'ok';
      if(b.type==='difar'&&isFeeding(b,e.time)){const g=e.generators[i];for(let j=0;j<g.lineCount;j++){const src=g.lines[j],dst=this.bearingStore[count];dst.buoyId=out.id;dst.freqHz=src.freqHz;dst.brgDeg=src.brgDeg;dst.quality=src.quality;t.bearings[count++]=dst;}}
    }t.bearings.length=count;t.truth=e.tactical().truth;this.emit(t);
  }
  private seek(target:number):void{
    if(this.configs.some(c=>c.kind==='demon'||(c.res===undefined&&(c.f0!==0||Math.abs(c.fBin*(c.bins-1)-500)>1e-8))))throw new Error('Seek with DEMON awaits analysis-window replay');
    if(target<0||target>3600)throw new Error('M1 seek range is 0..3600 seconds');
    if(this.engine!.scenario.buoys.length!==1)throw new Error('Seek after drops awaits scenario event log');
    // Replay the seeded row schedule, preserving fluctuations exactly at 4 rows/s.
    // RES streams replay as if their gram settings were applied at t=0 (rows on the P grid).
    this.dispose();const s=cpaScenario();s.seed=this.seed;this.engine=new AcousticEngine(s);
    for(let k=0;k<this.configs.length;k++){const c=this.configs[k];this.engine.registerStream(c.streamId,c.channel);if(c.res!==undefined)this.configs[k]=this.engine.setGram(c.streamId,{res:c.res,filter:c.filter,vernierHz:c.fcHz,fullAxis:c.fullAxis??null,visibleTileIndex:c.visibleTileIndex});}
    const scratch=new Float32Array(4096),rows=new Map<number,number>();const steps=Math.floor(target*4);for(let i=0;i<steps;i++){this.engine.advance(.25);const t=(i+1)*.25;for(const c of this.configs){if(c.fullAxis){while(this.engine.rowsReady(c.streamId)>0){this.engine.writeRow(c.streamId,scratch);rows.set(c.streamId,(rows.get(c.streamId)??0)+1);}continue;}if(due(periodOf(c),t,phaseOf(c))){this.engine.writeRow(c.streamId,scratch);rows.set(c.streamId,(rows.get(c.streamId)??0)+1);}}}
    if(target>this.engine.time)this.engine.advance(target-this.engine.time);
    this.nextRow=(steps+1)*.25;for(const c of this.configs){this.indices.set(c.streamId,c.res===undefined?steps:rows.get(c.streamId)??0);c.simT=target;this.emit(c);}this.rebuildPool();this.rebuildTactical();this.sendTactical();
  }
}
