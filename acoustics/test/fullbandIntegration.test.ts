import {describe,it,expect} from 'vitest';
import {resRowPath} from '../src/resGram.js';
import {AcousticEngine,WorkerRuntime,cpaScenario,fictionalSignature,resParams,RES_FRAME_S,ResLofarGenerator,HISTORY_FRAMES} from '../src/index.js';
import {SCENARIO_CUTS,renderCut,SIM_STREAM_SET} from '../src/cuts/index.js';
import {measureEdges} from './bandEdges.test.js';
import type {ResLevel,Command,GramRows,WorkerRequest,WorkerResponse} from '../src/protocol.js';

/** FULLBAND tiles use the same span integration (time-averaged modelled power spectra, Hann²/Welch
 * weights — not a waveform FFT) as vernier band streams. */
function scen(){const s=cpaScenario();s.fmax=2000;s.seed=91;
 s.contacts=[{id:'m',category:'subsurface',x:-1500,y:600,depth:60,course:Math.PI/2,speed:4,motion:[{at:0,course:Math.PI/2,speed:4,depth:60},{at:20,course:0,speed:6,depth:60}],
  params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,tonals:[{family:'motor',hz:40,power:1,width:'discrete',stability:'stable'},{family:'motor',hz:180,power:.5,width:'discrete',stability:'stable'}]}}];return s;}
describe('FULLBAND integration parity',()=>{
 it('noise-free tile spectrum equals the vernier band-stream spectrum on overlapping bins at the same RES',()=>{
  const worst:Record<number,number>={};
  for(const res of [2,4,5,7] as ResLevel[]){
   const e=new AcousticEngine(scen(),91) as any;const df=resParams(res).fBin,vHz=512*df;
   const v=e.subscribe({channel:1,kind:'lofar',res,filter:'NB',vernierHz:vHz}),f=e.subscribe({channel:1,kind:'lofar',res,filter:'NB',fullAxis:true,visibleTileIndex:0});
   const vs=e.subscriptions.get(v.streamId),fs=e.subscriptions.get(f.streamId),out=new Float32Array(4096),vRows=new Map<number,{f0:number;x:Float64Array}>();let max=0,n=0;
   for(let t=0;t<60;t+=RES_FRAME_S){e.advance(RES_FRAME_S);
    while(e.rowsReady(v.streamId)>0){const k=vs.read;e.writeRow(v.streamId,out);vRows.set(k,{f0:vs.res.f0,x:Float64Array.from(vs.res.expected.subarray(0,vs.res.liveBins))});expect(vs.res.lastIntegrated).toBe(true);}
    while(e.rowsReady(f.streamId)>0){const job=fs.fullAxis.queue[0];e.writeRow(f.streamId,out);expect(fs.res.lastIntegrated).toBe(true);const vr=vRows.get(job.rowKey);if(!vr)continue;
     const g=fs.res;for(let i=0;i<vr.x.length;i++){const j=Math.round((vr.f0+i*df-g.f0)/df);if(j<0||j>=g.liveBins)continue;const a=vr.x[i],b=g.expected[j];max=Math.max(max,Math.abs(a-b)/Math.max(a,b));n++;}}}
   expect(n).toBeGreaterThan(1000);expect(max).toBeLessThan(resRowPath()==="reference"?1e-9:1e-5);worst[res]=max;
  }
  console.log('parity worst rel',JSON.stringify(worst));
 },60000);
 for(const kind of ['swath','src'] as const)it(`${kind} edges: FULLBAND (static and panned) match the band stream at equal RES`,()=>{
  const band=measureEdges(kind),full=measureEdges(kind,{fullAxis:true}),pan=measureEdges(kind,{fullAxis:true,pan:true});
  for(const b of Object.keys(band))for(const dir of ['rise','fall'] as const)for(const q of ['t10','t50','t90'] as const){
   expect(Math.abs(full[b]![dir][q]-band[b]![dir][q]),`${b} ${dir} ${q} full`).toBeLessThan(1e-6);
   expect(Math.abs(pan[b]![dir][q]-band[b]![dir][q]),`${b} ${dir} ${q} pan`).toBeLessThan(1e-6);}
 },120000);
});
describe('snapshot fallback is explicit and unused by cut/live paths',()=>{
 it('direct generate()/renderTile without history marks integrated:false',()=>{
  const s=scen(),g=new ResLofarGenerator(s.buoys[0]!,s.contacts,2000,1,s.environment,{res:5});g.generate();expect(g.lastIntegrated).toBe(false);expect(g.snapshotFallbacks).toBe(1);
 });
 it('every cut stream and worker live/FULLBAND stream integrates (0 fallbacks)',()=>{
  for(const cut of SCENARIO_CUTS.slice(0,4)){const c=renderCut(cut),e=c.engine as any;const ids=SIM_STREAM_SET.map(id=>c.openStream(id)).filter((x):x is number=>x!==null);
   const buf=new Float32Array(4096);for(let r=0;r<60;r++){if(c.writeLofarRow(buf)<0)break;for(const id of ids)while(e.rowsReady(id)>0)e.writeRow(id,buf);}
   for(const id of ids){const r=e.subscriptions.get(id)?.res;if(r)expect(r.snapshotFallbacks,`${cut.id} ${id}`).toBe(0);}c.dispose();}
  const messages:WorkerResponse[]=[];const rt=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));const send=(m:Command)=>rt.command({...m,v:1,simT:rt.simT} as WorkerRequest);
  send({type:'init',seed:42,scenarioId:'cpa-pass'});send({type:'setGram',streamId:1,res:2,filter:'NB'});for(let i=0;i<200;i++)rt.tick(.25);
  const e=(rt as any).engine;for(const s of e.subscriptions.values())if(s.res)expect(s.res.snapshotFallbacks).toBe(0);
 });
});
describe('startup, seek/replay, bounded history',()=>{
 it('first rows after startup are full-span (history pre-filled with the t0 state), deterministic',()=>{
  const a=new AcousticEngine(scen(),91) as any,b=new AcousticEngine(scen(),91) as any;
  const ca=a.subscribe({channel:1,kind:'lofar',res:2,filter:'NB',vernierHz:32}),cb=b.subscribe({channel:1,kind:'lofar',res:2,filter:'NB',vernierHz:32});
  const oa=new Float32Array(1024),ob=new Float32Array(1024);for(let t=0;t<8;t+=.25){a.advance(.25);b.advance(.25);while(a.rowsReady(ca.streamId)>0){a.writeRow(ca.streamId,oa);b.writeRow(cb.streamId,ob);expect(a.subscriptions.get(ca.streamId).res.lastIntegrated).toBe(true);expect(Buffer.from(oa.buffer).equals(Buffer.from(ob.buffer))).toBe(true);}}
 });
 it('seek replays continuous play: bit-identical on the 0.25 s frame grid; off-grid targets differ only by float rounding of the split kinematic step (RES2, span 16 s)',()=>{
  const mk=()=>{const messages:WorkerResponse[]=[];const runtime=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})),()=>cpaScenario());const send=(m:Command)=>runtime.command({...m,v:1,simT:runtime.simT} as WorkerRequest);send({type:'init',seed:42,scenarioId:'cpa-pass'});send({type:'setGram',streamId:1,res:2,filter:'NB'});const rel=()=>{for(const b of messages.splice(0))if(b.type==='gramRows'){const g=b as GramRows;kept.push(g);const buffers=[new Int32Array(g.streamIds).buffer,new Uint32Array(g.rowIndex).buffer,new Float32Array(g.data).buffer,new Float32Array(g.bearingDeg!).buffer] as ArrayBuffer[];send({type:'release',buffers:structuredClone(buffers,{transfer:buffers})} as Command);}};const kept:GramRows[]=[];return {runtime,messages:kept,send,tick:(dt:number)=>{runtime.tick(dt);rel();},seek:(t:number)=>{runtime.command({v:1,type:'seek',simT:t} as WorkerRequest);rel();kept.length=0;}};};
  const rows=(m:WorkerResponse[])=>{const out=new Map<number,Float32Array>();for(const x of m)if(x.type==='gramRows')out.set((x as GramRows).rowIndex[0]!,(x as GramRows).data);return out;};
  const x=mk();for(let i=0;i<240;i++)x.tick(.25);const want=rows(x.messages);
  let worstOff=0;for(const target of [30,17.5,17.6]){const y=mk();y.seek(target);while(y.runtime.simT<60-1e-9)y.tick(.25);const got=rows(y.messages);
   let common=0;for(const [k,d] of got){const w=want.get(k);if(!w)continue;common++;if(target%RES_FRAME_S===0)expect(Buffer.from(d.buffer).equals(Buffer.from(w.buffer)),`row ${k} @seek ${target}`).toBe(true);else{let m=0;for(let i=0;i<d.length;i++)if(Number.isFinite(w[i]!))m=Math.max(m,Math.abs(d[i]!-w[i]!));worstOff=Math.max(worstOff,m);expect(m,`row ${k} @seek ${target} dB`).toBeLessThan(1e-3);}}expect(common).toBeGreaterThanOrEqual(3);}console.log('offgrid worst dB',worstOff);
 });
 it('paused scroll-back: already-emitted rows are FE-owned copies, untouched by later engine history',()=>{
  const messages:WorkerResponse[]=[];const rt=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));rt.command({v:1,simT:0,type:'init',seed:42,scenarioId:'cpa-pass'} as WorkerRequest);rt.command({v:1,simT:0,type:'setGram',streamId:1,res:2,filter:'NB'} as WorkerRequest);
  for(let i=0;i<40;i++)rt.tick(.25);const snap=messages.filter(m=>m.type==='gramRows').map(m=>Float32Array.from((m as GramRows).data));const before=messages.filter(m=>m.type==='gramRows') as GramRows[];
  for(let i=0;i<40;i++)rt.tick(.25);before.forEach((m,i)=>expect(Buffer.from(m.data.buffer).equals(Buffer.from(snap[i]!.buffer))).toBe(true));
 });
 it('history is bounded: one engine-wide state ring of HISTORY_FRAMES frames, independent of run length',()=>{
  const e=new AcousticEngine(scen(),91) as any;e.subscribe({channel:1,kind:'lofar',res:2,filter:'NB',vernierHz:32});e.subscribe({channel:1,kind:'lofar',res:5,filter:'NB',fullAxis:true});
  const b0=e.retainedBytes().total;for(let i=0;i<2000;i++)e.advance(.25);expect(e.history.frames).toBe(HISTORY_FRAMES);expect(e.retainedBytes().total).toBe(b0);
 });

});
