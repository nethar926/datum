import {AcousticEngine} from './engine.js';
import {cpaScenario,lloydsCpaScenario} from './scenario.js';
import {isAlive} from './buoys.js';
import type {GramConfig,GramRows,Tactical,WorkerRequest,WorkerResponse} from './protocol.js';
type Frame={message:GramRows;transfer:ArrayBuffer[]};
/** Row period: legacy grams 0.25 s; RES grams P=1/rowRateHz (exact: 8, 4 or 2 s). */
const periodOf=(c:GramConfig):number=>c.res===undefined?.25:1/c.rowRateHz;
const due=(period:number,t:number):boolean=>period===.25||Math.abs(t/period-Math.round(t/period))<1e-9;
/** M1 worker controller, independently testable without Worker/Node APIs. Fixed three-batch pool.
 * Commands/config changes may allocate; tick/writeRow allocate no sample/row arrays. */
export class WorkerRuntime {
  engine?:AcousticEngine;
  private seed=42;private rate=1;private nextId=1;private nextRow=.25;
  private readonly configs:GramConfig[]=[];
  private readonly indices=new Map<number,number>();
  /** Packed batch groups: legacy 4 Hz LOFAR/DEMON by bin count, then RES 1024-bin grams by row
   * period P (8/4/2 s). Every stream in a group is due on the same 0.25 s tick (rows at multiples of P). */
  private readonly groups=[{bins:1024,period:.25},{bins:512,period:.25},{bins:4096,period:.25},{bins:1024,period:8},{bins:1024,period:4},{bins:1024,period:2}].map(g=>({...g,configs:[] as GramConfig[],pool:[] as Frame[]}));
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
        if(m.res!==undefined||m.filter!==undefined||m.vernierHz!==undefined){
          const config=e.subscribe({channel:m.channel,kind:'lofar',bins:m.bins,band:m.band,res:m.res,filter:m.filter,vernierHz:m.vernierHz});
          const existing=this.configs.find(c=>c.channel===config.channel&&c.res===config.res&&c.filter===config.filter&&c.f0===config.f0&&c.fcHz===config.fcHz);
          if(existing){e.unsubscribe(config.streamId);this.emit({...existing,simT:e.time});}else{this.configs.push(config);this.indices.set(config.streamId,0);this.emit(config);this.rebuildPool();}break;
        }
        const band=m.band??e.scenario.band??[0,e.scenario.fMax??e.scenario.fmax],existing=this.configs.find(c=>c.res===undefined&&c.channel===m.channel&&c.kind==='lofar'&&c.f0===band[0]&&Math.abs(c.f0+c.fBin*(c.bins-1)-band[1])<1e-8);
        if(existing)this.emit({...existing,simT:e.time});else{const config=e.subscribe({channel:m.channel,kind:'lofar',bins:m.bins,band});this.configs.push(config);this.indices.set(config.streamId,0);this.emit(config);this.rebuildPool();}break;
      }
      case 'setGram':{
        const i=this.configs.findIndex(c=>c.streamId===m.streamId);if(i<0)throw new Error('Unknown streamId');if(this.configs[i].kind!=='lofar')throw new Error('setGram applies to LOFAR streams only');
        const config=e.setGram(m.streamId,{res:m.res,filter:m.filter,vernierHz:m.vernierHz});this.configs[i]=config;this.emit(config);this.rebuildPool();break;
      }
      case 'unsubscribe':{const i=this.configs.findIndex(c=>c.streamId===m.streamId);if(i>=0){this.configs.splice(i,1);this.indices.delete(m.streamId);e.unsubscribe(m.streamId);this.rebuildPool();}break;}
      case 'release':this.release(m.buffers);break;
      default:throw new Error('Unknown command');
    }
  }catch(error){this.error(error);}}
  private error(error:unknown):void{this.emit({v:1,type:'error',simT:this.simT,message:error instanceof Error?error.message:'Worker error'});}
  private subscribe(channel:number):void{
    const e=this.engine!;while(this.configs.some(c=>c.streamId===this.nextId))this.nextId++;const id=this.nextId++;e.registerStream(id,channel);const config:GramConfig={v:1,type:'gramConfig',simT:e.time,streamId:id,kind:'lofar',channel,bins:e.scenario.bins,f0:0,fBin:e.scenario.fmax/(e.scenario.bins-1),rowRateHz:4,dbFloor:40,dbCeil:110};
    this.configs.push(config);this.indices.set(id,0);this.emit(config);
  }
  private frame(ids:Int32Array,indices:Uint32Array,data:Float32Array,bearingDeg:Float32Array):Frame{return {message:{v:1,type:'gramRows',simT:this.simT,streamIds:ids,rowIndex:indices,data,bearingDeg},transfer:[ids.buffer as ArrayBuffer,indices.buffer as ArrayBuffer,data.buffer as ArrayBuffer,bearingDeg.buffer as ArrayBuffer]};}
  private rebuildPool():void{
    for(const g of this.groups){g.pool.length=0;g.configs.length=0;for(const c of this.configs)if(c.bins===g.bins&&periodOf(c)===g.period)g.configs.push(c);const n=g.configs.length;if(n)for(let i=0;i<3;i++)g.pool.push(this.frame(new Int32Array(n),new Uint32Array(n),new Float32Array(n*g.bins),new Float32Array(n*g.bins)));}
  }
  private release(buffers:ArrayBuffer[]):void{
    if(buffers.length%4!==0)throw new Error('Release complete batches: ids, rowIndex, data, bearingDeg');
    for(let i=0;i<buffers.length;i+=4){const a=buffers[i],b=buffers[i+1],c=buffers[i+2],d=buffers[i+3];
      if(!(a instanceof ArrayBuffer)||!(b instanceof ArrayBuffer)||!(c instanceof ArrayBuffer)||!(d instanceof ArrayBuffer))throw new Error('Invalid release buffer');
      const n=a.byteLength/4;if(!n||b.byteLength!==a.byteLength||d.byteLength!==c.byteLength)continue;
      const bins=c.byteLength/(n*4),g=this.groups.find(g=>g.bins===bins&&g.configs.length===n&&g.pool.length<3);if(!g)continue;
      g.pool.push(this.frame(new Int32Array(a),new Uint32Array(b),new Float32Array(c),new Float32Array(d)));
    }
  }
  /** Exactly one incremental row per subscribed stream. Pool starvation drops rows but keeps sim time. */
  tick(dt:number):void{try{
    const e=this.engine;if(!e)throw new Error('Initialize first');
    if(!Number.isFinite(dt)||dt<0||dt>1e6||e.time+dt>1e9)throw new Error('Invalid tick dt');
    const target=e.time+dt;
    while(this.nextRow<=target){const t=this.nextRow;e.advance(t-e.time);this.nextRow+=.25;
      for(const c of this.configs)if(due(periodOf(c),t))this.indices.set(c.streamId,(this.indices.get(c.streamId)??0)+1);
      for(const g of this.groups){if(!g.configs.length||!due(g.period,t))continue;const frame=g.pool.pop();
        if(frame){const m=frame.message;m.simT=e.time;for(let i=0;i<g.configs.length;i++){const c=g.configs[i];m.streamIds[i]=c.streamId;m.rowIndex[i]=this.indices.get(c.streamId)!-1;e.writeRow(c.streamId,m.data,i*g.bins);e.writeBearingRow(c.streamId,m.bearingDeg!,i*g.bins);}this.emit(m,frame.transfer);}
        else for(const c of g.configs)e.writeRow(c.streamId,this.scratch);
      }
    }
    e.advance(target-e.time);
    this.sendTactical();
  }catch(error){this.error(error);}}
  private rebuildTactical():void{const e=this.engine!;this.tactical.buoys=e.scenario.buoys.map((b,i)=>({id:Number(b.id.replace(/\D/g,''))||i+1,channel:b.rfChannel,kind:b.type==='difar'?'difar':'omni',x:b.x,y:b.y,hydrophoneDepthM:b.depth,batteryFrac:1,lifeRemainingS:b.life,state:'live'}));}
  private sendTactical():void{
    const e=this.engine!,s=e.scenario,t=this.tactical;t.simT=e.time;t.aircraft.x=s.ownship.x;t.aircraft.y=s.ownship.y;t.aircraft.hdgDeg=(s.ownship.course*180/Math.PI+360)%360;t.aircraft.gsMps=s.ownship.speed;
    let count=0;for(let i=0;i<s.buoys.length;i++){const b=s.buoys[i],out=t.buoys[i];out.x=b.x;out.y=b.y;out.hydrophoneDepthM=b.depth;out.lifeRemainingS=Math.max(0,b.deployedAt+b.life-e.time);out.batteryFrac=Math.max(0,Math.min(1,out.lifeRemainingS/b.life));out.state=e.time<b.deployedAt?'falling':isAlive(b,e.time)?'live':'dead';
      if(b.type==='difar'&&isAlive(b,e.time)){const g=e.generators[i];for(let j=0;j<g.lineCount;j++){const src=g.lines[j],dst=this.bearingStore[count];dst.buoyId=out.id;dst.freqHz=src.freqHz;dst.brgDeg=src.brgDeg;dst.quality=src.quality;t.bearings[count++]=dst;}}
    }t.bearings.length=count;t.truth=e.tactical().truth;this.emit(t);
  }
  private seek(target:number):void{
    if(this.configs.some(c=>c.kind==='demon'||(c.res===undefined&&(c.f0!==0||Math.abs(c.fBin*(c.bins-1)-500)>1e-8))))throw new Error('Seek with DEMON awaits analysis-window replay');
    if(target<0||target>3600)throw new Error('M1 seek range is 0..3600 seconds');
    if(this.engine!.scenario.buoys.length!==1)throw new Error('Seek after drops awaits scenario event log');
    // Replay the seeded row schedule, preserving fluctuations exactly at 4 rows/s.
    // RES streams replay as if their gram settings were applied at t=0 (rows on the P grid).
    this.dispose();const s=cpaScenario();s.seed=this.seed;this.engine=new AcousticEngine(s);
    for(let k=0;k<this.configs.length;k++){const c=this.configs[k];this.engine.registerStream(c.streamId,c.channel);if(c.res!==undefined)this.configs[k]=this.engine.setGram(c.streamId,{res:c.res,filter:c.filter,vernierHz:c.fcHz});}
    const scratch=new Float32Array(1024);const steps=Math.floor(target*4);for(let i=0;i<steps;i++){this.engine.advance(.25);const t=(i+1)*.25;for(const c of this.configs)if(due(periodOf(c),t))this.engine.writeRow(c.streamId,scratch);}
    if(target>this.engine.time)this.engine.advance(target-this.engine.time);
    this.nextRow=(steps+1)*.25;for(const c of this.configs){const p=periodOf(c);this.indices.set(c.streamId,Math.floor(steps*.25/p+1e-9));c.simT=target;this.emit(c);}this.rebuildPool();this.rebuildTactical();this.sendTactical();
  }
}
