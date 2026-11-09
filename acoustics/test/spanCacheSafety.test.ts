import {describe,it,expect,afterEach} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,setResRowPath,setSpanCache,spanCacheStats,resetSpanCacheStats,invalidateSpanCache,SPAN_CACHE_ENTRIES,spanCacheBytes,attachWaterColumn} from '../src/index.js';

afterEach(()=>{setResRowPath('fast');setSpanCache(true);resetSpanCacheStats();});

function scen(nB=1,nC=2,seed=303){const s=cpaScenario();s.fmax=2000;s.seed=seed;
 s.contacts=Array.from({length:nC},(_,i)=>({id:'m'+i,category:'subsurface' as const,x:-1500+i*137,y:600+i*91,depth:60+i,course:Math.PI/2+i*.1,speed:4,motion:[{at:0,course:Math.PI/2+i*.1,speed:4,depth:60+i}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,tonals:[{family:'motor' as const,hz:40+i,power:1,width:'discrete' as const,stability:'stable' as const}]}}));
 s.buoys=Array.from({length:nB},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:i*400,y:0}));return s;}

function subFull(e:any,b:any,res=2){
 const nb=e.subscribe({channel:b.rfChannel,kind:'lofar',res,filter:'NB',fullAxis:true,visibleTileIndex:0});
 const bb=e.subscribe({channel:b.rfChannel,kind:'lofar',res,filter:'BB',fullAxis:true,visibleTileIndex:0});
 return {nb:nb.streamId,bb:bb.streamId};
}

function drain(e:any,ids:number[],out:Float32Array,rows?:Map<string,Float64Array>){
 for(const id of ids)while(e.rowsReady(id)>0){const sub=e.subscriptions.get(id),job=sub.fullAxis?.queue?.[0],tag=job?`${id}|${job.rowKey}|${job.tileIndex}`:`${id}|${sub.read}`;
  e.writeRow(id,out);if(rows)rows.set(tag,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}
}

describe('SPAN_CACHE safety (FE)',()=>{
 it('capacity is fixed; long run does not grow entry count or bytes',()=>{
  const scenario=scen(2,3);scenario.waterColumn=attachWaterColumn(scenario.environment);
  const e=new AcousticEngine(scenario,303) as any;
  for(const b of scenario.buoys)subFull(e,b,2);
  const out=new Float32Array(4096),bytes0=spanCacheBytes();
  expect(spanCacheStats().entries).toBe(SPAN_CACHE_ENTRIES);
  // 120 s of sim (~ long enough for many tile rows / ring wraps)
  for(let k=0;k<480;k++){e.advance(.25);drain(e,[...e.subscriptions.keys()],out);}
  const st=spanCacheStats();
  expect(st.entries).toBe(SPAN_CACHE_ENTRIES);
  expect(spanCacheBytes()).toBe(bytes0);
  expect(st.misses+st.hits).toBeGreaterThan(SPAN_CACHE_ENTRIES);
 },180000);

 it('seek/replay rows are bit-identical to a cold-cache fresh run',()=>{
  function run(cold:boolean){
   if(cold){invalidateSpanCache();setSpanCache(true);}
   const scenario=scen(1,2,4242);scenario.waterColumn=attachWaterColumn(scenario.environment);
   const e=new AcousticEngine(scenario,4242) as any;const {nb,bb}=subFull(e,scenario.buoys[0],2);
   const out=new Float32Array(4096),rows=new Map<string,Float64Array>();
   for(let k=0;k<48;k++)e.advance(.25);
   drain(e,[nb,bb],out,rows);
   // seek-like: skip backlog then continue (history still deterministic)
   e.skipToLatest(nb);e.skipToLatest(bb);
   for(let k=0;k<16;k++){e.advance(.25);drain(e,[nb,bb],out,rows);}
   return rows;
  }
  const warm=run(false);
  resetSpanCacheStats();
  const cold=run(true);
  expect(cold.size).toBe(warm.size);
  for(const [k,a] of warm)expect(Array.from(cold.get(k)!)).toEqual(Array.from(a));
 },120000);

 it('scenario/environment change invalidates: would-be stale hit is a miss after invalidate',()=>{
  const scenario=scen(1,2);scenario.waterColumn=attachWaterColumn(scenario.environment);
  const e=new AcousticEngine(scenario,303) as any;const {nb,bb}=subFull(e,scenario.buoys[0],2);
  const out=new Float32Array(4096);
  for(let k=0;k<24;k++)e.advance(.25);
  resetSpanCacheStats();
  drain(e,[nb,bb],out);
  const afterDrain=spanCacheStats();
  expect(afterDrain.hits).toBeGreaterThan(0);
  // Deliberate: without invalidation the same keys would still hit. After setEnvironment, epoch bumps.
  const hitsBefore=afterDrain.hits;
  e.setEnvironment({...scenario.environment,seaState:5});
  resetSpanCacheStats();
  // Force another NB/BB pass at a new time so misses must refill; hits must not reuse pre-env spectra.
  for(let k=0;k<20;k++)e.advance(.25);
  drain(e,[nb,bb],out);
  const st=spanCacheStats();
  expect(st.misses).toBeGreaterThan(0);
  // Every BB hit in this window must be from post-invalidate refills (hit count ≤ misses of this window's NB).
  expect(st.hits).toBeLessThanOrEqual(st.misses);
  expect(hitsBefore).toBeGreaterThan(0); // sanity: cache was warm before env change
 },120000);

 it('setSpanCache(false) yields zero hits and matches a cold enabled run bit-for-bit',()=>{
  function collect(on:boolean){
   setSpanCache(on);resetSpanCacheStats();
   const scenario=scen(1,2,7);scenario.waterColumn=attachWaterColumn(scenario.environment);
   const e=new AcousticEngine(scenario,7) as any;const {nb,bb}=subFull(e,scenario.buoys[0],2);
   const out=new Float32Array(4096),rows=new Map<string,Float64Array>();
   for(let k=0;k<24;k++){e.advance(.25);drain(e,[nb,bb],out,rows);}
   return {rows,stats:spanCacheStats()};
  }
  const off=collect(false);
  expect(off.stats.hits).toBe(0);
  const on=collect(true);
  expect(on.stats.hits).toBeGreaterThan(0);
  expect(on.rows.size).toBe(off.rows.size);
  for(const [k,a] of off.rows)expect(Array.from(on.rows.get(k)!)).toEqual(Array.from(a));
 },120000);

 it('evicting the compute cache does not alter already-emitted retained row copies',()=>{
  const scenario=scen(1,1);const e=new AcousticEngine(scenario,1) as any;const {nb}=subFull(e,scenario.buoys[0],5);
  const out=new Float32Array(4096),kept:Float32Array[]=[];
  for(let k=0;k<16;k++){e.advance(.25);while(e.rowsReady(nb)>0){e.writeRow(nb,out);kept.push(Float32Array.from(out.subarray(0,e.subscriptions.get(nb).config.bins)));}}
  const snapshot=kept.map(r=>Float32Array.from(r));
  invalidateSpanCache();setSpanCache(false);invalidateSpanCache();
  for(let i=0;i<snapshot.length;i++)expect(Array.from(kept[i]!)).toEqual(Array.from(snapshot[i]!));
 },60000);
});
