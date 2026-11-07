import {describe,it,expect} from 'vitest';
import {WorkerRuntime,AcousticEngine,cpaScenario} from '../src/index.js';
import type {Command,GramRows,WorkerRequest,WorkerResponse} from '../src/protocol.js';

function mk(){const messages:WorkerResponse[]=[];const runtime=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));
 const send=(m:Command)=>runtime.command({...m,v:1,simT:runtime.simT} as WorkerRequest);send({type:'init',seed:42,scenarioId:'cpa-pass'});send({type:'setGram',streamId:1,res:2,filter:'NB'});
 const kept=new Map<number,Uint8Array>();
 const drain=()=>{for(const b of messages.splice(0))if(b.type==='gramRows'){const g=b as GramRows;kept.set(g.rowIndex[0]!,new Uint8Array(g.data.buffer.slice(0)));const bufs=[new Int32Array(g.streamIds).buffer,new Uint32Array(g.rowIndex).buffer,new Float32Array(g.data).buffer,new Float32Array(g.bearingDeg!).buffer] as ArrayBuffer[];send({type:'release',buffers:structuredClone(bufs,{transfer:bufs})} as Command);}};
 return {runtime,kept,drain,play:(to:number)=>{while(runtime.simT<to-1e-9){runtime.tick(.25);drain();}},seek:(t:number)=>{runtime.command({v:1,type:'seek',simT:t} as WorkerRequest);drain();}};}
const eq=(a:Uint8Array,b:Uint8Array)=>Buffer.from(a).equals(Buffer.from(b));
describe('replay consistency',()=>{
 it('play → seek back → replay equals the first pass and a fresh run seeked to the same time (RES2, span 16 s)',()=>{
  const A=mk();A.play(80);const first=new Map(A.kept);A.kept.clear();A.seek(20);A.play(80);const replay=A.kept;
  const B=mk();B.seek(20);B.play(80);const fresh=B.kept;
  let n=0;for(const [k,r] of replay){const f=first.get(k),g=fresh.get(k);if(!f||!g)continue;expect(eq(r,f),`row ${k} vs first`).toBe(true);expect(eq(r,g),`row ${k} vs fresh`).toBe(true);n++;}
  expect(n).toBeGreaterThanOrEqual(10);
 },120000);
 it('every buoy collects full history regardless of which FULLBAND pane is visible',()=>{
  const run=(visible:(i:number,t:number)=>number)=>{const s=cpaScenario();s.fmax=2000;s.buoys=Array.from({length:4},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:i*500,y:0}));
   const e=new AcousticEngine(s,7) as any,out=new Float32Array(4096),rows=new Map<string,Uint8Array>();
   const cs=e.scenario.buoys.map((b:any)=>e.subscribe({channel:b.rfChannel,kind:'lofar',res:2,filter:'NB',fullAxis:true,visibleTileIndex:0}));
   for(let k=1;k<=240;k++){const t=k*.25;e.advance(.25);for(const [i,c] of cs.entries()){const v=visible(i,t)%c.tileCount,tb=c.tileBins,df=c.fBin;e.setViewWindow(c.streamId,{fLo:v*tb*df+1,fHi:v*tb*df+tb*df/2});}
    for(const c of cs){const sub=e.subscriptions.get(c.streamId);while(e.rowsReady(c.streamId)>0){const j=sub.fullAxis.queue[0];e.writeRow(c.streamId,out);expect(e.lastFullAxisTile(c.streamId).filled).toBe(true);rows.set(`${c.channel}:${j.tileIndex}:${j.rowKey}`,new Uint8Array(out.buffer.slice(0)));}}}
   expect(e.history.count).toBe(e.history.frames);return rows;};
  const a=run(()=>0),b=run((i,t)=>Math.floor(t/3)+i*3);
  expect(a.size).toBe(b.size);for(const [k,r] of a)expect(eq(r,b.get(k)!),k).toBe(true);
 },120000);
});
