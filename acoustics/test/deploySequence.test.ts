/** Deploy sequence, mirrored from Swift DeploySequenceTests. Phase is `descending` (not falling). */
import {it,expect,describe} from 'vitest';
import {AcousticEngine,clampParams,generateScenario,
  DEFAULT_DROP_ALTITUDE_M,DEFAULT_DESCENT_RATE_MPS,DEPLOY_HOLD_S,
  fallDurationS,splashTime,liveTime,deployStatus,firstEmitTime} from '../src/index.js';

function engine7(opts?:ConstructorParameters<typeof AcousticEngine>[2]){
  return new AcousticEngine(generateScenario(clampParams({seed:7})),7,opts);
}

describe('deploy sequence (matches Swift DeploySequence)',()=>{
  it('defaults: 1500 ft / 9 m/s → 50.8 s fall; splash = release+1+fall; live = splash+5',()=>{
    const fall=DEFAULT_DROP_ALTITUDE_M/DEFAULT_DESCENT_RATE_MPS;
    expect(fall).toBeCloseTo(50.8,12);
    const b={deployedAt:0,placed:false as const,dropAltitudeM:DEFAULT_DROP_ALTITUDE_M,descentRateMps:DEFAULT_DESCENT_RATE_MPS,integrationTimeS:5};
    expect(fallDurationS(b)).toBe(fall);
    expect(splashTime(b)).toBe(DEPLOY_HOLD_S+fall);
    expect(liveTime(b)).toBe(splashTime(b)+5);
    expect(splashTime({deployedAt:0,placed:true})).toBe(0);
    expect(liveTime({deployedAt:0,placed:true})).toBe(0);
  });

  it('phase walk, fill is of the current phase, splashTime/liveTime absolute',()=>{
    const b={deployedAt:0,placed:false as const,dropAltitudeM:DEFAULT_DROP_ALTITUDE_M,descentRateMps:DEFAULT_DESCENT_RATE_MPS,integrationTimeS:5};
    const splash=splashTime(b),live=liveTime(b),fall=fallDurationS(b);
    expect(deployStatus(-0.1,b).phase).toBe('loaded');
    expect(deployStatus(0,b)).toMatchObject({phase:'deployed',fill:0});
    expect(deployStatus(0.5,b).fill).toBeCloseTo(0.5,15);
    expect(deployStatus(1,b)).toMatchObject({phase:'descending',fill:0,etaSeconds:fall});
    expect(deployStatus(1+fall/2,b).phase).toBe('descending');
    expect(deployStatus(1+fall/2,b).fill).toBeCloseTo(0.5,12);
    expect(deployStatus(splash,b)).toMatchObject({phase:'integrating',fill:0,splashTime:splash,liveTime:live});
    expect(deployStatus(splash+2.5,b).fill).toBeCloseTo(0.5,12);
    expect(deployStatus(live,b)).toMatchObject({phase:'tuned',fill:1,etaSeconds:0,liveTime:live});
    const s2=deployStatus(11,{deployedAt:0,placed:false,dropAltitudeM:100,descentRateMps:10,integrationTimeS:8});
    expect(s2.phase).toBe('integrating');expect(s2.splashTime).toBe(11);expect(s2.liveTime).toBe(19);
  });

  it('placed (default) is live at t=0 with a real first row',()=>{
    const e=engine7();
    expect(e.buoyStartMode).toBe('placed');
    expect(e.scenario.buoys.length).toBeGreaterThan(0);
    for(const b of e.scenario.buoys){
      expect(b.placed).not.toBe(false);
      expect(e.buoyStatus(e.scenario.buoys.indexOf(b),9).phase).toBe('tuned');
    }
    const sid=(e.subscribe({kind:'lofar',channel:e.scenario.buoys[0]!.rfChannel}) as {streamId:number}).streamId;
    e.advance(.25);
    const buf=new Float32Array(4096);
    let seen=false,allNan=true;
    while(e.rowsReady(sid)>0){e.writeRow(sid,buf);seen=true;if(Array.from(buf.subarray(0,e.scenario.bins)).some(Number.isFinite))allNan=false;}
    expect(seen).toBe(true);
    expect(allNan).toBe(false);
  });

  it('default construct is placed and bit-exact to an explicit-placed twin',()=>{
    const a=engine7(),b=engine7({buoyStartMode:'placed'});
    expect(a.buoyStartMode).toBe('placed');
    expect(b.buoyStartMode).toBe('placed');
    expect(a.scenario.buoys.length).toBeGreaterThan(0);
    expect(a.scenario.buoys.length).toBe(b.scenario.buoys.length);
    const ca=a.subscribe({kind:'lofar',channel:a.scenario.buoys[0]!.rfChannel});
    const cb=b.subscribe({kind:'lofar',channel:b.scenario.buoys[0]!.rfChannel});
    const ia=ca.streamId,ib=cb.streamId,na=ca.bins,nb=cb.bins;
    const oa=new Float32Array(na),ob=new Float32Array(nb);
    const ra:number[]=[],rb:number[]=[];
    for(let i=0;i<8;i++){
      a.advance(.25);b.advance(.25);
      while(a.rowsReady(ia)>0){a.writeRow(ia,oa);ra.push(...oa);}
      while(b.rowsReady(ib)>0){b.writeRow(ib,ob);rb.push(...ob);}
    }
    expect(ra.length).toBeGreaterThan(0);
    expect(rb).toEqual(ra);
  });

  it('unplaced has no buoys until drop; drop starts deployed',()=>{
    const raw=generateScenario(clampParams({seed:7}));
    const e=engine7({buoyStartMode:'unplaced'});
    expect(e.buoyStartMode).toBe('unplaced');
    expect(e.scenario.buoys.length).toBe(0);
    expect(raw.buoys.length).toBeGreaterThan(0);
    const id=e.dropBuoy({id:3,channel:3,kind:'difar',x:0,y:0,hydrophoneDepthM:40});
    expect(id).toBe(3);
    expect(e.scenario.buoys.length).toBe(1);
    expect(e.scenario.buoys[0]!.placed).toBe(false);
    const st=e.buoyStatus(0,9);
    expect(st.phase).toBe('deployed');
    expect(st.fill).toBe(0);
    expect(st.splashTime).toBe(splashTime(e.scenario.buoys[0]!));
    expect(st.liveTime).toBe(liveTime(e.scenario.buoys[0]!));
  });

  it('unplaced auto-drop stays planned until a route captures it',()=>{
    const raw=generateScenario(clampParams({seed:7}));
    const e=engine7({buoyStartMode:'unplaced',autoDropPattern:true});
    expect(e.scenario.buoys.length).toBe(raw.buoys.length);
    expect(e.scenario.buoys.every(b=>b.placed===false)).toBe(true);
    expect(e.buoyStatus(0,9).phase).toBe('planned');
    expect(e.buoyStatus(0,9).releaseAt).toBeNull();
    expect(e.buoyStatus(0,9).plannedDrop).toEqual({x:e.scenario.buoys[0]!.x,y:e.scenario.buoys[0]!.y,order:0});
    e.advance(60);
    expect(e.buoyStatus(0,9).phase).toBe('planned');
    expect(e.scenario.buoys[0]!.deployedAt).toBeUndefined();
  });

  it('first live LOFAR row is at/after firstEmitTime; nothing real before live',()=>{
    const e=engine7({buoyStartMode:'unplaced'});
    e.dropBuoy({channel:3,kind:'difar',x:100,y:-50,hydrophoneDepthM:40});
    const b=e.scenario.buoys[0]!;
    const sid=(e.subscribe({kind:'lofar',channel:3}) as {streamId:number}).streamId;
    const first=firstEmitTime(b,0.25);
    let firstReal:number|undefined,anyPre=false;
    const buf=new Float32Array(4096);
    while(e.time<first+1){
      e.advance(.25);
      while(e.rowsReady(sid)>0){
        e.writeRow(sid,buf);
        const real=Array.from(buf.subarray(0,e.scenario.bins)).some(Number.isFinite);
        if(real){if(e.time<first)anyPre=true;if(firstReal===undefined)firstReal=e.time;}
      }
    }
    expect(anyPre).toBe(false);
    expect(firstReal).toBeGreaterThanOrEqual(first-1e-12);
    const pre=engine7({buoyStartMode:'unplaced'});
    pre.dropBuoy({channel:3,kind:'difar',x:100,y:-50,hydrophoneDepthM:40});
    const s2=(pre.subscribe({kind:'lofar',channel:3}) as {streamId:number}).streamId;
    let saw=false;
    while(pre.time+.25<(b.integrationTimeS?liveTime(b):liveTime(b))){
      pre.advance(.25);
      while(pre.rowsReady(s2)>0){
        pre.writeRow(s2,buf);
        if(Array.from(buf.subarray(0,pre.scenario.bins)).some(Number.isFinite))saw=true;
      }
    }
    expect(saw).toBe(false);
  });

  it('per-drop altitude/rate/integration and validation',()=>{
    const e=engine7({buoyStartMode:'unplaced'});
    e.dropBuoy({channel:3,kind:'difar',x:0,y:0,hydrophoneDepthM:40,dropAltitudeM:90,descentRateMps:10,integrationTimeS:8});
    const b=e.scenario.buoys[0]!;
    expect(fallDurationS(b)).toBe(9);
    expect(splashTime(b)).toBe(10);
    expect(liveTime(b)).toBe(18);
    expect(()=>e.dropBuoy({channel:4,kind:'difar',x:0,y:0,hydrophoneDepthM:40,integrationTimeS:4})).toThrow(/integrationTimeS/);
    expect(()=>e.dropBuoy({channel:5,kind:'difar',x:0,y:0,hydrophoneDepthM:40,integrationTimeS:11})).toThrow(/integrationTimeS/);
    expect(()=>e.dropBuoy({channel:6,kind:'difar',x:0,y:0,hydrophoneDepthM:40,descentRateMps:0})).toThrow(/descentRate/);
  });
});
