import {describe,it,expect,afterEach} from 'vitest';
import {
  AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,
  setResRowPath,setAdaptiveChunk,adaptiveChunk,setContactCull,contactCull,
  setAccumMaxTiles,accumMaxTiles,ACCUM_MAX_TILES_DEFAULT,CULL_POWER_FRAC,
} from '../src/index.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';

afterEach(()=>{
  setResRowPath('fast');
  setAdaptiveChunk(true);
  setContactCull(true);
  setAccumMaxTiles(ACCUM_MAX_TILES_DEFAULT);
});

function scen(nB:number,nC:number,levelDb=148){
  const s=cpaScenario();s.fmax=2000;s.seed=4242;s.environment={...s.environment,seaState:3};
  s.contacts=Array.from({length:nC},(_,i)=>({
    id:'k'+i,category:'subsurface' as const,
    x:-1800+i*311,y:400+i*173,depth:50+7*i,course:Math.PI/2+i*.3,speed:3+i%4,
    motion:[{at:0,course:Math.PI/2+i*.3,speed:3+i%4,depth:50+7*i}],
    params:{...fictionalSignature,levelDb:levelDb+i,modulation:0,cavitationPower:.03*(i%3),
      tonals:[{family:'motor' as const,hz:35+13*i,power:1,width:'discrete' as const,stability:'stable' as const}]},
  }));
  s.buoys=Array.from({length:nB},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:i*700,y:i*300}));
  return s;
}

function collect(path:'fast'|'reference',opts:{adaptive?:boolean;cull?:boolean;sec?:number;nC?:number;levelDb?:number}={}){
  setResRowPath(path);
  setAdaptiveChunk(opts.adaptive??true);
  setContactCull(opts.cull??true);
  const e=new AcousticEngine(scen(2,opts.nC??3,opts.levelDb??148),4242) as any;
  const out=new Float32Array(4096),rows=new Map<string,Float64Array>();
  const subs=[
    ...e.scenario.buoys.flatMap((b:any)=>LOFAR_BAND_PRESETS.flatMap(p=>(['NB','BB'] as const).map(f=>({
      key:`${b.id}|${p.id}|${f}`,
      c:e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(p.id),filter:f,vernierHz:vernierHzForBand(p.id)}),
    })))),
    ...e.scenario.buoys.map((b:any)=>({
      key:`${b.id}|FULL`,
      c:e.subscribe({channel:b.rfChannel,kind:'lofar',res:5,filter:'NB',fullAxis:true,visibleTileIndex:0}),
    })),
  ];
  const sec=opts.sec??8;
  for(let k=1;k<=sec*4;k++){
    e.advance(.25);
    for(const x of subs){
      const sub=e.subscriptions.get(x.c.streamId);
      while(e.rowsReady(x.c.streamId)>0){
        const tag=sub.fullAxis?`${sub.fullAxis.queue[0].rowKey}|${sub.fullAxis.queue[0].tileIndex}`:`${sub.read}`;
        e.writeRow(x.c.streamId,out);
        rows.set(`${x.key}|${tag}`,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));
      }
    }
  }
  return rows;
}

function maxErr(a:Map<string,Float64Array>,b:Map<string,Float64Array>){
  let max=0,sum=0,n=0;
  expect(b.size).toBe(a.size);
  for(const [k,ra] of a){
    const rb=b.get(k)!;expect(rb.length).toBe(ra.length);
    for(let i=0;i<ra.length;i++){
      const d=Math.abs(10*Math.log10(rb[i]!/ra[i]!));
      max=Math.max(max,d);sum+=d;n++;
    }
  }
  return {maxDb:max,meanDb:sum/n,bins:n};
}

describe('kernel opts: adaptive chunk + contact cull',()=>{
  it('defaults: adaptive chunk ON, contact cull ON, accumMaxTiles=2',()=>{
    expect(adaptiveChunk()).toBe(true);
    expect(contactCull()).toBe(true);
    expect(accumMaxTiles()).toBe(2);
    expect(CULL_POWER_FRAC).toBeGreaterThan(0.002);
    expect(CULL_POWER_FRAC).toBeLessThan(0.003);
  });

  it('adaptive chunk ON vs reference ≤0.01 dB (FULLBAND RES5)',()=>{
    const ref=collect('reference',{adaptive:false,cull:false,sec:6});
    const fast=collect('fast',{adaptive:true,cull:false,sec:6});
    const e=maxErr(ref,fast);
    console.log('adaptive-chunk vs reference',e);
    expect(e.maxDb).toBeLessThanOrEqual(0.01);
    expect(e.meanDb).toBeLessThanOrEqual(0.001);
  },120000);

  it('contact cull ON vs cull OFF bit-identical on loud contacts (nothing culled)',()=>{
    const a=collect('fast',{adaptive:true,cull:false,sec:4,nC:3,levelDb:150});
    const b=collect('fast',{adaptive:true,cull:true,sec:4,nC:3,levelDb:150});
    for(const [k,ra] of a){
      const rb=b.get(k)!;
      for(let i=0;i<ra.length;i++)expect(rb[i]).toBe(ra[i]);
    }
  },120000);

  it('contact cull ON vs OFF agree within 0.01 dB with distant quiet contacts mixed in',()=>{
    // Far/quiet contacts exercise the cull bound; compare cull ON vs OFF (not vs a different scene).
    setResRowPath('fast');setAdaptiveChunk(true);
    function run(cull:boolean){
      setContactCull(cull);
      const s=scen(1,1,150);
      for(let i=0;i<15;i++)s.contacts.push({
        id:'q'+i,category:'subsurface' as const,x:80000+i*500,y:80000,depth:100,course:0,speed:1,
        motion:[{at:0,course:0,speed:1,depth:100}],
        params:{...fictionalSignature,levelDb:90,modulation:0,cavitationPower:0,
          tonals:[{family:'motor' as const,hz:50+i,power:1e-6,width:'discrete' as const,stability:'stable' as const}]},
      });
      const e=new AcousticEngine(s,4242) as any,out=new Float32Array(4096),rows=new Map<string,Float64Array>();
      const c=e.subscribe({channel:1,kind:'lofar',res:5,filter:'NB',fullAxis:true,visibleTileIndex:0});
      for(let k=1;k<=16;k++){e.advance(.25);const sub=e.subscriptions.get(c.streamId);
        while(e.rowsReady(c.streamId)>0){const tag=`${sub.fullAxis.queue[0].rowKey}|${sub.fullAxis.queue[0].tileIndex}`;e.writeRow(c.streamId,out);
          rows.set(tag,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}}
      return rows;
    }
    const off=run(false),on=run(true);let max=0,n=0;
    for(const [k,ra] of off){const rb=on.get(k)!;for(let i=0;i<ra.length;i++){const d=Math.abs(10*Math.log10(rb[i]!/ra[i]!));max=Math.max(max,d);n++;}}
    console.log('cull ON vs OFF with distant quiet',{maxDb:max,bins:n});
    expect(n).toBeGreaterThan(1000);expect(max).toBeLessThanOrEqual(0.01);
  },120000);

  it('setAccumMaxTiles(8) round-trips and resets to default',()=>{
    setAccumMaxTiles(8);expect(accumMaxTiles()).toBe(8);
    setAccumMaxTiles(ACCUM_MAX_TILES_DEFAULT);expect(accumMaxTiles()).toBe(2);
  });
});
