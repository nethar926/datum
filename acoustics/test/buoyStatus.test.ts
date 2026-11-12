/** AcousticEngine.buoyStatus, mirrored from Swift BuoyStatusTests. */
import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,type BuoyPhase} from '../src/index.js';
import type {ResLevel} from '../src/protocol.js';

function engine(dropAt:number){
  const s=cpaScenario();s.time=0;s.fmax=2000;
  s.buoys=[{...s.buoys[0]!,id:'buoy-1',rfChannel:1,deployedAt:0,life:1e6,placed:true},{...s.buoys[0]!,id:'buoy-2',rfChannel:2,x:3000,deployedAt:dropAt,life:1e6,placed:true}];
  return new AcousticEngine(s,303);
}

describe('buoyStatus (matches Swift SimEngine.buoyStatus)',()=>{
  it('placed future deploy is loaded then immediately tuned',()=>{
    const e=engine(10);
    expect(e.buoyStatus(1,9).phase).toBe('loaded');
    expect(e.buoyStatus(1,9).splashTime).toBe(10);
    expect(e.buoyStatus(1,9).liveTime).toBe(10);
    for(let i=0;i<40;i++)e.advance(.25);
    expect(e.time).toBe(10);
    const st=e.buoyStatus(1,9);
    expect(st.phase).toBe('tuned');expect(st.fill).toBe(1);expect(st.etaSeconds).toBe(0);
    expect(e.buoyStatus(0,9).phase).toBe('tuned');
    expect(()=>e.buoyStatus(7,9)).toThrow();
  });

  it('stream query equals the index query; a RES change does not reset; queries are read-only',()=>{
    const run=(query:boolean)=>{
      const e=engine(3),out=new Float32Array(4096),rows:number[]=[];
      for(let k=0;k<12;k++)e.advance(.25);
      const c=e.subscribe({channel:2,res:9,filter:'NB'}) as {streamId:number};
      for(let k=0;k<40;k++){
        e.advance(.25);
        if(query){
          expect(e.buoyStatusForStream(c.streamId,8)).toEqual(e.buoyStatus(1,9,8));
          for(const r of [1,5,9] as ResLevel[]){e.buoyStatus(0,r);e.buoyStatus(1,r);}
        }
        while(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,out);rows.push(...out.subarray(0,1024));}
      }
      if(query){
        const before=e.buoyStatus(1,9,8);
        const c5=e.setGram(c.streamId,{res:5});
        expect(e.buoyStatus(1,9,8)).toEqual(before);
        expect(e.buoyStatusForStream(c5.streamId,8)).toEqual(e.buoyStatus(1,5,8));
        expect(e.buoyStatusForStream(99999)).toBeUndefined();
      }
      return rows;
    };
    const a=run(false),b=run(true);
    expect(a.length).toBeGreaterThan(0);
    expect(new Uint32Array(new Float32Array(b).buffer)).toEqual(new Uint32Array(new Float32Array(a).buffer));
  });
});
