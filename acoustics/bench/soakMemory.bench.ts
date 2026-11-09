/** 900 s RES2×60 memory soak with pan / seek / RES switches. Bounded ON vs OFF.
 * Run: npx tsx bench/soakMemory.bench.ts [seconds=900] [mode=on|off|both]
 * Samples acoustic retained + JS heap every SAMPLE_S sim-seconds; tags peak op. */
import {
  AcousticEngine,cpaScenario,fictionalSignature,attachWaterColumn,SIM_STREAM_SET,parseLofarStreamId,
  resForBand,vernierHzForBand,setBoundedTileAccums,boundedTileAccums,tileAccumBytes,accumCount,
  spanCacheBytes,rowCacheBytes,fftSharedTableBytes,sharedScratchBytes,setAccumMaxTiles,ACCUM_MAX_TILES_DEFAULT,
} from '../src/index.js';
import type {GramConfig} from '../src/protocol.js';

const SAMPLE_S=5;
const BUDGET=50*1024*1024;

function scen(nBuoys:number,nContacts:number){
  const s=cpaScenario();s.fmax=2000;s.seed=303;
  s.contacts=Array.from({length:nContacts},(_,i)=>({
    id:'m'+i,category:'subsurface' as const,x:-1500+i*137,y:600+i*91,depth:60+i,
    course:Math.PI/2+i*.1,speed:4,motion:[{at:0,course:Math.PI/2+i*.1,speed:4,depth:60+i}],
    params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,
      tonals:[{family:'motor' as const,hz:40+i,power:1,width:'discrete' as const,stability:'stable' as const}]},
  }));
  s.buoys=Array.from({length:nBuoys},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:(i%8)*400,y:Math.floor(i/8)*500}));
  s.waterColumn=attachWaterColumn(s.environment);return s;
}

function ownedBuffers(objects:unknown[],seenBuffers:Set<ArrayBufferLike>):number{
  const seen=new Set<object>();let bytes=0;
  function visit(o:any):void{
    if(!o||typeof o!=='object'||seen.has(o))return;seen.add(o);
    if(ArrayBuffer.isView(o)){if(!seenBuffers.has(o.buffer)){seenBuffers.add(o.buffer);bytes+=o.buffer.byteLength;}return;}
    if(o instanceof Map){for(const v of o.values())visit(v);return;}
    for(const [k,v] of Object.entries(o))if(!['contacts','contact','buoy','environment','waterColumn'].includes(k))visit(v);
  }
  objects.forEach(visit);return bytes;
}

type Op='advance'|'pan'|'seekFwd'|'seekBack'|'resSwitch'|'drain';

export function runSoak(sec:number,boundedOn:boolean,nC=60,res0:2|5=2){
  setAccumMaxTiles(ACCUM_MAX_TILES_DEFAULT);
  setBoundedTileAccums(boundedOn);
  const scenario=scen(32,nC);
  const e=new AcousticEngine(scenario,303),internal=e as any;
  const out=new Float32Array(4096),bearing=new Float32Array(4096);
  const streams:{streamId:number;demon:boolean;fullband:boolean}[]=[];
  const fulls:GramConfig[]=[];
  for(const b of scenario.buoys){
    for(const logical of SIM_STREAM_SET){
      const lf=parseLofarStreamId(logical);
      if(lf){
        const c=e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(lf.bandPreset),filter:lf.filter,vernierHz:vernierHzForBand(lf.bandPreset)});
        streams.push({streamId:c.streamId,demon:false,fullband:false});
      }else if(logical==='demon'){
        for(const band of [[500,2000],[2000,6000]] as [number,number][])
          streams.push({streamId:e.subscribe({kind:'demon',buoyId:Number(b.id.replace(/\D/g,'')),band}),demon:true,fullband:false});
      }
    }
    for(const filter of ['NB','BB'] as const){
      const c=e.subscribe({channel:b.rfChannel,kind:'lofar',res:res0,filter,fullAxis:true,visibleTileIndex:0});
      fulls.push(c);streams.push({streamId:c.streamId,demon:false,fullband:true});
    }
  }
  if(streams.length!==32*12)throw new Error(`Expected 384 streams, got ${streams.length}`);

  const snap=(op:Op,phase:string)=>{
    const u=process.memoryUsage(),rb=e.retainedBytes(),seen=new Set<ArrayBufferLike>();
    const demonBytes=ownedBuffers([...internal.subscriptions.values()].filter((s:any)=>s.renderer).map((s:any)=>s.renderer),seen);
    const legacyBytes=ownedBuffers(internal.generators,seen);
    const acousticBytes=rb.total+demonBytes+legacyBytes;
    return {
      t:e.time,op,phase,rssBytes:u.rss,heapBytes:u.heapUsed,
      resBytes:rb.total,demonBytes,legacyBytes,acousticBytes,
      breakdown:{
        history:rb.history,scratch:rb.scratch,streams:rb.streams,
        tileAccum:tileAccumBytes(),spanCache:spanCacheBytes(),rowCache:rowCacheBytes(),
        fftShared:fftSharedTableBytes(),sharedScratch:sharedScratchBytes(),accumCount:accumCount(),
      },
    };
  };

  // Compact series (every SAMPLE_S) + peak tracking without retaining every op snap.
  const series:ReturnType<typeof snap>[]=[];
  let peak=snap('advance','start');
  series.push(peak);
  const byOp=new Map<string,{peak:number;t:number}>();
  const observe=(op:Op,phase:string,store:boolean)=>{
    const s=snap(op,phase);
    if(s.acousticBytes>peak.acousticBytes)peak=s;
    const cur=byOp.get(op);if(!cur||s.acousticBytes>cur.peak)byOp.set(op,{peak:s.acousticBytes,t:s.t});
    if(store)series.push(s);
    return s;
  };

  const pan=(tick:number)=>{
    for(const [i,c] of fulls.entries()){
      if(!(c.tileCount!>1))continue;
      const df=c.fBin,tb=c.tileBins!,v=(Math.floor(tick/3)+i)%c.tileCount!;
      e.setViewWindow(c.streamId,{fLo:v*tb*df+1,fHi:v*tb*df+tb*df/2});
    }
  };

  const seekFwd=()=>{
    for(const s of streams){
      if(s.demon)continue;
      if(e.rowsReady(s.streamId)>2)e.skipToLatest(s.streamId,out);
    }
  };

  const seekBack=()=>{
    // FE-like scrub: rewind a few FULLBAND streams by one row period, drain at most the
    // hot tiles for that row, then skipToLatest — exercises seek memory without a full
    // history recompute of all 32×8×N rows (that path is hours at RES2×60).
    const subset=fulls.filter((_,i)=>i%16===0); // 4 streams (2 buoys × NB/BB)
    for(const c of subset){
      const sub=internal.subscriptions.get(c.streamId);if(!sub?.fullAxis)continue;
      const fa=sub.fullAxis,due=Math.max(0,Math.floor((e.time-sub.start)*sub.config.rowRateHz+1e-9));
      const target=Math.max(0,due-1);
      fa.scheduled=target;fa.queue.length=0;sub.read=target*fa.tileCount;
    }
    // Drain a bounded amount then catch up.
    let n=0;
    for(const c of subset){
      while(e.rowsReady(c.streamId)>0&&n<24){e.writeRow(c.streamId,out);e.writeBearingRow(c.streamId,bearing);n++;}
      e.skipToLatest(c.streamId,out);
    }
  };

  let resIs2=res0===2;
  const resSwitch=()=>{
    const next=resIs2?5:2;resIs2=!resIs2;
    for(const c of fulls){
      const cfg=e.setGram(c.streamId,{res:next,fullAxis:true,visibleTileIndex:0});
      Object.assign(c,cfg);
    }
  };

  const drain=()=>{
    for(const s of streams)while(e.rowsReady(s.streamId)>0){
      e.writeRow(s.streamId,out);if(!s.demon)e.writeBearingRow(s.streamId,bearing);
    }
    e.tactical();
  };

  const N=sec*4,tWall0=performance.now();
  let lastSampleAt=0;
  for(let k=1;k<=N;k++){
    const t=k*.25;
    const phaseN=Math.floor(t/60)%4;
    const phase=phaseN===0?'pan':phaseN===1?'seek':phaseN===2?'res':'mixed';
    let op:Op='advance';
    e.advance(.25);
    if(phase==='pan'||phase==='mixed'){
      if(t%3===0){pan(Math.floor(t/3));op='pan';observe('pan',phase,false);}
    }
    if(phase==='seek'||phase==='mixed'){
      if(Math.floor(t)%20===8){seekFwd();op='seekFwd';observe('seekFwd',phase,false);}
      if(Math.floor(t)%20===16){seekBack();op='seekBack';observe('seekBack',phase,false);}
    }
    if(phase==='res'||phase==='mixed'){
      if(Math.abs(t%30)<1e-9 && t>0){resSwitch();op='resSwitch';observe('resSwitch',phase,false);}
    }
    drain();
    if(t-lastSampleAt>=SAMPLE_S-1e-9 || k===N){
      lastSampleAt=t;
      const s=observe(op,phase,true);
      if(Math.round(t)%30===0)console.error(JSON.stringify({progressSimS:t,wallS:(performance.now()-tWall0)/1000,acousticMB:+(s.acousticBytes/1024/1024).toFixed(3),op,phase,heapMB:+(s.heapBytes/1024/1024).toFixed(1)}));
    }
  }

  const acoustic=series.map(s=>s.acousticBytes).sort((a,b)=>a-b);
  const heap=series.map(s=>s.heapBytes).sort((a,b)=>a-b);
  const pct=(arr:number[],p:number)=>arr[Math.min(arr.length-1,Math.ceil(p/100*arr.length)-1)]!;
  const first=series[0]!,last=series[series.length-1]!;
  const warm=series.find(s=>s.t>=30)||series.find(s=>s.t>=Math.min(10,sec))||first;
  const growth=last.acousticBytes-warm.acousticBytes;
  const growthFromStart=last.acousticBytes-first.acousticBytes;

  return {
    sec,nC,res0,boundedOn,boundedTileAccums:boundedTileAccums(),
    sampleCount:series.length,sampleS:SAMPLE_S,
    wallS:(performance.now()-tWall0)/1000,
    acousticMB:{
      start:first.acousticBytes/1024/1024,
      final:last.acousticBytes/1024/1024,
      peak:peak.acousticBytes/1024/1024,
      p50:pct(acoustic,50)/1024/1024,
      p99:pct(acoustic,99)/1024/1024,
      growth:growth/1024/1024,
      growthFromStart:growthFromStart/1024/1024,
      warmT:warm.t,warmMB:warm.acousticBytes/1024/1024,
      underBudget:peak.acousticBytes<=BUDGET,
    },
    heapMB:{
      start:first.heapBytes/1024/1024,
      final:last.heapBytes/1024/1024,
      peak:Math.max(...series.map(s=>s.heapBytes))/1024/1024,
      p99:pct(heap,99)/1024/1024,
      growth:(last.heapBytes-first.heapBytes)/1024/1024,
    },
    peakOp:{op:peak.op,phase:peak.phase,t:peak.t,acousticMB:peak.acousticBytes/1024/1024,breakdown:peak.breakdown},
    byOp:Object.fromEntries([...byOp].map(([k,v])=>[k,{peakMB:v.peak/1024/1024,t:v.t}])),
    finalBreakdown:{
      ...last.breakdown,
      demon:last.demonBytes,legacy:last.legacyBytes,acoustic:last.acousticBytes,
    },
    samples:series.map(s=>({
      t:s.t,op:s.op,phase:s.phase,
      acousticMB:s.acousticBytes/1024/1024,heapMB:s.heapBytes/1024/1024,
      historyMB:s.breakdown.history/1024/1024,scratchMB:s.breakdown.scratch/1024/1024,
      streamsMB:s.breakdown.streams/1024/1024,tileAccumMB:s.breakdown.tileAccum/1024/1024,
    })),
  };
}

const sec=Number(process.argv[2]||900);
const mode=(process.argv[3]||'both').toLowerCase();
const runs:any[]=[];
if(mode==='on'||mode==='both'){console.error('soak bounded ON');runs.push(runSoak(sec,true));}
if(mode==='off'||mode==='both'){console.error('soak bounded OFF');runs.push(runSoak(sec,false));}
console.log(JSON.stringify(mode==='both'?{sec,runs}:runs[0],null,0));
