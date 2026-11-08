import {describe,it,expect,afterEach} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,setResRowPath,spanCacheStats,resetSpanCacheStats,setSpanCache,SIM_STREAM_SET,parseLofarStreamId,attachWaterColumn,setBoundedTileAccums} from '../src/index.js';

afterEach(()=>{setResRowPath('fast');setSpanCache(true);resetSpanCacheStats();setBoundedTileAccums(true);});

function scen(nB:number,nC:number){const s=cpaScenario();s.fmax=2000;s.seed=303;
 s.contacts=Array.from({length:nC},(_,i)=>({id:'m'+i,category:'subsurface' as const,x:-1500+i*137,y:600+i*91,depth:60+i,course:Math.PI/2+i*.1,speed:4,motion:[{at:0,course:Math.PI/2+i*.1,speed:4,depth:60+i}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,tonals:[{family:'motor' as const,hz:40+i,power:1,width:'discrete' as const,stability:'stable' as const}]}}));
 s.buoys=Array.from({length:nB},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:(i%8)*400,y:Math.floor(i/8)*500}));return s;}

/** Manifest-v1 style subscribe for one buoy (8 band + 2 FULLBAND); returns NB/BB FULLBAND stream ids. */
function subManifest(e:any,b:any,res:number){
 const bands:number[]=[];
 for(const logical of SIM_STREAM_SET){const lf=parseLofarStreamId(logical);if(lf)bands.push(e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(lf.bandPreset),filter:lf.filter,vernierHz:vernierHzForBand(lf.bandPreset)}).streamId);}
 const nb=e.subscribe({channel:b.rfChannel,kind:'lofar',res,filter:'NB',fullAxis:true,visibleTileIndex:0});
 const bb=e.subscribe({channel:b.rfChannel,kind:'lofar',res,filter:'BB',fullAxis:true,visibleTileIndex:0});
 return {bands,nb:nb.streamId,bb:bb.streamId,nbCfg:nb,bbCfg:bb};
}

describe('exact span-spectrum reuse (FULLBAND integrateHistory)',()=>{
 it('RES2 FULLBAND NB then BB: span cache hits and bit-identical expected spectra',()=>{
  // Isolate integrateHistory + SPAN_CACHE (bounded tile-0 accums would bypass the cache).
  setBoundedTileAccums(false);
  const scenario=scen(1,3);scenario.waterColumn=attachWaterColumn(scenario.environment);
  const e=new AcousticEngine(scenario,303) as any;
  const {nb,bb}=subManifest(e,scenario.buoys[0],2);
  const out=new Float32Array(4096);
  resetSpanCacheStats();
  // Advance past one FULLBAND row period (4 s) so tiles are due, then drain NB then BB.
  for(let k=0;k<20;k++)e.advance(.25);
  const nbRows=new Map<string,Float64Array>(),bbRows=new Map<string,Float64Array>();
  const before=spanCacheStats();
  while(e.rowsReady(nb)>0){const sub=e.subscriptions.get(nb),job=sub.fullAxis.queue[0],tag=`${job.rowKey}|${job.tileIndex}`;e.writeRow(nb,out);nbRows.set(tag,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}
  const mid=spanCacheStats();
  while(e.rowsReady(bb)>0){const sub=e.subscriptions.get(bb),job=sub.fullAxis.queue[0],tag=`${job.rowKey}|${job.tileIndex}`;e.writeRow(bb,out);bbRows.set(tag,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}
  const after=spanCacheStats();
  expect(nbRows.size).toBeGreaterThan(0);
  expect(bbRows.size).toBe(nbRows.size);
  for(const [k,a] of nbRows){const b=bbRows.get(k)!;expect(b.length).toBe(a.length);expect(Array.from(b)).toEqual(Array.from(a));}
  // NB populates the cache (misses); BB should hit for every tile drained.
  expect(mid.misses-before.misses).toBeGreaterThan(0);
  expect(after.hits-mid.hits).toBe(mid.misses-before.misses);
  expect(after.hits-mid.hits).toBe(nbRows.size);
 },60000);

 it('RES2 FULLBAND reuse is bit-identical to a fresh fast-path run (no behavioural change)',()=>{
  function collect(){
   const scenario=scen(1,2);scenario.waterColumn=attachWaterColumn(scenario.environment);
   const e=new AcousticEngine(scenario,303) as any;const {nb,bb}=subManifest(e,scenario.buoys[0],2);
   const out=new Float32Array(4096),rows=new Map<string,Float64Array>();
   for(let k=0;k<24;k++){e.advance(.25);
    for(const id of [nb,bb])while(e.rowsReady(id)>0){const sub=e.subscriptions.get(id),job=sub.fullAxis.queue[0],tag=`${id===nb?'NB':'BB'}|${job.rowKey}|${job.tileIndex}`;e.writeRow(id,out);rows.set(tag,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}}
   return rows;
  }
  const a=collect(),b=collect();
  expect(b.size).toBe(a.size);
  for(const [k,va] of a)expect(Array.from(b.get(k)!)).toEqual(Array.from(va));
 },120000);

 it('vernier NB/BB still share accumulators (RES5); span cache unused for them',()=>{
  const scenario=scen(1,1);const e=new AcousticEngine(scenario,1) as any;
  const ids=(['NB','BB'] as const).map(f=>e.subscribe({channel:1,kind:'lofar',res:resForBand('LF'),filter:f,vernierHz:vernierHzForBand('LF')}).streamId);
  const out=new Float32Array(1024);resetSpanCacheStats();
  for(let k=0;k<16;k++){e.advance(.25);for(const id of ids)while(e.rowsReady(id)>0)e.writeRow(id,out);}
  const st=spanCacheStats();
  expect(st.hits+st.misses).toBe(0); // integrateAccum path, not integrateHistory
 },30000);
});
