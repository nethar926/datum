/** Shorter soak: RES2×60, pan/seek/RES mix, bounded ON+OFF. Peak ≤ 50 MB; no growth trend. */
import {describe,it,expect,afterEach} from 'vitest';
import {
  setBoundedTileAccums,setTileAccumBudget,setTileAccumPerBuoy,setAccumMaxTiles,ACCUM_MAX_TILES_DEFAULT,
  setResRowPath,
} from '../src/index.js';
import {runSoakAsync} from '../bench/soakMemory.bench.js';

afterEach(()=>{
  setResRowPath('fast');
  setBoundedTileAccums(true);
  setTileAccumBudget(Math.floor(3.2*1024*1024));
  setTileAccumPerBuoy(1);
  setAccumMaxTiles(ACCUM_MAX_TILES_DEFAULT);
});

describe('900s-style memory soak (short)',()=>{
  it('RES2×60 bounded ON: peak acoustic ≤ 50 MB, growth ≈ 0 over 60 s pan/seek/RES',async()=>{
    const r=await runSoakAsync(60,true,60,2);
    expect(r.acousticMB.peak).toBeLessThanOrEqual(50);
    expect(Math.abs(r.acousticMB.growth)).toBeLessThan(0.5); // MB after warm; plateau
    expect(r.sampleCount).toBeGreaterThan(5);
    console.log('soak ON peak/p99/final',r.acousticMB.peak,r.acousticMB.p99,r.acousticMB.final,'peakOp',r.peakOp.op,r.peakOp.phase);
  },600000);

  it('RES2×60 bounded OFF: peak acoustic ≤ 50 MB, growth ≈ 0 over 60 s',async()=>{
    const r=await runSoakAsync(60,false,60,2);
    expect(r.acousticMB.peak).toBeLessThanOrEqual(50);
    expect(Math.abs(r.acousticMB.growth)).toBeLessThan(0.5);
    console.log('soak OFF peak/p99/final',r.acousticMB.peak,r.acousticMB.p99,r.acousticMB.final,'peakOp',r.peakOp.op,r.peakOp.phase);
  },600000);
});
