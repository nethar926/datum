/** AcousticEngine.setTuned, mirrored from Swift SetTunedTests. */
import {it,expect,describe} from 'vitest';
import {AcousticEngine,cpaScenario,MAX_RF_CHANNELS} from '../src/index.js';
import type {ScenarioInput} from '../src/scenario.js';

function engine():AcousticEngine{
  const s=cpaScenario();
  s.time=0;s.contacts=s.contacts.slice(0,2);
  const t=s.buoys[0];
  s.buoys=[
    {...t,id:'buoy-1',type:'difar',rfChannel:1,x:0,y:0,deployedAt:0,life:1e6},
    {...t,id:'buoy-2',type:'difar',rfChannel:2,x:3000,y:0,deployedAt:0,life:1e6},
  ];
  return new AcousticEngine(s as ScenarioInput,s.seed);
}

function bits(e:AcousticEngine,ids:number[],steps:number,alsoDrain:number[]=[]):number[]{
  const out:number[]=[];
  for(let t=0;t<steps;t++){
    e.advance(.25);
    for(const id of alsoDrain){const bins=e.configs().find(c=>c.streamId===id)?.bins??1024;const buf=new Float32Array(bins);while(e.rowsReady(id)>0)e.writeRow(id,buf);}
    for(const id of ids){
      const bins=e.configs().find(c=>c.streamId===id)?.bins??1024;
      const buf=new Float32Array(bins);
      while(e.rowsReady(id)>0){e.writeRow(id,buf);out.push(...buf);}
    }
  }
  return out;
}

describe('setTuned (matches Swift SimEngine.setTuned)',()=>{
  it('detune/retune is idempotent and reports isTuned on buoyStatus',()=>{
    const e=engine();
    expect(e.scenario.buoys[0].rfChannel).toBe(1);
    expect(e.setTuned(1,false)).toBe(0);
    expect(e.scenario.buoys[0].rfChannel).toBe(0);
    expect(e.buoyStatus(0,9).isTuned).toBe(false);
    expect(e.setTuned(1,false)).toBe(0);
    expect(e.lowestFreeChannel()).toBe(1);
    expect(e.setTuned(1,true)).toBe(1);
    expect(e.scenario.buoys[0].rfChannel).toBe(1);
    expect(e.buoyStatus(0,9).isTuned).toBe(true);
    expect(e.setTuned(1,true)).toBe(1);
    expect(()=>e.setTuned(1,true,7)).toThrow(/already tuned/i);
    expect(()=>e.setTuned(99,false)).toThrow(/buoyId/i);
  });

  it('detune drops DEMON via unsubscribe; retune does not reuse the id',()=>{
    const e=engine();
    const d1=e.subscribe({kind:'demon',buoyId:1});
    expect(e.subscribe({kind:'demon',buoyId:1})).toBe(d1);
    const d2=e.subscribe({kind:'demon',buoyId:2});
    const l1=e.subscribe({kind:'lofar',channel:1}).streamId;
    e.setTuned(1,false);
    expect(e.configs().some(c=>c.streamId===d1)).toBe(false);
    expect(e.configs().some(c=>c.streamId===l1)).toBe(true);
    expect(e.configs().some(c=>c.streamId===d2)).toBe(true);
    expect(e.buoyStatusForStream(d1)).toBeUndefined();
    expect(()=>e.subscribe({kind:'demon',buoyId:1})).toThrow(/detuned/i);
    e.setTuned(1,true);
    const d1New=e.subscribe({kind:'demon',buoyId:1});
    expect(d1New).not.toBe(d1);
    e.setTuned(1,false);e.setTuned(1,true);
    const d1Newer=e.subscribe({kind:'demon',buoyId:1});
    expect(d1Newer).not.toBe(d1);
    expect(d1Newer).not.toBe(d1New);
  });

  it('LOFAR and RES fill NaN while detuned and resume on the same ids after retune',()=>{
    const e=engine();
    const lofar=e.subscribe({kind:'lofar',channel:1}).streamId;
    const res=e.subscribe({channel:1,res:9,filter:'NB'}).streamId;
    const buf=new Float32Array(4096);
    for(let i=0;i<4;i++){e.advance(.25);while(e.rowsReady(lofar)>0)e.writeRow(lofar,buf);while(e.rowsReady(res)>0)e.writeRow(res,buf);}
    e.setTuned(1,false);
    let nanRows=0,finite=0;
    for(let i=0;i<4;i++){
      e.advance(.25);
      for(const id of [lofar,res]){
        const n=e.configs().find(c=>c.streamId===id)!.bins;
        while(e.rowsReady(id)>0){
          e.writeRow(id,buf);
          if([...buf.subarray(0,n)].every(Number.isNaN))nanRows++;else finite++;
        }
      }
    }
    expect(nanRows).toBeGreaterThan(0);
    expect(finite).toBe(0);
    e.setTuned(1,true);
    finite=0;
    for(let i=0;i<4;i++){
      e.advance(.25);
      for(const id of [lofar,res]){
        const n=e.configs().find(c=>c.streamId===id)!.bins;
        while(e.rowsReady(id)>0){e.writeRow(id,buf);if([...buf.subarray(0,n)].some(Number.isFinite))finite++;}
      }
    }
    expect(finite).toBeGreaterThan(0);
    expect(e.configs().map(c=>c.streamId).sort()).toEqual([lofar,res].sort());
  });

  it('other buoy rows stay bit-exact after a sibling is detuned',()=>{
    function run(detune:boolean):number[]{
      const e=engine();
      const a=e.subscribe({kind:'lofar',channel:1}).streamId;
      const b=e.subscribe({kind:'lofar',channel:2}).streamId;
      const r2=e.subscribe({channel:2,res:9,filter:'NB'}).streamId;
      const d2=e.subscribe({kind:'demon',buoyId:2});
      if(detune){e.subscribe({kind:'demon',buoyId:1});e.setTuned(1,false);}
      return bits(e,[b,r2,d2],12,[a]);
    }
    const keep=run(false),drop=run(true);
    expect(keep.length).toBeGreaterThan(0);
    expect(keep.length).toBe(drop.length);
    expect(new Uint32Array(new Float32Array(drop).buffer)).toEqual(new Uint32Array(new Float32Array(keep).buffer));
  });

  it('channel conflicts, host channel, and detune after release is the detuned phase',()=>{
    const e=engine();
    e.setTuned(1,false);
    expect(()=>e.setTuned(1,true,2)).toThrow(/already used/i);
    expect(e.setTuned(1,true,7)).toBe(7);
    expect(e.scenario.buoys[0].rfChannel).toBe(7);
    for(let i=0;i<8;i++)e.advance(.25);
    const before=e.buoyStatus(0,9,600);
    expect(before.isTuned).toBe(true);
    expect(before.phase).toBe('tuned');
    e.setTuned(1,false);
    const after=e.buoyStatus(0,9,600);
    expect(after.isTuned).toBe(false);
    expect(after.phase).toBe('detuned');
    expect(after.fill).toBe(1);
    expect(after.etaSeconds).toBe(0);
    expect(after.splashTime).toBe(before.splashTime);
    expect(after.liveTime).toBe(before.liveTime);
    expect(MAX_RF_CHANNELS).toBe(32);
  });
});
