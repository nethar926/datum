import {describe,it,expect,afterEach} from 'vitest';
import {
  AcousticEngine,cpaScenario,fictionalSignature,attachWaterColumn,
  setBoundedTileAccums,boundedTileAccums,setTileAccumBudget,tileAccumBudget,
  setTileAccumPerBuoy,tileAccumPerBuoy,tileAccumBytes,accumCount,
  setAccumMaxTiles,ACCUM_MAX_TILES_DEFAULT,setResRowPath,resForBand,vernierHzForBand,
} from '../src/index.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';

afterEach(()=>{
  setResRowPath('fast');
  setBoundedTileAccums(true);
  setTileAccumBudget(Math.floor(3.2*1024*1024));
  setTileAccumPerBuoy(1);
  setAccumMaxTiles(ACCUM_MAX_TILES_DEFAULT);
});

function scen(nB:number,nC:number){
  const s=cpaScenario();s.fmax=2000;s.seed=303;
  s.contacts=Array.from({length:nC},(_,i)=>({
    id:'m'+i,category:'subsurface' as const,x:-1500+i*137,y:600+i*91,depth:60+i,
    course:Math.PI/2+i*.1,speed:4,motion:[{at:0,course:Math.PI/2+i*.1,speed:4,depth:60+i}],
    params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,
      tonals:[{family:'motor' as const,hz:40+i,power:1,width:'discrete' as const,stability:'stable' as const}]},
  }));
  s.buoys=Array.from({length:nB},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:(i%8)*400,y:Math.floor(i/8)*500}));
  s.waterColumn=attachWaterColumn(s.environment);return s;
}

describe('bounded FULLBAND tile Welch accums',()=>{
  it('defaults: bounded ON, perBuoy 1, budget ~3.2 MiB',()=>{
    expect(boundedTileAccums()).toBe(true);
    expect(tileAccumPerBuoy()).toBe(1);
    expect(tileAccumBudget()).toBe(Math.floor(3.2*1024*1024));
  });

  it('RES2 32 buoys: retainedBytes.total ≤ 50 MiB with bounded tile accums',()=>{
    setBoundedTileAccums(true);setTileAccumPerBuoy(1);
    const e=new AcousticEngine(scen(32,60),303) as any;
    for(const b of e.scenario.buoys){
      for(const p of LOFAR_BAND_PRESETS)for(const f of ['NB','BB'] as const)
        e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(p.id),filter:f,vernierHz:vernierHzForBand(p.id)});
      for(const f of ['NB','BB'] as const)e.subscribe({channel:b.rfChannel,kind:'lofar',res:2,filter:f,fullAxis:true,visibleTileIndex:0});
    }
    const out=new Float32Array(4096);
    for(let k=1;k<=80;k++){e.advance(.25);for(const s of e.subscriptions.values())if(s.res)while(e.rowsReady(s.config.streamId)>0)e.writeRow(s.config.streamId,out);}
    const r=e.retainedBytes();
    expect(r.total).toBeLessThanOrEqual(50*1024*1024);
    expect(tileAccumBytes()).toBeGreaterThan(0);
    expect(tileAccumBytes()).toBeLessThanOrEqual(tileAccumBudget());
    expect(accumCount()).toBeGreaterThan(128); // vernier + some tile accums
  },120000);

  it('expected spectrum: bounded ON vs OFF ≤ 0.01 dB (RES2 FULLBAND, 3 contacts)',()=>{
    function collect(on:boolean){
      setBoundedTileAccums(on);
      const e=new AcousticEngine(scen(2,3),303) as any,out=new Float32Array(4096),rows=new Map<string,Float64Array>();
      const subs=e.scenario.buoys.flatMap((b:any)=>['NB','BB'].map(f=>({
        key:`${b.id}|${f}`,c:e.subscribe({channel:b.rfChannel,kind:'lofar',res:2,filter:f,fullAxis:true,visibleTileIndex:0}),
      })));
      for(let k=1;k<=48;k++){e.advance(.25);for(const x of subs){const sub=e.subscriptions.get(x.c.streamId);
        while(e.rowsReady(x.c.streamId)>0){const job=sub.fullAxis.queue[0];e.writeRow(x.c.streamId,out);
          rows.set(`${x.key}|${job.rowKey}|${job.tileIndex}`,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}}}
      return rows;
    }
    const a=collect(false),b=collect(true);let max=0,n=0;
    expect(b.size).toBe(a.size);
    for(const [k,ra] of a){const rb=b.get(k)!;for(let i=0;i<ra.length;i++){const d=Math.abs(10*Math.log10(rb[i]!/ra[i]!));if(Number.isFinite(d)){max=Math.max(max,d);n++;}}}
    console.log('bounded tileAccum ON vs OFF maxDb',max,'bins',n);
    expect(n).toBeGreaterThan(1000);expect(max).toBeLessThanOrEqual(0.01);
  },180000);

  it('budget 0 allocates no tile accums (history path only)',()=>{
    setTileAccumBudget(0);setBoundedTileAccums(true);
    const e=new AcousticEngine(scen(4,1),303) as any;
    for(const b of e.scenario.buoys)e.subscribe({channel:b.rfChannel,kind:'lofar',res:2,filter:'NB',fullAxis:true,visibleTileIndex:0});
    expect(tileAccumBytes()).toBe(0);
  });
});
