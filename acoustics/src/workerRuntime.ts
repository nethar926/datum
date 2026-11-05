import {AcousticEngine} from './engine.js';
import {cpaScenario} from './scenario.js';
import {isAlive} from './buoys.js';
import type {GramConfig,GramRows,Tactical,WorkerRequest,WorkerResponse} from './protocol.js';
type Frame={message:GramRows;transfer:ArrayBuffer[]};
/** M1 worker controller, independently testable without Worker/Node APIs. Fixed three-batch pool.
 * Commands/config changes may allocate; tick/writeRow allocate no sample/row arrays. */
export class WorkerRuntime {
  engine?:AcousticEngine;
  private seed=42;private rate=1;private nextId=1;private nextRow=.25;
  private readonly configs:GramConfig[]=[];
  private readonly indices=new Map<number,number>();
  private readonly groups=[{bins:1024,configs:[] as GramConfig[],pool:[] as Frame[]},{bins:512,configs:[] as GramConfig[],pool:[] as Frame[]}];
  private readonly scratch=new Float32Array(1024);
  private timer:ReturnType<typeof setInterval>|undefined;
  private readonly bearingStore=Array.from({length:128*8},()=>({buoyId:0,freqHz:0,brgDeg:0,quality:0}));
  private readonly tactical:Tactical={v:1,type:'tactical',simT:0,aircraft:{x:0,y:0,altM:300,hdgDeg:0,gsMps:0},buoys:[],bearings:[]};
  constructor(private readonly emit:(message:WorkerResponse,transfer?:ArrayBuffer[])=>void){}
  get simT():number{return this.engine?.time??0;}
  dispose():void{if(this.timer!==undefined){clearInterval(this.timer);this.timer=undefined;}}
  command(m:WorkerRequest):void{try{
    if(m.v!==1||!Number.isFinite(m.simT))throw new Error('Expected v1 and finite simT');
    if(m.type==='init'){
      if(m.scenarioId!=='cpa-pass'&&m.scenarioId!=='m1-cpa-pass')throw new Error('Unknown scenarioId; M1 supports cpa-pass');
      const s=cpaScenario();s.seed=m.seed;const engine=new AcousticEngine(s);this.dispose();this.engine=engine;this.seed=m.seed;this.rate=1;this.nextId=1;this.nextRow=.25;this.configs.length=0;this.indices.clear();
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
        const band=m.band??[0,500],existing=this.configs.find(c=>c.channel===m.channel&&c.kind==='lofar'&&c.f0===band[0]&&Math.abs(c.f0+c.fBin*(c.bins-1)-band[1])<1e-8);
        if(existing)this.emit({...existing,simT:e.time});else{const config=e.subscribe({channel:m.channel,kind:'lofar',bins:m.bins,band});this.configs.push(config);this.indices.set(config.streamId,0);this.emit(config);this.rebuildPool();}break;
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
  private frame(ids:Int32Array,indices:Uint32Array,data:Float32Array):Frame{return {message:{v:1,type:'gramRows',simT:this.simT,streamIds:ids,rowIndex:indices,data},transfer:[ids.buffer as ArrayBuffer,indices.buffer as ArrayBuffer,data.buffer as ArrayBuffer]};}
  private rebuildPool():void{
    for(const g of this.groups){g.pool.length=0;g.configs.length=0;for(const c of this.configs)if(c.bins===g.bins)g.configs.push(c);const n=g.configs.length;if(n)for(let i=0;i<3;i++)g.pool.push(this.frame(new Int32Array(n),new Uint32Array(n),new Float32Array(n*g.bins)));}
  }
  private release(buffers:ArrayBuffer[]):void{
    if(buffers.length%3!==0)throw new Error('Release complete batches: ids, rowIndex, data');
    for(let i=0;i<buffers.length;i+=3){const a=buffers[i],b=buffers[i+1],c=buffers[i+2];
      if(!(a instanceof ArrayBuffer)||!(b instanceof ArrayBuffer)||!(c instanceof ArrayBuffer))throw new Error('Invalid release buffer');
      const n=a.byteLength/4;if(!n||b.byteLength!==a.byteLength)continue;
      const bins=c.byteLength/(n*4),g=this.groups.find(g=>g.bins===bins);if(!g||g.configs.length!==n||g.pool.length>=3)continue;
      g.pool.push(this.frame(new Int32Array(a),new Uint32Array(b),new Float32Array(c)));
    }
  }
  /** Exactly one incremental row per subscribed stream. Pool starvation drops rows but keeps sim time. */
  tick(dt:number):void{try{
    const e=this.engine;if(!e)throw new Error('Initialize first');
    if(!Number.isFinite(dt)||dt<0||dt>1e6||e.time+dt>1e9)throw new Error('Invalid tick dt');
    const target=e.time+dt;
    while(this.nextRow<=target){e.advance(this.nextRow-e.time);this.nextRow+=.25;
      for(const c of this.configs)this.indices.set(c.streamId,(this.indices.get(c.streamId)??0)+1);
      for(const g of this.groups){if(!g.configs.length)continue;const frame=g.pool.pop();
        if(frame){const m=frame.message;m.simT=e.time;for(let i=0;i<g.configs.length;i++){const c=g.configs[i];m.streamIds[i]=c.streamId;m.rowIndex[i]=this.indices.get(c.streamId)!-1;e.writeRow(c.streamId,m.data,i*g.bins);}this.emit(m,frame.transfer);}
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
    }t.bearings.length=count;this.emit(t);
  }
  private seek(target:number):void{
    if(this.configs.some(c=>c.kind==='demon'||c.f0!==0||Math.abs(c.fBin*(c.bins-1)-500)>1e-8))throw new Error('Seek with DEMON awaits analysis-window replay');
    if(target<0||target>3600)throw new Error('M1 seek range is 0..3600 seconds');
    if(this.engine!.scenario.buoys.length!==1)throw new Error('Seek after drops awaits scenario event log');
    // Replay the seeded row schedule, preserving fluctuations exactly at 4 rows/s.
    this.dispose();const s=cpaScenario();s.seed=this.seed;this.engine=new AcousticEngine(s);for(const c of this.configs)this.engine.registerStream(c.streamId,c.channel);
    const scratch=new Float32Array(1024);const steps=Math.floor(target*4);for(let i=0;i<steps;i++){this.engine.advance(.25);for(const c of this.configs)this.engine.writeRow(c.streamId,scratch);}
    if(target>this.engine.time)this.engine.advance(target-this.engine.time);
    this.nextRow=(steps+1)*.25;for(const c of this.configs){this.indices.set(c.streamId,steps);c.simT=target;this.emit(c);}this.rebuildPool();this.rebuildTactical();this.sendTactical();
  }
}
