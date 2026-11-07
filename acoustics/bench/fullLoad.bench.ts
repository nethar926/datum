/** Provisional manifest v1 full-load benchmark. Run each case in a fresh process; no optimizations. */
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,attachWaterColumn,SIM_STREAM_SET,parseLofarStreamId,spanCacheBytes,rowCacheBytes,fftSharedTableBytes,sharedScratchBytes,setSpanCache,spanCacheEnabled} from '../src/index.js';
import type {GramConfig} from '../src/protocol.js';
export function scen(nBuoys:number,nContacts=1){const s=cpaScenario();s.fmax=2000;s.seed=303;
 s.contacts=Array.from({length:nContacts},(_,i)=>({id:'m'+i,category:'subsurface' as const,x:-1500+i*137,y:600+i*91,depth:60+i,course:Math.PI/2+i*.1,speed:4,motion:[{at:0,course:Math.PI/2+i*.1,speed:4,depth:60+i}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,tonals:[{family:'motor' as const,hz:40+i,power:1,width:'discrete' as const,stability:'stable' as const}]}}));
 s.buoys=Array.from({length:nBuoys},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:(i%8)*400,y:Math.floor(i/8)*500}));return s;}

function ownedBuffers(objects:unknown[],seenBuffers:Set<ArrayBufferLike>):number {
 const seen=new Set<object>();let bytes=0;
 function visit(o:any):void{if(!o||typeof o!=='object'||seen.has(o))return;seen.add(o);
  if(ArrayBuffer.isView(o)){if(!seenBuffers.has(o.buffer)){seenBuffers.add(o.buffer);bytes+=o.buffer.byteLength;}return;}
  if(o instanceof Map){for(const v of o.values())visit(v);return;}
  for(const [k,v] of Object.entries(o))if(!['contacts','contact','buoy','environment','waterColumn'].includes(k))visit(v);
 }
 objects.forEach(visit);return bytes;
}
export function runFullLoad(sec:number,res:number,nC:number){
 if(process.env.SPAN_CACHE==='0')setSpanCache(false);else if(process.env.SPAN_CACHE==='1')setSpanCache(true);
 const scenario=scen(32,nC);scenario.waterColumn=attachWaterColumn(scenario.environment);
 const e=new AcousticEngine(scenario,303),internal=e as any,out=new Float32Array(4096),bearing=new Float32Array(4096);
 const streams:{streamId:number;demon:boolean}[]=[],fulls:GramConfig[]=[];
 for(const b of scenario.buoys){
  for(const logical of SIM_STREAM_SET){const lf=parseLofarStreamId(logical);
   if(lf){const c=e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(lf.bandPreset),filter:lf.filter,vernierHz:vernierHzForBand(lf.bandPreset)});streams.push({streamId:c.streamId,demon:false});}
   else if(logical==='demon')for(const band of [[500,2000],[2000,6000]] as [number,number][])streams.push({streamId:e.subscribe({kind:'demon',buoyId:Number(b.id.replace(/\D/g,'')),band}),demon:true});
  }
  for(const filter of ['NB','BB'] as const){const c=e.subscribe({channel:b.rfChannel,kind:'lofar',res,filter,fullAxis:true,visibleTileIndex:0});fulls.push(c);streams.push({streamId:c.streamId,demon:false});}
 }
 if(streams.length!==32*12)throw new Error('Expected provisional manifest v1: 8 band + 2 DEMON + 2 FULLBAND per buoy');
 const counts={band:0,demon:0,fullband:0,bearing:0,truth:0,waterColumn:0},ticks:number[]=[],mem:any[]=[];
 const memory=()=>{const u=process.memoryUsage(),resBytes=e.retainedBytes().total,seen=new Set<ArrayBufferLike>();
  const demonBytes=ownedBuffers([...internal.subscriptions.values()].filter((s:any)=>s.renderer).map((s:any)=>s.renderer),seen);
  const legacyBytes=ownedBuffers(internal.generators,seen);
  const rb=e.retainedBytes();return {rssBytes:u.rss,heapBytes:u.heapUsed,resBytes,demonBytes,legacyBytes,acousticBytes:resBytes+demonBytes+legacyBytes,breakdown:{history:rb.history,scratch:rb.scratch,streams:rb.streams,spanCache:spanCacheBytes(),rowCache:rowCacheBytes(),fftShared:fftSharedTableBytes(),sharedScratch:sharedScratchBytes()}};};
 mem.push({at:'start',...memory()});const N=sec*4,start=performance.now();
 for(let k=1;k<=N;k++){const t0=performance.now();e.advance(.25);const t=k*.25;
  if(t%3===0)for(const [i,c] of fulls.entries())if(c.tileCount!>1){const df=c.fBin,tb=c.tileBins!,v=(Math.floor(t/3)+i)%c.tileCount!;e.setViewWindow(c.streamId,{fLo:v*tb*df+1,fHi:v*tb*df+tb*df/2});}
  for(const s of streams)while(e.rowsReady(s.streamId)>0){e.writeRow(s.streamId,out);if(s.demon)counts.demon++;else{e.writeBearingRow(s.streamId,bearing);counts.bearing++;if(fulls.some(c=>c.streamId===s.streamId))counts.fullband++;else counts.band++;}}
  const tactical=e.tactical();if(!tactical.truth)throw new Error('Missing truth output');counts.truth++;
  if(!e.scenario.waterColumn)throw new Error('Missing waterColumn output');counts.waterColumn++;
  ticks.push(performance.now()-t0);if(k===N/2)mem.push({at:'mid',...memory()});
  if(k%120===0)console.error(JSON.stringify({progressSimS:t,wallS:(performance.now()-start)/1000}));
 }
 const wallS=(performance.now()-start)/1000;mem.push({at:'end',...memory()});ticks.sort((a,b)=>a-b);
 return {manifest:'provisional manifest v1',seconds:sec,contacts:nC,res,buoys:32,perBuoy:{bands:8,demon:2,fullband:2},logicalSet:SIM_STREAM_SET,counts,wallS,pctRealtime:100*wallS/sec,tickMs:{mean:ticks.reduce((a,b)=>a+b,0)/ticks.length,p95:ticks[Math.ceil(.95*ticks.length)-1],max:ticks.at(-1)},mem,spanCache:spanCacheEnabled()};
}
if(process.argv[2])console.log(JSON.stringify(runFullLoad(Number(process.argv[2]),Number(process.argv[3]),Number(process.argv[4]))));
