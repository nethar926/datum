import {describe,it,expect} from 'vitest';
import {
 buildWaterColumn,attachWaterColumn,soundSpeed,generateScenario,presetToParams,
 MACKENZIE_VALID,mackenzieOutOfRange,DEFAULT_SALINITY_PSU,
} from '../src/index.js';

describe('BT buoy / SSP (Mackenzie)',()=>{
 it('paired BT/SSP share a depth axis; SSP matches Mackenzie check values',()=>{
  // Mackenzie nine-term self-check (T=0,S=35,D=0 → constant term; T=25,S=35,D=1000 → ~1550.74)
  expect(soundSpeed(0,35,0)).toBeCloseTo(1448.96,5);
  expect(soundSpeed(25,35,1000)).toBeCloseTo(1550.744,2);
  const p=buildWaterColumn({surfaceTempC:18,deepTempC:8,salinityPsu:35,maxDepthM:400,samples:41});
  expect(p.depthM.length).toBe(41);
  expect(p.temperatureC.length).toBe(p.soundSpeedMps.length);
  expect(p.depthM[0]).toBe(0);expect(p.depthM.at(-1)).toBe(400);
  expect(p.temperatureC[0]).toBeCloseTo(18,5);
  expect(p.temperatureC.at(-1)!).toBeCloseTo(8,5);
  expect(p.salinityAssumption).toBe('constant');
  expect(p.salinityPsu).toBe(35);
  expect(p.outOfRange.any).toBe(false);
  expect(p.mackenzieValid).toEqual(MACKENZIE_VALID);
  for(let i=0;i<p.depthM.length;i++){
   expect(p.soundSpeedMps[i]).toBeCloseTo(soundSpeed(p.temperatureC[i]!,35,p.depthM[i]!),8);
  }
  for(let i=0;i<p.depthM.length&&p.depthM[i]!<=p.mixedLayerDepthM;i++)expect(p.temperatureC[i]).toBeCloseTo(18,5);
 });
 it('generated scenarios expose waterColumn for FE graphing',()=>{
  const s=generateScenario(presetToParams('regular',11));
  expect(s.waterColumn).toBeTruthy();
  expect(s.environment.temperatureC).toBeTypeOf('number');
  expect(s.environment.salinityPsu).toBeTypeOf('number');
  expect(s.waterColumn!.soundSpeedMps[0]).toBeCloseTo(s.environment.soundSpeed,5);
  expect(s.waterColumn!.salinityAssumption).toBe('constant');
  expect(s.waterColumn!.outOfRange.any).toBe(false);
  const env={soundSpeed:1500,temperatureC:16,salinityPsu:35};
  const p=attachWaterColumn(env);expect(env.soundSpeed).toBe(p.soundSpeedMps[0]);
 });
 it('flags and clamps out-of-range Mackenzie inputs; salinity default is constant 35 ppt',()=>{
  expect(DEFAULT_SALINITY_PSU).toBe(35);
  expect(MACKENZIE_VALID.temperatureC).toEqual([-2,30]);
  expect(MACKENZIE_VALID.salinityPsu).toEqual([25,40]);
  expect(MACKENZIE_VALID.depthM).toEqual([0,8000]);
  expect(mackenzieOutOfRange(15,35,100).any).toBe(false);
  expect(mackenzieOutOfRange(-5,35,0).temperature).toBe(true);
  expect(mackenzieOutOfRange(15,20,0).salinity).toBe(true);
  expect(mackenzieOutOfRange(15,35,9000).depth).toBe(true);

  const hot=buildWaterColumn({surfaceTempC:40,deepTempC:35,salinityPsu:35,maxDepthM:400,samples:16});
  expect(hot.outOfRange.temperature).toBe(true);expect(hot.outOfRange.any).toBe(true);
  expect(hot.temperatureC[0]).toBeLessThanOrEqual(30); // clamped, not extrapolated

  const fresh=buildWaterColumn({surfaceTempC:15,deepTempC:8,salinityPsu:10,maxDepthM:200,samples:16});
  expect(fresh.outOfRange.salinity).toBe(true);
  expect(fresh.salinityPsu).toBe(25); // clamped to Mackenzie floor
  expect(fresh.salinityAssumption).toBe('constant');

  const deep=buildWaterColumn({surfaceTempC:10,deepTempC:4,salinityPsu:35,maxDepthM:12000,samples:16});
  expect(deep.outOfRange.depth).toBe(true);
  expect(deep.depthM.at(-1)!).toBeLessThanOrEqual(8000);

  // S=25 is inside published domain (was previously clamped to 30)
  const brackish=buildWaterColumn({surfaceTempC:12,deepTempC:6,salinityPsu:25,maxDepthM:300,samples:12});
  expect(brackish.outOfRange.salinity).toBe(false);
  expect(brackish.salinityPsu).toBe(25);
  expect(brackish.soundSpeedMps[0]).toBeCloseTo(soundSpeed(12,25,0),8);
 });
});
