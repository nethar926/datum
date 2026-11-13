import {describe,it,expect} from 'vitest';
import {
  AcousticEngine, cpaScenario, soundSpeed, btProfile, dropBtBuoy, btProfileFromWaterColumn,
  buildWaterColumn, fictionalSignature,
} from '../src/index.js';

function dcDzSignChange(profile:{depthM:number;cMps:number}[]):number|undefined {
  for (let i=1;i<profile.length-1;i++) {
    const z0=profile[i-1]!.depthM, z1=profile[i]!.depthM, z2=profile[i+1]!.depthM;
    const s0=(profile[i]!.cMps-profile[i-1]!.cMps)/(z1-z0);
    const s1=(profile[i+1]!.cMps-profile[i]!.cMps)/(z2-z1);
    if (s0>0 && s1<0) return profile[i]!.depthM;
  }
  return undefined;
}

describe('BT / SSP profile (Mackenzie 1981)',()=>{
  it('matches published Mackenzie check values within the stated tolerance',()=>{
    // Mackenzie (1981) nine-term check: T=25 °C, S=35 PSU, D=1000 m → 1550.744 m/s.
    // Stated formula tolerance is 0.07 m/s over the validity domain; the published
    // check value itself is given to 0.001 m/s. We hold 5e-4 m/s on the check point.
    expect(Math.abs(soundSpeed(25,35,1000)-1550.744)).toBeLessThanOrEqual(5e-4);
    expect(soundSpeed(0,35,0)).toBeCloseTo(1448.96,2);
  });

  it('is deterministic by seed; depths are monotonic; layer = dc/dz sign change',()=>{
    const a=btProfile(11), b=btProfile(11), c=btProfile(17);
    expect(a).toEqual(b);
    expect(a.profile.length).toBeGreaterThan(8);
    expect(c.layerDepthM).not.toBe(a.layerDepthM);
    const zs=a.profile.map(s=>s.depthM);
    for (let i=1;i<zs.length;i++) expect(zs[i]!).toBeGreaterThan(zs[i-1]!);
    for (const s of a.profile) {
      expect(s.cMps).toBeCloseTo(soundSpeed(s.tempC,s.salPsu,s.depthM),10);
    }
    // Isothermal mixed layer: T constant, c rises with pressure.
    const mixed=a.profile.filter(s=>s.depthM<=a.layerDepthM+1e-12);
    expect(mixed.length).toBeGreaterThan(1);
    for (const s of mixed) expect(s.tempC).toBeCloseTo(mixed[0]!.tempC,10);
    for (let i=1;i<mixed.length;i++) expect(mixed[i]!.cMps).toBeGreaterThan(mixed[i-1]!.cMps);

    const sign=dcDzSignChange(a.profile);
    expect(sign).toBeDefined();
    expect(a.sonicLayerDepthM).toBe(sign);
    expect(a.layerDepthM).toBeLessThanOrEqual(a.sonicLayerDepthM);
    expect(a.sonicLayerDepthM).toBeLessThanOrEqual(a.thermoclineBaseM);
    // Deep channel axis is the c minimum when a deeper sample has higher c.
    if (a.thermoclineBaseM<a.profile.at(-1)!.depthM-1e-9) {
      expect(a.deepChannelAxisM).toBeDefined();
      expect(a.deepChannelAxisM).toBeGreaterThanOrEqual(a.sonicLayerDepthM);
    }
  });

  it('dropBtBuoy returns the profile and does not add a BT to scenario.buoys',()=>{
    const s=cpaScenario();
    s.surfacePool=[];s.surfaceTraffic=0;
    const n=s.buoys.length;
    const drop=dropBtBuoy(s,{x:100,y:-40,id:9});
    expect(drop.id).toBe(9);
    expect(drop.x).toBe(100);
    expect(drop.y).toBe(-40);
    expect(drop.profile.profile.length).toBeGreaterThan(8);
    expect(s.buoys).toHaveLength(n);

    const e=new AcousticEngine(s);
    const n2=e.scenario.buoys.length;
    const d2=e.dropBtBuoy({x:0,y:0});
    expect(d2.profile.sonicLayerDepthM).toBe(e.btProfile().sonicLayerDepthM);
    expect(e.scenario.buoys).toHaveLength(n2);
    expect(()=>e.dropBuoy({kind:'bt' as 'difar',channel:2,x:0,y:0,hydrophoneDepthM:30})).toThrow(/pending approved plan/);
  });

  it('wraps an existing waterColumn without regenerating the shape',()=>{
    const wc=buildWaterColumn({surfaceTempC:18,deepTempC:6,salinityPsu:35,maxDepthM:800,mixedLayerDepthM:50,thermoclineThicknessM:200,samples:41});
    const p=btProfileFromWaterColumn(wc);
    expect(p.layerDepthM).toBe(wc.mixedLayerDepthM);
    expect(p.thermoclineBaseM).toBe(wc.thermoclineBaseM);
    expect(p.profile).toHaveLength(wc.depthM.length);
    expect(btProfile({seed:3,waterColumn:wc}).profile).toEqual(p.profile);
  });
});
