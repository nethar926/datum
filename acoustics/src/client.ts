import type {Command,GramRows,WorkerRequest,WorkerResponse} from './protocol.js';
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
  release(batch:GramRows):void{const buffers=[batch.streamIds.buffer,batch.rowIndex.buffer,batch.data.buffer] as ArrayBuffer[];if(batch.bearingDeg)buffers.push(batch.bearingDeg.buffer as ArrayBuffer);this.command({type:'release',buffers},buffers);}
  dispose():void{this.worker.terminate();}
}
