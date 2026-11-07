import {describe,it,expect} from 'vitest';
import {buildWaterColumn,attachWaterColumn,soundSpeed,generateScenario,presetToParams} from '../src/index.js';

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
  for(let i=0;i<p.depthM.length;i++){
   expect(p.soundSpeedMps[i]).toBeCloseTo(soundSpeed(p.temperatureC[i]!,35,p.depthM[i]!),8);
  }
  // Mixed layer is isothermal
  for(let i=0;i<p.depthM.length&&p.depthM[i]!<=p.mixedLayerDepthM;i++)expect(p.temperatureC[i]).toBeCloseTo(18,5);
 });
 it('generated scenarios expose waterColumn for FE graphing',()=>{
  const s=generateScenario(presetToParams('regular',11));
  expect(s.waterColumn).toBeTruthy();
  expect(s.environment.temperatureC).toBeTypeOf('number');
  expect(s.environment.salinityPsu).toBeTypeOf('number');
  expect(s.waterColumn!.soundSpeedMps[0]).toBeCloseTo(s.environment.soundSpeed,5);
  const env={soundSpeed:1500,temperatureC:16,salinityPsu:35};
  const p=attachWaterColumn(env);expect(env.soundSpeed).toBe(p.soundSpeedMps[0]);
 });
});
