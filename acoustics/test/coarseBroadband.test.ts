import {describe,it,expect,afterEach} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,resParams,setResRowPath,setCoarseBroadband} from '../src/index.js';
import {WorkerRuntime} from '../src/index.js';
import type {Command,GramRows,WorkerRequest,WorkerResponse} from '../src/protocol.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';
import {measureEdges} from './bandEdges.test.js';
/** PROTOTYPE coarse-grid smooth broadband (setCoarseBroadband, default OFF) vs the exact reference
 * row path. Tolerances (justified in docs/band-pickup.md "Coarse smooth-broadband prototype"):
 *  - expected-spectrum |ΔdB| max ≤0.02, mean ≤0.002 per band/FULLBAND (display quantum ≈0.1 dB,
 *    fast-path budget 0.01 dB; interpolation bound ≈h²|g''|/8g with h=1/48 oct ⇒ ≲1e-3 dB smooth
 *    part, the rest is null-floor sensitivity);
 *  - LM null bins identical, fringe spacing identical, null-to-peak contrast |Δ| ≤0.1 dB;
 *  - cavitation knee speed identical, knee level |Δ| ≤0.02 dB; spectral −3 dB knee within one bin;
 *  - seed-777 edges within one hop; determinism/seek/replay bit-identical with the flag on. */
afterEach(()=>{setResRowPath('fast');setCoarseBroadband(false);});
type Mode='reference'|'fast'|'coarse';
function setMode(m:Mode){setCoarseBroadband(m==='coarse');setResRowPath(m==='reference'?'reference':'fast');}
function mk(){const messages:WorkerResponse[]=[];const runtime=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));
 const send=(m:Command)=>runtime.command({...m,v:1,simT:runtime.simT} as WorkerRequest);send({type:'init',seed:42,scenarioId:'cpa-pass'});send({type:'setGram',streamId:1,res:2,filter:'NB'});
 const kept=new Map<number,Uint8Array>();
 const drain=()=>{for(const b of messages.splice(0))if(b.type==='gramRows'){const g=b as GramRows;kept.set(g.rowIndex[0]!,new Uint8Array(g.data.buffer.slice(0)));const bufs=[new Int32Array(g.streamIds).buffer,new Uint32Array(g.rowIndex).buffer,new Float32Array(g.data).buffer,new Float32Array(g.bearingDeg!).buffer] as ArrayBuffer[];send({type:'release',buffers:structuredClone(bufs,{transfer:bufs})} as Command);}};
 return {kept,play:(to:number)=>{while(runtime.simT<to-1e-9){runtime.tick(.25);drain();}},seek:(t:number)=>{runtime.command({v:1,type:'seek',simT:t} as WorkerRequest);drain();}};}
const db=(x:number)=>10*Math.log10(x);
function scen(nB:number,nC:number){const s=cpaScenario();s.fmax=2000;s.seed=4242;s.environment={...s.environment,seaState:3};
 s.contacts=Array.from({length:nC},(_,i)=>({id:'k'+i,category:'subsurface' as const,x:-1800+i*311,y:400+i*173,depth:50+7*i,course:Math.PI/2+i*.3,speed:3+i%4,motion:[{at:0,course:Math.PI/2+i*.3,speed:3+i%4,depth:50+7*i},{at:60,course:Math.PI/2+i*.3+.8,speed:5,depth:80}],
  params:{...fictionalSignature,levelDb:148+i,modulation:0,cavitationPower:.03*(i%3),tonals:[{family:'motor' as const,hz:35+13*i,power:1,width:'discrete' as const,stability:'stable' as const},{family:'motor' as const,hz:300+57*i,power:.5,width:'diffuse' as const,sigmaBins:3,stability:'stable' as const}]}}));
 s.buoys=Array.from({length:nB},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:i*700,y:i*300}));return s;}
function collect(m:Mode,s:any,fullRes:number|null,sec:number,bands=true){
 setMode(m);const e=new AcousticEngine(structuredClone(s),4242) as any,out=new Float32Array(4096),rows=new Map<string,Float64Array>(),disp=new Map<string,Float32Array>();
 const subs=[...(bands?e.scenario.buoys.flatMap((b:any)=>LOFAR_BAND_PRESETS.flatMap(p=>(['NB','BB'] as const).map(f=>({key:`${b.id}|${p.id}|${f}`,c:e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(p.id),filter:f,vernierHz:vernierHzForBand(p.id)})})))):[]),
  ...(fullRes?e.scenario.buoys.map((b:any)=>({key:`${b.id}|FULL`,c:e.subscribe({channel:b.rfChannel,kind:'lofar',res:fullRes,filter:'NB',fullAxis:true,visibleTileIndex:0})})):[])];
 for(let k=1;k<=sec*4;k++){e.advance(.25);for(const x of subs){const sub=e.subscriptions.get(x.c.streamId);while(e.rowsReady(x.c.streamId)>0){const tag=sub.fullAxis?`${sub.fullAxis.queue[0].rowKey}|${sub.fullAxis.queue[0].tileIndex}`:`${sub.read}`;e.writeRow(x.c.streamId,out);expect(sub.res.lastIntegrated).toBe(true);const k2=`${x.key}|${tag}`;rows.set(k2,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));disp.set(k2,out.slice(0,sub.res.liveBins));}}}
 return {rows,disp,fBin:(b:string)=>b};
}
function errStats(a:Map<string,Float64Array>,b:Map<string,Float64Array>){
 expect(b.size).toBe(a.size);const st=new Map<string,{max:number;sum:number;n:number}>();
 for(const [k,ra] of a){const rb=b.get(k)!;const band=k.split('|')[1]!,s=st.get(band)??{max:0,sum:0,n:0};for(let i=0;i<ra.length;i++){const d=Math.abs(db(rb[i]!/ra[i]!));s.max=Math.max(s.max,d);s.sum+=d;s.n++;}st.set(band,s);}
 return Object.fromEntries([...st].map(([k,v])=>[k,{maxDb:+v.max.toExponential(3),meanDb:+(v.sum/v.n).toExponential(3),bins:v.n}]));
}
describe('PROTOTYPE coarse smooth-broadband vs reference',()=>{
 for(const fullRes of [5,2])it(`per-band and FULLBAND RES${fullRes} expected-spectrum error`,()=>{
  const s=scen(2,3),ref=collect('reference',s,fullRes,48).rows,co=collect('coarse',s,fullRes,48).rows,r=errStats(ref,co);
  console.log(`COARSE-ERR RES${fullRes}:`,JSON.stringify(r));
  for(const [band,v] of Object.entries(r)){expect(v.bins,band).toBeGreaterThan(1000);expect(v.maxDb,band).toBeLessThanOrEqual(.02);expect(v.meanDb,band).toBeLessThanOrEqual(.002);}
 },300000);
 it('60 contacts FULLBAND RES5 error',()=>{const s=scen(2,60),r=errStats(collect('reference',s,5,12).rows,collect('coarse',s,5,12).rows);console.log('COARSE-ERR 60c:',JSON.stringify(r));for(const [band,v] of Object.entries(r))expect(v.maxDb,band).toBeLessThanOrEqual(.02);},300000);
 it('flag off: fast path unchanged (bit-identical to a fresh fast run)',()=>{const s=scen(1,2),a=collect('fast',s,5,16).rows;setCoarseBroadband(true);setCoarseBroadband(false);const b=collect('fast',s,5,16).rows;for(const [k,v] of a)expect(Array.from(b.get(k)!)).toEqual(Array.from(v));});
 // Lloyd's mirror: single stationary-ish source, quiet ambient, grid of range × source depth × receiver depth.
 function lmScen(range:number,zs:number,zr:number,speed=0.2,course=Math.PI/2,x0=-range,y0=0){const s=cpaScenario();s.fmax=2000;s.seed=11;s.environment={...s.environment,seaState:0,shipping:'light',shippingDensity:0};
  s.contacts=[{id:'lm',category:'subsurface' as const,x:x0,y:y0,depth:zs,course,speed,motion:[{at:0,course,speed,depth:zs}],params:{...fictionalSignature,levelDb:175,modulation:0,cavitationPower:.2,tonals:[{family:'motor' as const,hz:1990,power:1e-6,width:'discrete' as const,stability:'stable' as const}]}}];
  s.buoys=[{...s.buoys[0]!,depth:zr}];return s;}
 function nulls(p:Float64Array){const n:number[]=[],pk:number[]=[];for(let i=2;i<p.length-2;i++){if(p[i]!<p[i-1]!&&p[i]!<=p[i+1]!)n.push(i);if(p[i]!>p[i-1]!&&p[i]!>=p[i+1]!)pk.push(i);}return {n,pk};}
 /** Fringe nulls = local minima with ≥1 dB null-to-peak contrast (excludes sub-0.01 dB wiggles on flat fringe crests). */
 function prominent(p:Float64Array){const a=nulls(p),c=contrast(p,a.n,a.pk);return {n:a.n.filter((_,i)=>c[i]!>=1),pk:a.pk,all:a.n,c};}
 function contrast(p:Float64Array,n:number[],pk:number[]){return n.map(i=>{const r=pk.find(j=>j>i),l=[...pk].reverse().find(j=>j<i);const peak=Math.max(l!==undefined?p[l]!:0,r!==undefined?p[r]!:0);return db(peak/p[i]!);});}
 it("LM null positions, fringe spacing and null-to-peak contrast across range/depth grid (FULLBAND RES5 + LF/MF bands)",()=>{
  const out:any[]=[];let worstC=0,worstSp=0,nullsChecked=0,worstSpur=0;
  for(const range of [300,1000,3000,8000])for(const zs of [30,120])for(const zr of [20,90]){
   const s=lmScen(range,zs,zr),R=collect('reference',s,5,24).rows,C=collect('coarse',s,5,24).rows;
   for(const [k,pr] of R){const pc=C.get(k)!,a=prominent(pr),b=prominent(pc);
    for(let i=0;i<b.all.length;i++)if(!a.all.includes(b.all[i]!))worstSpur=Math.max(worstSpur,b.c[i]!);
    expect(b.n,`${range}/${zs}/${zr} ${k} null bins`).toEqual(a.n);
    const sp=(x:number[])=>x.length>1?(x.at(-1)!-x[0]!)/(x.length-1):NaN;if(a.n.length>1)worstSp=Math.max(worstSp,Math.abs(sp(b.n)-sp(a.n)));
    const ca=contrast(pr,a.n,a.pk),cb=contrast(pc,b.n,b.pk);for(let i=0;i<ca.length;i++){worstC=Math.max(worstC,Math.abs(cb[i]!-ca[i]!));nullsChecked++;}}
   out.push({range,zs,zr});}
  console.log('LM-GRID:',JSON.stringify({cases:out.length,nullsChecked,worstContrastDb:worstC,worstSpacingBins:worstSp,worstSpuriousMinimumDepthDb:worstSpur}));
  expect(nullsChecked).toBeGreaterThan(1000);expect(worstSp).toBe(0);expect(worstC).toBeLessThanOrEqual(.1);expect(worstSpur).toBeLessThan(.01);
 },600000);
 it('LM CPA turning point: per-row order-n null frequency apex row identical across a pass',()=>{
  // Straight pass: CPA 1200 m at t≈60 s, zs 60 m, zr 90 m (cf. lloydCpaApex.test.ts).
  const mk=()=>lmScen(1200,60,90,10,Math.PI/2,-600,1200),R=collect('reference',mk(),null,120).rows,C=collect('coarse',mk(),null,120).rows;
  const first=(m:Map<string,Float64Array>,band:string)=>[...m].filter(([k])=>k.includes(`|${band}|NB|`)).map(([,p])=>nulls(p).n);
  let rows=0;for(const band of ['LF','MF']){const a=first(R,band),b=first(C,band);expect(b).toEqual(a);rows+=a.length;
   const lowest=a.map(n=>n[0]??Infinity),apex=lowest.indexOf(Math.min(...lowest)),lowC=b.map(n=>n[0]??Infinity);expect(lowC.indexOf(Math.min(...lowC))).toBe(apex);}
  console.log('LM-CPA rows compared:',rows);expect(rows).toBeGreaterThan(20);
 },600000);
 it('cavitation-onset knee: level vs speed across depths, knee speed identical, level and spectral knee within tolerance',()=>{
  const res:any[]=[];let worstL=0,worstKneeBin=0;
  for(const depth of [20,80,200]){const lv:Record<Mode,number[]>={reference:[],coarse:[],fast:[]};const kneeBin:Record<string,number[]>={reference:[],coarse:[]};
   const speeds=[1,3,5,7,9,11,13,15];
   for(const m of ['reference','coarse'] as const)for(const v of speeds){const s=cpaScenario();s.fmax=2000;s.seed=5;s.environment={...s.environment,seaState:0,shippingDensity:0};
    s.contacts=[{id:'cv',category:'subsurface' as const,x:-3000,y:2000,depth,course:0,speed:v,motion:[{at:0,course:0,speed:v,depth}],params:{...fictionalSignature,modulation:0,cavitationPower:.5}}];
    const rows=[...collect(m,s,5,16,false).rows.values()],p=rows.at(-1)!;
    // Broadband level: median dB over the row (tonals are sparse).
    const d=Array.from(p,db).sort((a,b)=>a-b);lv[m].push(d[d.length>>1]!);
    // Spectral knee: first 1/6-oct-smoothed bin 3 dB below the 20–40 Hz plateau.
    const df=resParams(5).fBin,sm=(f:number)=>{const lo=Math.floor(f*2**(-1/12)/df),hi=Math.ceil(f*2**(1/12)/df);let s2=0;for(let i=lo;i<=hi;i++)s2+=p[i]!;return s2/(hi-lo+1);};
    const base=sm(30);let kb=-1;for(let i=Math.round(40/df);i<p.length-40;i++)if(db(sm(i*df))<db(base)-3){kb=i;break;}kneeBin[m]!.push(kb);}
   const knee=(l:number[])=>speeds[l.findIndex(x=>x>l[0]!+3)];
   for(let i=0;i<speeds.length;i++){worstL=Math.max(worstL,Math.abs(lv.coarse[i]!-lv.reference[i]!));worstKneeBin=Math.max(worstKneeBin,Math.abs(kneeBin.coarse![i]!-kneeBin.reference![i]!));}
   expect(knee(lv.coarse)).toBe(knee(lv.reference));res.push({depth,kneeSpeed:knee(lv.reference),kneeBins:kneeBin.reference});}
  console.log('CAV-KNEE:',JSON.stringify({res,worstLevelDb:worstL,worstSpectralKneeBins:worstKneeBin}));
  expect(worstL).toBeLessThanOrEqual(.02);expect(worstKneeBin).toBeLessThanOrEqual(1);
 },600000);
 for(const kind of ['swath','src'] as const)it(`seed-777 ${kind} edge 10/50/90% within one hop of reference`,()=>{
  setMode('reference');const ref=measureEdges(kind);setMode('coarse');const co=measureEdges(kind);const worst:Record<string,number>={};
  for(const b of Object.keys(ref)){const hop=resParams(resForBand(b as never)).hopS;let w=0;for(const ph of ['rise','fall'] as const)for(const q of ['t10','t50','t90'] as const){const d=Math.abs(co[b]![ph][q]-ref[b]![ph][q]);expect(Number.isFinite(d)).toBe(true);expect(d,`${b} ${ph} ${q}`).toBeLessThanOrEqual(hop);w=Math.max(w,d);}worst[b]=w;}
  console.log(`COARSE-EDGE (${kind}) max |Δ| s:`,JSON.stringify(worst));
 },600000);
 it('flag on: deterministic, seek and replay bit-identical',()=>{
  const s=scen(1,3),a=collect('coarse',s,2,40),b=collect('coarse',s,2,40);for(const [k,v] of a.disp)expect(Array.from(b.disp.get(k)!)).toEqual(Array.from(v));
  setMode('coarse');const A=mk();A.play(80);const first=new Map(A.kept);A.kept.clear();A.seek(20);A.play(80);const B=mk();B.seek(20);B.play(80);
  let n=0;for(const [k,r] of A.kept){const f=first.get(k),g=B.kept.get(k);if(!f||!g)continue;expect(Buffer.from(r).equals(Buffer.from(f)),`row ${k} vs first`).toBe(true);expect(Buffer.from(r).equals(Buffer.from(g)),`row ${k} vs fresh`).toBe(true);n++;}
  expect(n).toBeGreaterThanOrEqual(10);
 },600000);
});
