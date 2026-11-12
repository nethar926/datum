/** rowPhaseS = sim time of row index 0; rowTime(k)=rowPhaseS+k/rowRateHz equals each emitted row's sim time. */
import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,resParams} from '../src/index.js';
import type {ResLevel,GramConfig} from '../src/protocol.js';

function scenario(n=1, deployedAt=0){
  const s=cpaScenario();
  s.buoys=Array.from({length:n},(_,i)=>({...s.buoys[0],id:`buoy-${i+1}`,rfChannel:i+1,x:i*400,y:0,deployedAt}));
  return s;
}

const rowTime=(c:{rowPhaseS?:number;rowRateHz:number},k:number)=>c.rowPhaseS!+k/c.rowRateHz;

/** Advance exactly to each successive rowTime and drain the single due row. For deferUndeployed,
 *  aboard rows are skipped; start at the first k with rowTime(k) >= deployedAt (and >= current time). */
function collectExact(e:AcousticEngine,id:number,c:Pick<GramConfig,'rowPhaseS'|'rowRateHz'|'bins'>,count:number,deployedAt=0){
  const out=new Float32Array(c.bins),rows:{k:number;t:number}[]=[];
  let k=0;
  while(rowTime(c,k)<deployedAt||rowTime(c,k)<e.time-1e-12)k++;
  for(let n=0;n<count;n++,k++){
    const t=rowTime(c,k);
    while(e.time<t-1e-12)e.advance(Math.min(0.25,t-e.time));
    expect(e.time).toBeCloseTo(t, 9);
    expect(e.rowsReady(id)).toBeGreaterThanOrEqual(1);
    const got=e.writeRow(id,out);
    expect(got).toBe(k);
    rows.push({k:got,t:e.time});
  }
  return rows;
}

function expectRowTimes(c:{rowPhaseS?:number;rowRateHz:number},rows:{k:number;t:number}[]){
  expect(c.rowPhaseS).toBeDefined();
  expect(c.rowRateHz).toBeGreaterThan(0);
  expect(rows.length).toBeGreaterThan(0);
  for(const {k,t} of rows)expect(t).toBeCloseTo(rowTime(c,k), 9);
}

describe('rowPhaseS / rowRateHz (sim time of row 0)',()=>{
  for(const res of [1,5] as ResLevel[]){
    const P=resParams(res).rowPeriodS, rate=resParams(res).rowRateHz;
    it(`RES${res}: rowTime(k)=rowPhaseS+k/rowRateHz at default subscribe`,()=>{
      const e=new AcousticEngine(scenario()),c=e.subscribe({channel:1,res});
      expect(c.rowRateHz).toBe(rate);
      expect(c.rowRateHz).toBe(1/P);
      // Single buoy at t=0, stagger 0: first row tEnd is P.
      expect(c.rowPhaseS).toBe(P);
      expectRowTimes(c, collectExact(e,c.streamId,c,4));
    });

    it(`RES${res}: late subscribe — clock starts at subscribe-time grid, formula holds`,()=>{
      const e=new AcousticEngine(scenario());
      e.advance(5);
      const c=e.subscribe({channel:1,res});
      expect(c.rowRateHz).toBe(rate);
      const stagger=0,start=Math.floor((5-stagger)/P+1e-9)*P+stagger;
      expect(c.rowPhaseS).toBe(start+P);
      expect(c.rowPhaseS).toBeGreaterThan(5-1e-9);
      const rows=collectExact(e,c.streamId,c,4);
      expect(rows[0]!.k).toBe(0);
      expect(rows[0]!.t).toBe(c.rowPhaseS);
      expectRowTimes(c, rows);
    });

    it(`RES${res}: deferUndeployed — first live row keeps the t=0 clock (same index and time)`,()=>{
      const deployedAt=20;
      const e=new AcousticEngine(scenario(1,deployedAt),undefined,{deferUndeployed:true});
      const c=e.subscribe({channel:1,res});
      expect(c.rowPhaseS).toBe(P); // same as a t=0 subscribe; defer does not restart the clock
      expect(c.rowRateHz).toBe(rate);
      const rows=collectExact(e,c.streamId,c,4,deployedAt);
      expect(rows[0]!.t).toBeGreaterThanOrEqual(deployedAt);
      expect(rows[0]!.k).toBeGreaterThan(0);
      expectRowTimes(c, rows);
    });
  }

  it('LOFAR and DEMON expose the same contract (rowRateHz=4)',()=>{
    const e=new AcousticEngine(scenario());
    const lofar=e.subscribe({channel:1});
    const demon=e.streamConfig(e.subscribe({kind:'demon',buoyId:1}) as number);
    expect(lofar.rowRateHz).toBe(4);
    expect(demon.rowRateHz).toBe(4);
    expect(lofar.rowPhaseS).toBe(0.25);
    expect(demon.rowPhaseS).toBe(0.25);
    expectRowTimes(lofar, collectExact(e,lofar.streamId,lofar,8));
    // Same engine already at t=2; DEMON rows 0..7 were due in parallel — drain the backlog at exact times
    // via a fresh engine so we land on each DEMON tEnd.
    const e2=new AcousticEngine(scenario());
    const d2=e2.streamConfig(e2.subscribe({kind:'demon',buoyId:1}) as number);
    expect(d2.rowPhaseS).toBe(0.25);
    expectRowTimes(d2, collectExact(e2,d2.streamId,d2,8));
  });

  it('LOFAR and DEMON late subscribe',()=>{
    const e=new AcousticEngine(scenario());
    e.advance(1.1);
    const lofar=e.subscribe({channel:1});
    expect(lofar.rowPhaseS).toBe(1.25);
    expectRowTimes(lofar, collectExact(e,lofar.streamId,lofar,8));

    const e2=new AcousticEngine(scenario());
    e2.advance(1.1);
    const demon=e2.streamConfig(e2.subscribe({kind:'demon',buoyId:1}) as number);
    expect(demon.rowPhaseS).toBe(1.25);
    expectRowTimes(demon, collectExact(e2,demon.streamId,demon,8));
  });

  it('streamConfig matches subscribe gramConfig and throws on unknown id',()=>{
    const e=new AcousticEngine(scenario());
    const c=e.subscribe({channel:1,res:5});
    expect(e.streamConfig(c.streamId)).toEqual(c);
    expect(()=>e.streamConfig(999)).toThrow(/Unknown streamId/);
  });
});
