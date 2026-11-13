import {describe,it,expect} from 'vitest';
import {
  AcousticEngine, cpaScenario, fictionalSignature,
  bfiBandSamplesForBuoy, clampBfiRange, BFI_DEFAULT_BANDS, BFI_BEARING_BINS,
} from '../src/index.js';
import type {Contact} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';
import type {ContactPose} from '../src/autoBearings.js';

function contactAt(id:string,bearingDeg:number,rangeM:number,hz=90):Contact {
  const rad=bearingDeg*Math.PI/180;
  const params={
    ...fictionalSignature,label:id,levelDb:160,tonalRefDb:160,modulation:0,cavitationPower:0,
    tonals:[{family:'motor' as const,hz,power:1}],
  };
  return {
    id,category:'subsurface',classificationTarget:true,
    x:rangeM*Math.sin(rad),y:rangeM*Math.cos(rad),depth:60,course:0,speed:0,
    motion:[{at:0,course:0,speed:0,depth:60}],
    params,
  };
}

function difar():Buoy {
  return {id:'buoy-1',rfChannel:1,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type:'difar'};
}
function omni():Buoy {
  return {...difar(),id:'buoy-2',type:'passive-omni',rfChannel:2};
}

function scenario(contacts:Contact[],buoys:Buoy[]=[difar()]) {
  const s=cpaScenario();
  s.bins=512;s.fmax=2000;s.band=[0,2000];s.seed=7;
  s.environment.seaState=0;s.environment.shipping='light';
  s.contacts=contacts;s.buoys=buoys;s.surfacePool=[];s.surfaceTraffic=0;
  return s;
}

function asPose(c:Contact):ContactPose {
  return {id:c.id,x:c.x,y:c.y,depth:c.depth,course:c.course,speed:c.speed,active:c.active,lines:c.params.tonals,params:c.params};
}

function peakBearing(band:{bearingDeg:number[];levelDb:number[]}):number {
  let i=0;
  for (let k=1;k<band.levelDb.length;k++) if (band.levelDb[k]!>band.levelDb[i]!) i=k;
  return band.bearingDeg[i]!;
}

describe('bfiBandSamples',()=>{
  it('exposes Dorian default bands and clamps inverted or tight ranges',()=>{
    expect(BFI_DEFAULT_BANDS).toEqual([
      {loHz:10,hiHz:100},{loHz:10,hiHz:500},{loHz:100,hiHz:1000},
    ]);
    expect(BFI_BEARING_BINS).toBe(360);
    expect(clampBfiRange({loHz:80,hiHz:20})).toEqual({loHz:20,hiHz:80});
    expect(clampBfiRange({loHz:-10,hiHz:50}).loHz).toBe(0);
    expect(clampBfiRange({loHz:40,hiHz:40})).toEqual({loHz:40,hiHz:41});
  });

  it('is DIFAR only, deterministic by seed, and returns per-band bearingDeg/levelDb',()=>{
    const a=contactAt('alpha',45,400,90);
    const env=scenario([a]).environment;
    const args={buoys:[difar()],buoyId:1,contacts:[asPose(a)],environment:env,seed:7,atSimTime:0,
      bands:[{loHz:10,hiHz:100},{loHz:100,hiHz:1000}]};
    const x=bfiBandSamplesForBuoy(args);
    const y=bfiBandSamplesForBuoy(args);
    expect(x).toEqual(y);
    expect(x.buoyId).toBe(1);
    expect(x.atSimTime).toBe(0);
    expect(x.bands).toHaveLength(2);
    const narrow=x.bands[0]!;
    expect(narrow.loHz).toBe(10);
    expect(narrow.hiHz).toBe(100);
    expect(narrow.freqHz).toBe(55);
    expect(narrow.bearingDeg.length).toBe(narrow.levelDb.length);
    expect(narrow.bearingDeg.length).toBeGreaterThan(0);
    for (let i=1;i<narrow.bearingDeg.length;i++) expect(narrow.bearingDeg[i]!).toBeGreaterThan(narrow.bearingDeg[i-1]!);
    const err=Math.abs(((peakBearing(narrow)-45+540)%360)-180);
    expect(err).toBeLessThan(15);
    // 90 Hz tonal is outside 100–1000, so that band is empty.
    expect(x.bands[1]!.bearingDeg).toEqual([]);

    expect(()=>bfiBandSamplesForBuoy({...args,buoys:[omni()],buoyId:2})).toThrow(/DIFAR only/);
    expect(()=>bfiBandSamplesForBuoy({...args,buoyId:99})).toThrow(/Unknown buoyId/);

    const far=contactAt('alpha',45,8000,90);
    const farArgs={...args,contacts:[asPose(far)]};
    const p=bfiBandSamplesForBuoy(farArgs);
    const q=bfiBandSamplesForBuoy(farArgs);
    expect(p).toEqual(q);
    const r=bfiBandSamplesForBuoy({...farArgs,seed:99});
    expect(r.bands[0]!.bearingDeg).not.toEqual(p.bands[0]!.bearingDeg);
  });

  it('places a peak per contact and AcousticEngine is a stable atSimTime stream',()=>{
    const a=contactAt('alpha',45,400,90);
    const b=contactAt('bravo',120,400,80);
    const s=scenario([a,b]);
    const free=bfiBandSamplesForBuoy({
      buoys:s.buoys,buoyId:1,contacts:[asPose(a),asPose(b)],environment:s.environment,seed:7,atSimTime:0,
      bands:[{loHz:10,hiHz:100}],
    });
    expect(free.bands[0]!.bearingDeg.length).toBeGreaterThanOrEqual(2);

    const e=new AcousticEngine(s);
    const t0=e.time;
    const u=e.bfiBandSamples(1,[{loHz:10,hiHz:100}],0);
    const v=e.bfiBandSamples(1,[{loHz:10,hiHz:100}],0);
    expect(u).toEqual(v);
    expect(e.time).toBe(t0);
    expect(u.bands[0]!.levelDb.length).toBeGreaterThan(0);
    expect(()=>e.bfiBandSamples(1, undefined, 0).bands.length).not.toThrow();
    const defs=e.bfiBandSamples(1, undefined, 0);
    expect(defs.bands).toHaveLength(3);
    expect(defs.bands.map(b=>({loHz:b.loHz,hiHz:b.hiHz}))).toEqual(BFI_DEFAULT_BANDS);
  });
});
