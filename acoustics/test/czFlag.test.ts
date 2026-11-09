import {describe,it,expect} from 'vitest';
import {
  AcousticEngine,buildWaterColumn,attachWaterColumn,cpaScenario,knotsToMps,
  SIM_STREAM_SET,parseLofarStreamId,vernierHzForBand,
  estimateConvergenceZone,czPropagationGainLinear,DEFAULT_CZ_ENABLED,
  catalog,
} from '../src/index.js';
import type {ScenarioInput} from '../src/scenario.js';

function deepWaterScenario(seed:number,atCzRange:boolean):ScenarioInput {
  const deep=buildWaterColumn({surfaceTempC:20,deepTempC:2,salinityPsu:35,maxDepthM:5000,mixedLayerDepthM:50,thermoclineThicknessM:800,samples:128});
  const s=cpaScenario();
  s.seed=seed;s.bins=512;s.fmax=s.fMax=1000;s.fBin=1000/511;s.band=[0,1000];
  s.environment={...s.environment,seaState:2,shipping:'light',soundSpeed:1500,spreading:'spherical',transition:1000};
  s.environment.temperatureC=20;s.environment.salinityPsu=35;
  s.waterColumn=attachWaterColumn(s.environment,deep);
  const klass=catalog.classes.find(c=>c.plant==='nuclear')!;
  const cz=estimateConvergenceZone({profile:deep,zsM:80,zrM:100,bottomDepthM:5000});
  expect(cz.possible).toBe(true);
  const range=atCzRange?cz.rangeM!:5_000; // near CZ vs near field
  // Place contact at `range` along +x, heading outbound slowly so geometry is stable across a few rows.
  const contact={
    id:'cz-contact',category:'subsurface' as const,classificationTarget:true,
    catalogRef:{classId:klass.id,variantId:'base',hullId:klass.hulls[0].id},
    operatingMode:'NUC' as const,x:range,y:0,depth:80,course:Math.PI/2,speed:knotsToMps(4),
    motion:[{at:0,course:Math.PI/2,speed:knotsToMps(4),depth:80}],
  };
  s.surfaceTraffic=0;s.buoys[0].depth=100;
  const out:ScenarioInput={...s,contacts:[contact]};
  return out;
}

function hashStreams(engine:AcousticEngine,rows=3):Record<string,number> {
  const out:Record<string,number>={};
  const opened:number[]=[];
  for(const id of SIM_STREAM_SET){
    if(id==='waterColumn'||id==='truth'||id==='difarBearing'){
      // Logical streams: hash environment + CZ chrome flag path
      const env=engine.scenario.environment;
      const wc=engine.scenario.waterColumn;
      let h=2166136261;
      const mix=(n:number)=>{h^=(n|0);h=Math.imul(h,16777619);};
      mix(env.propagation?.czEnabled?1:0);
      mix(env.propagation?.czForceGainLinear!==undefined?Math.floor(env.propagation.czForceGainLinear*1e6):0);
      if(id==='waterColumn'&&wc){mix(wc.depthM.length);mix(Math.floor(wc.soundSpeedMps[0]*100));}
      if(id==='truth'){const t=engine.tactical();mix(t.truth?.contacts.length??0);mix(Math.floor((t.truth?.contacts[0]?.x??0)));}
      if(id==='difarBearing'){mix(engine.scenario.buoys[0].type==='difar'?1:0);}
      out[id]=h>>>0;continue;
    }
    if(id==='demon'){
      const sid=engine.subscribe({kind:'demon',buoyId:1});opened.push(sid);
      const buf=new Float32Array(512);let h=2166136261;
      for(let r=0;r<rows;r++){engine.step(.25);engine.writeRow(sid,buf);for(let i=0;i<buf.length;i++){h^=Math.floor(buf[i]*1e3)|0;h=Math.imul(h,16777619);}}
      out[id]=h>>>0;continue;
    }
    const parsed=parseLofarStreamId(id);if(!parsed)continue;
    const cfg=engine.subscribe({channel:1,kind:'lofar',res:5,filter:parsed.filter,vernierHz:vernierHzForBand(parsed.bandPreset)});
    opened.push(cfg.streamId);
    const buf=new Float32Array(cfg.bins);let h=2166136261;
    for(let r=0;r<rows;r++){engine.step(.25);engine.writeRow(cfg.streamId,buf);for(let i=0;i<buf.length;i+=8){h^=Math.floor(buf[i]*1e3)|0;h=Math.imul(h,16777619);}}
    out[id]=h>>>0;
  }
  for(const sid of opened)try{engine.unsubscribe(sid);}catch{/* */}
  return out;
}

describe('CZ propagation flag (default OFF)',()=>{
  it('DEFAULT_CZ_ENABLED is false; gain is 1 when disabled or forceZero',()=>{
    expect(DEFAULT_CZ_ENABLED).toBe(false);
    const deep=buildWaterColumn({surfaceTempC:20,deepTempC:2,salinityPsu:35,maxDepthM:5000,samples:96});
    const est=estimateConvergenceZone({profile:deep,zsM:50,zrM:100,bottomDepthM:5000});
    expect(est.possible).toBe(true);
    expect(czPropagationGainLinear(est.rangeM!,est,{enabled:false})).toBe(1);
    expect(czPropagationGainLinear(est.rangeM!,est,{enabled:true,forceZero:true})).toBe(1);
    expect(czPropagationGainLinear(est.rangeM!,est,{enabled:true})).toBeGreaterThan(100);
  });

  it('every SIM_STREAM_SET stream is hash-identical: CZ disabled ≡ forceGain 1 (zero boost)',()=>{
    const audio=SIM_STREAM_SET.filter(id=>id==='demon'||id.startsWith('lofar/'));
    for(const seed of [11,42,99]){
      const base=deepWaterScenario(seed,true);
      const a=structuredClone(base);a.environment={...a.environment,propagation:{czEnabled:false}};
      const b=structuredClone(base);b.environment={...b.environment,propagation:{czEnabled:true,czForceGainLinear:1}};
      // Also exercise forceZero helper path identity vs disabled.
      expect(czPropagationGainLinear(60_000,estimateConvergenceZone({profile:base.waterColumn!,zsM:80,zrM:100,bottomDepthM:5000}),{enabled:true,forceZero:true})).toBe(1);
      const ha=hashStreams(new AcousticEngine(a,seed));
      const hb=hashStreams(new AcousticEngine(b,seed));
      expect(Object.keys(ha).sort()).toEqual([...SIM_STREAM_SET].sort());
      for(const id of audio)expect(ha[id],id).toBe(hb[id]);
    }
  });

  it('enabling CZ changes deep-water-at-CZ-range streams; near-field unchanged vs disabled',()=>{
    const seed=77;
    const deep=deepWaterScenario(seed,true);
    const off=structuredClone(deep);off.environment={...off.environment,propagation:{czEnabled:false}};
    const on=structuredClone(deep);on.environment={...on.environment,propagation:{czEnabled:true}};
    const hoff=hashStreams(new AcousticEngine(off,seed));
    const hon=hashStreams(new AcousticEngine(on,seed));
    // At least one LOFAR/DEMON stream must differ when CZ boost is live.
    const audioIds=SIM_STREAM_SET.filter(id=>id==='demon'||id.startsWith('lofar/'));
    expect(audioIds.some(id=>hoff[id]!==hon[id])).toBe(true);

    const near=deepWaterScenario(seed,false);
    const nearOff=structuredClone(near);nearOff.environment={...nearOff.environment,propagation:{czEnabled:false}};
    const nearOn=structuredClone(near);nearOn.environment={...nearOn.environment,propagation:{czEnabled:true}};
    // Far from CZ annulus → gain≈1 even when enabled → audio hashes match disabled.
    const nearHa=hashStreams(new AcousticEngine(nearOff,seed));
    const nearHb=hashStreams(new AcousticEngine(nearOn,seed));
    for(const id of audioIds)expect(nearHa[id],id).toBe(nearHb[id]);
  });
});
