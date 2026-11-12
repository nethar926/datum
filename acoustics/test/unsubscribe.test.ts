/** AcousticEngine.unsubscribe + idempotent subscribeDemon, mirrored from Swift UnsubscribeTests. */
import {it,expect,describe} from 'vitest';
import {AcousticEngine,cpaScenario} from '../src/index.js';
import type {ScenarioInput} from '../src/scenario.js';

function engine(detuneBuoy?:number):AcousticEngine{
  const s=cpaScenario();
  s.time=0;s.contacts=s.contacts.slice(0,2);
  const t=s.buoys[0];
  s.buoys=[
    {...t,id:'buoy-1',rfChannel:detuneBuoy===1?0:1,x:0,y:0,deployedAt:0,life:1e6},
    {...t,id:'buoy-2',rfChannel:detuneBuoy===2?0:2,x:3000,y:0,deployedAt:0,life:1e6},
  ];
  return new AcousticEngine(s as ScenarioInput,s.seed);
}

function collect(e:AcousticEngine,id:number,ticks:number,bins:number,also?:number):Map<number,number[]>{
  const rows=new Map<number,number[]>(),out=new Float32Array(bins);
  const extra=also!==undefined?new Float32Array(Math.max(bins,e.configs().find(c=>c.streamId===also)?.bins??bins)):undefined;
  for(let t=0;t<ticks;t++){
    e.advance(.25);
    if(also!==undefined&&extra){while(e.rowsReady(also)>0)e.writeRow(also,extra);}
    while(e.rowsReady(id)>0){const i=e.writeRow(id,out);rows.set(i,Array.from(out));}
  }
  return rows;
}
function eqRows(a:Map<number,number[]>,b:Map<number,number[]>){
  expect(a.size).toBe(b.size);
  for(const [k,v] of a)expect(v).toEqual(b.get(k));
}

describe('unsubscribe and idempotent subscribeDemon',()=>{
  it('unknown id is a no-op and does not throw',()=>{
    const e=engine();
    expect(e.unsubscribe(0)).toBe(false);
    expect(e.unsubscribe(9999)).toBe(false);
    expect(e.configs()).toEqual([]);
    expect(e.rowsReady(9999)).toBe(0);
    const c=e.subscribe({channel:1,kind:'lofar'});
    expect(e.unsubscribe(c.streamId+100)).toBe(false);
    expect(e.configs().map(x=>x.streamId)).toEqual([c.streamId]);
    expect(e.unsubscribe(c.streamId)).toBe(true);
    expect(e.unsubscribe(c.streamId)).toBe(false);
    expect(e.configs()).toEqual([]);
    expect(e.rowsReady(c.streamId)).toBe(0);
  });

  it('re-subscribe of the same buoy and band returns the existing id',()=>{
    const e=engine();
    const a=e.subscribe({kind:'demon',buoyId:1});
    expect(e.subscribe({kind:'demon',buoyId:1})).toBe(a);
    expect(e.subscribe({kind:'demon',buoyId:1,band:[1000,4000]})).toBe(a);
    expect(e.configs().filter(c=>c.kind==='demon').map(c=>c.streamId)).toEqual([a]);
    const other=e.subscribe({kind:'demon',buoyId:1,band:[500,2000]});
    expect(other).not.toBe(a);
    const buoy2=e.subscribe({kind:'demon',buoyId:2});
    expect(buoy2).not.toBe(a);
    expect(e.subscribe({kind:'demon',buoyId:2})).toBe(buoy2);
    expect(e.unsubscribe(a)).toBe(true);
    const again=e.subscribe({kind:'demon',buoyId:1});
    expect(again).not.toBe(a);
    expect(e.subscribe({kind:'demon',buoyId:1})).toBe(again);
    e.unsubscribe(again);e.unsubscribe(other);e.unsubscribe(buoy2);
    expect(e.configs().filter(c=>c.kind==='demon')).toEqual([]);
  });

  it('detuned still throws; invalid band and unknown buoy still throw',()=>{
    const e=engine(1);
    expect(()=>e.subscribe({kind:'demon',buoyId:1})).toThrow(/detuned/i);
    expect(e.configs()).toEqual([]);
    expect(()=>e.subscribe({kind:'demon',buoyId:2,band:[0,10]})).toThrow(/Invalid DEMON/);
    expect(()=>e.subscribe({kind:'demon',buoyId:99})).toThrow(/Unknown buoyId/);
    const ok=e.subscribe({kind:'demon',buoyId:2});
    expect(e.subscribe({kind:'demon',buoyId:2})).toBe(ok);
    expect(()=>e.subscribe({kind:'demon',buoyId:1})).toThrow(/detuned/i);
    expect(e.configs().map(c=>c.streamId)).toEqual([ok]);
  });

  it('500-cycle DEMON subscribe/unsubscribe churn leaves stream count bounded',()=>{
    const e=engine();
    const warm=e.subscribe({kind:'demon',buoyId:1});
    expect(e.unsubscribe(warm)).toBe(true);
    let maxCount=0;
    for(let i=0;i<500;i++){
      const buoyId=(i%2)+1;
      const id=e.subscribe({kind:'demon',buoyId});
      maxCount=Math.max(maxCount,e.configs().length);
      expect(e.subscribe({kind:'demon',buoyId})).toBe(id);
      expect(e.configs().filter(c=>c.kind==='demon')).toHaveLength(1);
      expect(e.unsubscribe(id)).toBe(true);
      expect(e.configs().filter(c=>c.kind==='demon')).toHaveLength(0);
    }
    expect(maxCount).toBeLessThanOrEqual(1);
    expect(e.configs()).toEqual([]);
  });

  it('remaining LOFAR/DEMON rows are bit-exact after removing another stream',()=>{
    const cases:[string,(e:AcousticEngine)=>{keep:number;drop:number;bins:number}][]=[
      ['LOFAR kept, DEMON removed',e=>{const keep=e.subscribe({channel:1,kind:'lofar'});const drop=e.subscribe({kind:'demon',buoyId:1});return {keep:keep.streamId,drop,bins:keep.bins};}],
      ['DEMON kept, LOFAR removed',e=>{const keep=e.subscribe({kind:'demon',buoyId:1});const drop=e.subscribe({channel:1,kind:'lofar'}).streamId;return {keep,drop,bins:512};}],
      ['LOFAR buoy-1 kept, LOFAR buoy-2 removed',e=>{const keep=e.subscribe({channel:1,kind:'lofar'});const drop=e.subscribe({channel:2,kind:'lofar'});return {keep:keep.streamId,drop:drop.streamId,bins:keep.bins};}],
      ['DEMON buoy-1 kept, DEMON buoy-2 removed',e=>{const keep=e.subscribe({kind:'demon',buoyId:1});const drop=e.subscribe({kind:'demon',buoyId:2});return {keep,drop,bins:512};}],
    ];
    for(const [name,setup] of cases){
      const a=engine(),b=engine();
      const {keep:keepA,drop:dropA,bins}=setup(a);
      const {keep:keepB,drop:dropB}=setup(b);
      expect(b.unsubscribe(dropB)).toBe(true);
      const beforeA=collect(a,keepA,8,bins,dropA);
      const beforeB=collect(b,keepB,8,bins);
      eqRows(beforeA,beforeB);
      expect(a.unsubscribe(dropA)).toBe(true);
      expect(a.rowsReady(dropA)).toBe(0);
      const afterA=collect(a,keepA,12,bins);
      const afterB=collect(b,keepB,12,bins);
      expect(afterA.size).toBeGreaterThan(0);
      eqRows(afterA,afterB);
      void name;
    }
  });

  it('LOFAR is not idempotent; band cache is released when the last ref unsubscribes',()=>{
    const e=engine();
    const a=e.subscribe({channel:1,kind:'lofar',band:[0,200]});
    const b=e.subscribe({channel:1,kind:'lofar',band:[0,200]});
    expect(a.streamId).not.toBe(b.streamId);
    expect(e.lofarBandCacheSize()).toBe(1);
    expect(e.unsubscribe(a.streamId)).toBe(true);
    expect(e.lofarBandCacheSize()).toBe(1);
    expect(e.unsubscribe(b.streamId)).toBe(true);
    expect(e.lofarBandCacheSize()).toBe(0);
    const c=e.subscribe({channel:1,kind:'lofar',band:[0,200]});
    expect(c.streamId).not.toBe(a.streamId);
    expect(e.lofarBandCacheSize()).toBe(1);
    e.unsubscribe(c.streamId);
    expect(e.lofarBandCacheSize()).toBe(0);
  });

  it('RES is not idempotent; remaining RES rows stay exact after removing another',()=>{
    const a=engine(),b=engine();
    const aKeep=a.subscribe({channel:1,res:5,filter:'NB'});
    const aDrop=a.subscribe({channel:2,res:9,filter:'NB'});
    const bKeep=b.subscribe({channel:1,res:5,filter:'NB'});
    expect(a.subscribe({channel:1,res:5,filter:'NB'}).streamId).not.toBe(aKeep.streamId);
    a.unsubscribe(a.configs().find(c=>c.streamId!==aKeep.streamId&&c.streamId!==aDrop.streamId)!.streamId);
    const beforeA=collect(a,aKeep.streamId,6,aKeep.bins,aDrop.streamId);
    const beforeB=collect(b,bKeep.streamId,6,bKeep.bins);
    eqRows(beforeA,beforeB);
    expect(a.unsubscribe(aDrop.streamId)).toBe(true);
    const afterA=collect(a,aKeep.streamId,8,aKeep.bins);
    const afterB=collect(b,bKeep.streamId,8,bKeep.bins);
    expect(afterA.size).toBeGreaterThan(0);
    eqRows(afterA,afterB);
  });
});
