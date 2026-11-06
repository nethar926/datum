import type {Command,GramRows,WorkerRequest,WorkerResponse,ResLevel,GramFilter,LofarBandPresetId} from './protocol.js';
/** Pass a Vite-created worker when importing TS sources. Default URL targets built ESM dist/. */
export class AcousticClient {
  simT=0;
  constructor(readonly worker:Worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),onMessage:(message:WorkerResponse)=>void=()=>{}){
    worker.onmessage=(event:MessageEvent<WorkerResponse>)=>{this.simT=event.data.simT;onMessage(event.data);};
  }
  command(command:Command,transfer:Transferable[]=[]):void {const m:WorkerRequest={...command,v:1,simT:this.simT};this.worker.postMessage(m,transfer);}
  init(seed=42,scenarioId='cpa-pass'):void{this.command({type:'init',seed,scenarioId});}
  play():void{this.command({type:'play'});}
  pause():void{this.command({type:'pause'});}
  seek(simT:number):void{this.simT=simT;this.command({type:'seek'});}
  /** LOFAR subscribe; pass res/filter/vernierHz for a RES 1–9 gram (defaults res 5, NB, full band).
   * Legacy path: optional band [f0,fMax] or bandPreset ('ELF'|'VLF'|'LF'|'MF'); explicit band wins. */
  subscribe(channel:number,opts:{res?:ResLevel;filter?:GramFilter;vernierHz?:number;band?:[number,number];bandPreset?:LofarBandPresetId}={}):void{this.command({type:'subscribe',kind:'lofar',channel,...opts});}
  /** Change RES/filter/vernier on an existing LOFAR stream; the worker re-emits gramConfig. vernierHz:null → full band. */
  setGram(streamId:number,opts:{res?:ResLevel;filter?:GramFilter;vernierHz?:number|null}):void{this.command({type:'setGram',streamId,...opts});}
  /** Per-stream catch-up: advance one LOFAR/DEMON subscription's row cursor to now (no intermediate rows). */
  skipToLatest(streamId:number):void{this.command({type:'skipToLatest',streamId});}
  release(batch:GramRows):void{const buffers=[batch.streamIds.buffer,batch.rowIndex.buffer,batch.data.buffer] as ArrayBuffer[];if(batch.bearingDeg)buffers.push(batch.bearingDeg.buffer as ArrayBuffer);this.command({type:'release',buffers},buffers);}
  dispose():void{this.worker.terminate();}
}
