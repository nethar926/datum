import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,WorkerRuntime} from '../src/index.js';
import type {WorkerResponse} from '../src/index.js';

describe('skipToLatest',()=>{
  it('advances the read cursor without requiring N intermediate writeRows',()=>{
    const e=new AcousticEngine(cpaScenario());
    const c=e.subscribe({channel:1,bandPreset:'MF'});
    const out=new Float32Array(c.bins);
    e.advance(1); // 4 rows due at 4 Hz
    expect(e.rowsReady(c.streamId)).toBe(4);
    const idx=e.skipToLatest(c.streamId,out);
    expect(idx).toBe(3); // latest of the four, zero-based
    expect(e.rowsReady(c.streamId)).toBe(0);
    expect([...out].every(Number.isFinite)).toBe(true);
    // One more advance still scrolls normally.
    e.advance(.25);
    expect(e.rowsReady(c.streamId)).toBe(1);
    expect(e.writeRow(c.streamId,out)).toBe(4);
    expect(e.rowsReady(c.streamId)).toBe(0);
  });

  it('cursor-only form discards the backlog with no generate; dual-subscribe peer untouched',()=>{
    const e=new AcousticEngine(cpaScenario());
    const a=e.subscribe({channel:1,bandPreset:'LF'});
    const b=e.subscribe({channel:1,bandPreset:'MF'}); // dual-subscribe handoff pair
    e.advance(.75); // 3 rows each
    expect(e.rowsReady(a.streamId)).toBe(3);
    expect(e.rowsReady(b.streamId)).toBe(3);
    expect(e.skipToLatest(b.streamId)).toBe(2);
    expect(e.rowsReady(b.streamId)).toBe(0);
    expect(e.rowsReady(a.streamId)).toBe(3); // other stream untouched
    const out=new Float32Array(a.bins);
    expect(e.writeRow(a.streamId,out)).toBe(0);
    expect(e.rowsReady(a.streamId)).toBe(2);
  });

  it('returns -1 when nothing is due; unknown stream throws',()=>{
    const e=new AcousticEngine(cpaScenario());
    const c=e.subscribe({channel:1,bandPreset:'ELF'});
    expect(e.skipToLatest(c.streamId)).toBe(-1);
    expect(()=>e.skipToLatest(999)).toThrow(/Unknown streamId/);
  });

  it('keeps RES phase/path correct: skip then next due row scrolls',()=>{
    const e=new AcousticEngine(cpaScenario());
    const c=e.subscribe({channel:1,res:3}); // P=2 s, rowRate 0.5
    const out=new Float32Array(c.bins);
    e.advance(6); // three 2 s periods from t=0 (RES3 P=2, first row at rowPhaseS=2)
    const ready=e.rowsReady(c.streamId);
    expect(ready).toBeGreaterThanOrEqual(2);
    const idx=e.skipToLatest(c.streamId,out);
    expect(idx).toBe(ready-1);
    expect(e.rowsReady(c.streamId)).toBe(0);
    expect([...out].every(v=>Number.isFinite(v)||Number.isNaN(v))).toBe(true);
    e.advance(1/c.rowRateHz);
    expect(e.rowsReady(c.streamId)).toBe(1);
    expect(e.writeRow(c.streamId,out)).toBe(ready);
  });

  it('proves skip is cheaper than draining: one write vs N writes for same catch-up index',()=>{
    const mk=()=>{
      const e=new AcousticEngine(cpaScenario());
      const c=e.subscribe({channel:1,bandPreset:'VLF'});
      e.advance(2); // 8 rows
      return {e,c,out:new Float32Array(c.bins)};
    };
    const drain=mk();
    let n=0,last=-1;
    while(drain.e.rowsReady(drain.c.streamId)>0){last=drain.e.writeRow(drain.c.streamId,drain.out);n++;}
    expect(n).toBe(8);expect(last).toBe(7);

    const skip=mk();
    expect(skip.e.skipToLatest(skip.c.streamId,skip.out)).toBe(7);
    expect(skip.e.rowsReady(skip.c.streamId)).toBe(0);
    // Same catch-up index; subsequent scroll index matches the drain path.
    drain.e.advance(.25);skip.e.advance(.25);
    expect(drain.e.writeRow(drain.c.streamId,drain.out)).toBe(8);
    expect(skip.e.writeRow(skip.c.streamId,skip.out)).toBe(8);
  });

  it('worker skipToLatest accepts a subscribed stream and rejects unknown ids',()=>{
    const messages:WorkerResponse[]=[];
    const r=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t??[]})));
    r.command({v:1,type:'init',simT:0,seed:42,scenarioId:'cpa-pass'});
    r.command({v:1,type:'subscribe',simT:0,channel:1,bandPreset:'MF'});
    const cfg=messages.filter(m=>m.type==='gramConfig'&&(m as {bandPreset?:string}).bandPreset==='MF').at(-1);
    expect(cfg?.type).toBe('gramConfig');
    if(cfg?.type!=='gramConfig')throw new Error('missing MF config');
    r.tick(.5);
    const rowsBefore=messages.filter(m=>m.type==='gramRows').length;
    r.command({v:1,type:'skipToLatest',simT:r.simT,streamId:cfg.streamId});
    expect(messages.filter(m=>m.type==='error')).toEqual([]);
    expect(messages.filter(m=>m.type==='gramRows').length).toBe(rowsBefore); // no extra batches
    r.command({v:1,type:'skipToLatest',simT:r.simT,streamId:99999});
    expect(messages.at(-1)).toMatchObject({type:'error',message:expect.stringMatching(/Unknown streamId/)});
    // Normal scrolling still works after a no-op skip.
    r.tick(.25);
    expect(messages.filter(m=>m.type==='gramRows').length).toBeGreaterThan(rowsBefore);
  });
});
