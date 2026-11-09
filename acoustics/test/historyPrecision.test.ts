import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {f16round,quantizeFloat16Db,quantizeUint8Db,quantizeFloat16Linear} from '../src/historyQuantize.js';

describe('history precision cold-store helpers (Task A)',()=>{
 it('f16round matches Math.f16round when present',()=>{
  const native=(Math as unknown as {f16round?:(n:number)=>number}).f16round;
  for(const x of [0,1,-1,60.5,120.25,65504,1e-7]){
   const a=f16round(x),b=typeof native==='function'?native(x):a;
   expect(Object.is(a,b)||a===b).toBe(true);
  }
 });
 it('Float16-dB round-trip stays within ~0.06 dB near gram levels',()=>{
  const row=Float32Array.from([40,55,70,85,100,120]);
  const q=quantizeFloat16Db(row);
  let max=0;for(let i=0;i<row.length;i++)max=Math.max(max,Math.abs(row[i]-q[i]));
  expect(max).toBeLessThan(0.1);
 });
 it('Uint8-dB uses 80 dB span (~0.31 dB/step)',()=>{
  const row=Float32Array.from([40,80,120]);
  const q=quantizeUint8Db(row,40,80);
  expect(q[0]).toBeCloseTo(40,5);
  expect(Math.abs(q[1]-80)).toBeLessThan(0.4);
 });
 it('Float16-linear overflows on ordinary gram powers',()=>{
  const row=Float32Array.from([60,80,100]);
  const r=quantizeFloat16Linear(row);
  expect(r.overflows).toBeGreaterThan(0);
  expect(r.maxLin).toBeGreaterThan(65504);
 });
 it('checked-in results JSON carries Float16-ok / Uint8-contrast-loss verdict (lazy)',()=>{
  const path=new URL('../bench/results/history-precision.json',import.meta.url);
  expect(existsSync(path)).toBe(true);
  const j=JSON.parse(readFileSync(path,'utf8'));
  expect(j.verdict.float16Db.ok).toBe(true);
  expect(j.verdict.float16Db.losesAnythingMeasurable).toBe(false);
  expect(j.verdict.uint8Db.losesAnythingMeasurable).toBe(true);
  expect(j.verdict.float16Linear.mustStoreDb).toBe(true);
  expect(j.contrast.uint8.spanDb).toBe(80);
  expect(String(j.note)).toMatch(/cold-store|page-back|hot ring/i);
 });
});
