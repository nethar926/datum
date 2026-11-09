import {describe,it,expect} from 'vitest';
import {
  stateBroadband,snortBroadbandLevel,waveSlapBroadbandLevel,
  deriveSignature,catalog,updateDerivedSignature,effectiveParams,
} from '../src/index.js';

describe('snort / wave-slap broadband (state-dependent)',()=>{
 it('snort level grows with ERPM load and sea state; zero when idle',()=>{
  expect(snortBroadbandLevel(0,750,3)).toBe(0);
  const lo=snortBroadbandLevel(300,750,2),hi=snortBroadbandLevel(750,750,2);
  expect(hi).toBeGreaterThan(lo);
  expect(snortBroadbandLevel(750,750,5)).toBeGreaterThan(snortBroadbandLevel(750,750,1));
 });

 it('wave-slap grows with speed and sea state',()=>{
  expect(waveSlapBroadbandLevel(0,0)).toBeLessThan(.2);
  expect(waveSlapBroadbandLevel(12,4)).toBeGreaterThan(waveSlapBroadbandLevel(4,1));
 });

 it('SNORK at peri depth activates snort; SURF activates wave-slap; deep BATT neither',()=>{
  const sn=stateBroadband({mode:'SNORK',depthM:12,speedKn:8,erpm:700,seaState:3,periscopeDepthM:14});
  expect(sn.snort.active).toBe(true);expect(sn.snort.level).toBeGreaterThan(0);
  expect(sn.waveSlap.active).toBe(false);
  const su=stateBroadband({mode:'SURF',depthM:0,speedKn:10,erpm:600,seaState:4,periscopeDepthM:14});
  expect(su.waveSlap.active).toBe(true);expect(su.waveSlap.level).toBeGreaterThan(0);
  expect(su.snort.active).toBe(false);
  const ba=stateBroadband({mode:'BATT',depthM:80,speedKn:4,erpm:0,seaState:2,periscopeDepthM:14});
  expect(ba.snort.active).toBe(false);expect(ba.waveSlap.active).toBe(false);
 });

 it('deriveSignature attaches stateBroadband for plantSpec classes',()=>{
  const diesel=catalog.classes.find(c=>c.plant==='diesel')!;
  const s=deriveSignature(diesel,'base',{speedKn:10,depthM:12,mode:'SNORK'});
  s.seaState=3;s.periscopeDepthM=diesel.snorkelDepthM||14;
  updateDerivedSignature(s,effectiveParams(diesel),10,12,'SNORK');
  expect(s.stateBroadband?.snort.active).toBe(true);
 });
});
