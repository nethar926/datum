import {describe,it,expect,afterEach} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,resParams,setResRowPath,accumCount} from '../src/index.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';
import {measureEdges} from './bandEdges.test.js';

/** Fast RES row path vs the exact reference path (resGram.ts setResRowPath). The fast path changes
 * only the floating-point evaluation (summation order, Float32 sliding sums, chunked exp
 * recurrence); the model, weights and frames are the same, so the noise-free expected spectrum must
 * agree to ≤0.01 dB everywhere and edge timings must agree to within one hop. */
afterEach(()=>setResRowPath('fast'));
function scen(nB:number,nC:number){const s=cpaScenario();s.fmax=2000;s.seed=4242;s.environment={...s.environment,seaState:3};
 s.contacts=Array.from({length:nC},(_,i)=>({id:'k'+i,category:'subsurface' as const,x:-1800+i*311,y:400+i*173,depth:50+7*i,course:Math.PI/2+i*.3,speed:3+i%4,motion:[{at:0,course:Math.PI/2+i*.3,speed:3+i%4,depth:50+7*i},{at:60,course:Math.PI/2+i*.3+.8,speed:5,depth:80}],
  params:{...fictionalSignature,levelDb:148+i,modulation:0,cavitationPower:.03*(i%3),tonals:[{family:'motor' as const,hz:35+13*i,power:1,width:'discrete' as const,stability:'stable' as const},{family:'motor' as const,hz:300+57*i,power:.5,width:'diffuse' as const,sigmaBins:3,stability:'stable' as const}]}}));
 s.buoys=Array.from({length:nB},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:i*700,y:i*300}));return s;}
/** Expected (noise-free) spectrum of every emitted row, keyed stream|row(|tile). */
function collect(path:'fast'|'reference',fullRes:number,sec:number,nC=3){
 setResRowPath(path);const e=new AcousticEngine(scen(2,nC),4242) as any,out=new Float32Array(4096),rows=new Map<string,Float64Array>();
 const subs=[...e.scenario.buoys.flatMap((b:any)=>LOFAR_BAND_PRESETS.flatMap(p=>(['NB','BB'] as const).map(f=>({key:`${b.id}|${p.id}|${f}`,c:e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(p.id),filter:f,vernierHz:vernierHzForBand(p.id)})})))),
  ...e.scenario.buoys.map((b:any)=>({key:`${b.id}|FULL`,c:e.subscribe({channel:b.rfChannel,kind:'lofar',res:fullRes,filter:'NB',fullAxis:true,visibleTileIndex:0})}))];
 for(let k=1;k<=sec*4;k++){e.advance(.25);for(const x of subs){const sub=e.subscriptions.get(x.c.streamId);while(e.rowsReady(x.c.streamId)>0){const tag=sub.fullAxis?`${sub.fullAxis.queue[0].rowKey}|${sub.fullAxis.queue[0].tileIndex}`:`${sub.read}`;e.writeRow(x.c.streamId,out);expect(sub.res.lastIntegrated).toBe(true);rows.set(`${x.key}|${tag}`,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}}}
 return rows;
}
function errors(fullRes:number,sec:number,nC=3){
 const a=collect('reference',fullRes,sec,nC),b=collect('fast',fullRes,sec,nC),stat=new Map<string,{max:number;sum:number;n:number}>();
 expect(b.size).toBe(a.size);
 for(const [k,ra] of a){const rb=b.get(k)!;expect(rb.length).toBe(ra.length);const band=k.split('|')[1]!,st=stat.get(band)??{max:0,sum:0,n:0};
  for(let i=0;i<ra.length;i++){const d=Math.abs(10*Math.log10(rb[i]!/ra[i]!));st.max=Math.max(st.max,d);st.sum+=d;st.n++;}stat.set(band,st);}
 return Object.fromEntries([...stat].map(([k,v])=>[k,{maxDb:v.max,meanDb:v.sum/v.n,bins:v.n}]));
}
describe('fast RES row path vs reference',()=>{
 for(const fullRes of [5,2])it(`expected-spectrum error ≤0.01 dB per band and FULLBAND RES${fullRes} (accumulator${fullRes===2?' + direct':''} path)`,()=>{
  const r=errors(fullRes,48);console.log(`fast-vs-reference dB error, FULLBAND RES${fullRes}:`,JSON.stringify(r));
  for(const [band,v] of Object.entries(r)){expect(v.bins,band).toBeGreaterThan(1000);expect(v.maxDb,band).toBeLessThanOrEqual(.01);expect(v.meanDb,band).toBeLessThanOrEqual(.001);}
  expect(Object.keys(r)).toContain('FULL');
 },240000);
 it('60 contacts: error ≤0.01 dB (FULLBAND RES5)',()=>{const r=errors(5,12,60);console.log('fast-vs-reference dB error, 60 contacts:',JSON.stringify(r));for(const [band,v] of Object.entries(r))expect(v.maxDb,band).toBeLessThanOrEqual(.01);},240000);
 for(const kind of ['swath','src'] as const)it(`seed-777 ${kind} edge 10/50/90% times within one hop of the reference`,()=>{
  setResRowPath('reference');const ref=measureEdges(kind);setResRowPath('fast');const fast=measureEdges(kind);const worst:Record<string,number>={},deltas:Record<string,Record<string,number>>={};
  for(const b of Object.keys(ref)){const hop=resParams(resForBand(b as never)).hopS;let w=0;deltas[b]={};for(const ph of ['rise','fall'] as const)for(const q of ['t10','t50','t90'] as const){const d=Math.abs(fast[b]![ph][q]-ref[b]![ph][q]);deltas[b]![`${ph}.${q}`]=fast[b]![ph][q]-ref[b]![ph][q];expect(Number.isFinite(d)).toBe(true);expect(d,`${b} ${ph} ${q}`).toBeLessThanOrEqual(hop);w=Math.max(w,d);}worst[b]=w;}
  console.log(`edge |fast−ref| max s (${kind}):`,JSON.stringify(worst));console.log(`edge signed fast−ref s (${kind}):`,JSON.stringify(deltas));
 },600000);
 it('accumulators are shared NB/BB, allocated per band (bounded) and released on unsubscribe',()=>{
  const before=accumCount(),e=new AcousticEngine(scen(1,1),1) as any;
  const ids=LOFAR_BAND_PRESETS.flatMap(p=>(['NB','BB'] as const).map(f=>e.subscribe({channel:1,kind:'lofar',res:resForBand(p.id),filter:f,vernierHz:vernierHzForBand(p.id)}).streamId));
  expect(accumCount()-before).toBe(LOFAR_BAND_PRESETS.length);
  for(const id of ids)e.unsubscribe(id);expect(accumCount()).toBe(before);
 });
});
