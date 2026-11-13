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

import {
  batteryFracAt,secondsToOfflineAt,linkQualityAt,radioHorizonM,weakSignalByStepping,resolveBuoyPhase,
  buoyDeployStatus,
  WEAK_SIGNAL_ENTER,WEAK_SIGNAL_CLEAR,WEAK_SIGNAL_CLOCK_S,
  BATTERY_DEGRADED,BATTERY_CRITICAL,BATTERY_TERMINATING,
  LINK_ANTENNA_M,LINK_HORIZON_FACTOR,
  DEFAULT_BUOY_LIFE_MIN,
} from '../src/buoyStatus.js';
import {isAlive,isFeeding} from '../src/buoys.js';
import type {PlanePose} from '../src/planeRoute.js';

function pose(x:number,y:number,altM:number):PlanePose{return {x,y,altM,headingRad:0,speedMps:0};}

describe('buoyStatus battery, link, scuttle, hysteresis',()=>{
  it('drains linearly from splash over life; closed-form times hit each battery phase',()=>{
    const b={deployedAt:10,life:100,placed:true as const,x:0,y:0,rfChannel:1};
    // placed: splash = deployedAt = 10
    expect(batteryFracAt(0,b)).toBe(1);
    expect(batteryFracAt(10,b)).toBe(1);
    expect(batteryFracAt(60,b)).toBe(0.5);
    expect(secondsToOfflineAt(10,b)).toBe(100);
    expect(secondsToOfflineAt(60,b)).toBe(50);
    expect(secondsToOfflineAt(110,b)).toBe(0);
    const at=(t:number)=>buoyDeployStatus(t,b);
    expect(at(10).phase).toBe('tuned');
    expect(at(10).batteryFrac).toBe(1);
    // Interior points of each band (0.20/0.05/0.01 * 100 are not binary-exact, so 80/95/99 can sit on the wrong side of <=).
    expect(batteryFracAt(10+(1-BATTERY_DEGRADED)*100,b)).toBeCloseTo(BATTERY_DEGRADED,12);
    expect(at(10+85).phase).toBe('degraded');
    expect(at(10+85).batteryFrac).toBeCloseTo(0.15,12);
    expect(at(10+96).phase).toBe('critical');
    expect(at(10+96).batteryFrac).toBeCloseTo(0.04,12);
    expect(at(10+99.5).phase).toBe('terminating');
    expect(at(10+99.5).batteryFrac).toBeCloseTo(0.005,12);
    expect(at(110).phase).toBe('offline');
    expect(at(110).batteryFrac).toBe(0);
    expect(at(110).secondsToOffline).toBe(0);
    // default life is 240 min
    const d=buoyDeployStatus(0,{deployedAt:0,placed:true,rfChannel:1});
    expect(d.secondsToOffline).toBe(DEFAULT_BUOY_LIFE_MIN*60);
  });

  it('unplaced buoys drain from splashTime, not release',()=>{
    const b={deployedAt:0,life:100,placed:false as const,dropAltitudeM:90,descentRateMps:9,integrationTimeS:5,x:0,y:0,rfChannel:1};
    // fall = 10 s, hold=1, splash=11
    const st=buoyDeployStatus(11,b);
    expect(st.splashTime).toBe(11);
    expect(st.batteryFrac).toBe(1);
    expect(buoyDeployStatus(11+50,b).batteryFrac).toBe(0.5);
    expect(buoyDeployStatus(11+100,b).phase).toBe('offline');
    expect(isAlive(b as any,11+99.9)).toBe(true);
    expect(isAlive(b as any,11+100)).toBe(false);
  });

  it('cuts linkQuality to 0 beyond the radio horizon and is 1 with no plane',()=>{
    const b={x:0,y:0};
    expect(linkQualityAt(b,null)).toBe(1);
    const altM=1000,hTx=altM+LINK_ANTENNA_M,hRx=LINK_ANTENNA_M;
    const R=radioHorizonM(hTx,hRx);
    expect(R).toBe(LINK_HORIZON_FACTOR*(Math.sqrt(hTx)+Math.sqrt(hRx))*1000);
    expect(linkQualityAt(b,pose(R+1,0,altM))).toBe(0);
    expect(linkQualityAt(b,pose(0,0,altM))).toBeGreaterThan(0);
    expect(linkQualityAt(b,pose(R*0.25,0,altM))).toBeGreaterThan(linkQualityAt(b,pose(R*0.9,0,altM)));
  });

  it('priority is scuttled > offline > detuned > terminating > critical > degraded; weakSignal is a flag',()=>{
    const life=100,d=0;
    const base={deployedAt:d,life,placed:true as const,x:0,y:0,rfChannel:1};
    expect(buoyDeployStatus(80,base).phase).toBe('degraded');
    expect(buoyDeployStatus(95,{...base,rfChannel:0}).phase).toBe('detuned'); // critical battery but detuned wins
    expect(buoyDeployStatus(99,{...base,rfChannel:0}).phase).toBe('detuned');
    expect(buoyDeployStatus(100,{...base,rfChannel:0}).phase).toBe('offline'); // offline beats detuned
    expect(buoyDeployStatus(100,{...base,rfChannel:0,scuttledAt:50}).phase).toBe('scuttled');
    expect(buoyDeployStatus(50,{...base,rfChannel:1,scuttledAt:50}).phase).toBe('scuttled');
    // planned stays planned even if rfChannel is 0
    expect(buoyDeployStatus(0,{placed:false,rfChannel:0,life:100}).phase).toBe('planned');
    expect(resolveBuoyPhase('tuned',0.2,false,false).phase).toBe('degraded');
    // weakSignal never becomes a phase
    const weak=weakSignalByStepping(2,()=>0.1);
    expect(weak).toBe(true);
    expect(buoyDeployStatus(80,base,{x:1e6,y:0,altM:10,headingRad:0,speedMps:0}).phase).toBe('degraded');
  });

  it('scuttleBuoy stops rows and marks the buoy scuttled from that simT',()=>{
    const e=engine(0);
    const c=e.subscribe({channel:1,res:9,filter:'NB'}) as {streamId:number};
    const out=new Float32Array(4096);
    e.advance(2);
    while(e.rowsReady(c.streamId)>0)e.writeRow(c.streamId,out);
    const before=out.slice(0,8);
    expect(before.some(v=>Number.isFinite(v))).toBe(true);
    e.scuttleBuoy(1);
    expect(e.buoyStatus(0,9).phase).toBe('scuttled');
    expect(e.scenario.buoys[0]!.scuttledAt).toBe(e.time);
    expect(isAlive(e.scenario.buoys[0]!,e.time)).toBe(false);
    expect(isFeeding(e.scenario.buoys[0]!,e.time)).toBe(false);
    e.advance(2);
    let saw=false;
    while(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,out);saw=true;expect([...out.subarray(0,16)].every(v=>Number.isNaN(v))).toBe(true);}
    expect(saw).toBe(true);
    // query at a time before scuttle is not scuttled
    expect(e.buoyStatus(0,9,600,1).phase).not.toBe('scuttled');
  });

  it('weakSignal enters below 0.25, clears only above 0.35, and does not chatter around 0.25',()=>{
    expect(WEAK_SIGNAL_ENTER).toBe(0.25);
    expect(WEAK_SIGNAL_CLEAR).toBe(0.35);
    expect(WEAK_SIGNAL_CLOCK_S).toBe(1);
    const osc=(t:number)=> (Math.floor(t)%2===0)?0.20:0.30;
    expect(weakSignalByStepping(-1,osc)).toBe(false);
    expect(weakSignalByStepping(0,osc)).toBe(true); // tick 0 is 0.20
    for(let t=0;t<=20;t+=0.25){
      expect(weakSignalByStepping(t,osc)).toBe(true);
    }
    // mid-tick query uses floor(t/clock) only: 1.7 same as 1.0
    expect(weakSignalByStepping(1.7,osc)).toBe(weakSignalByStepping(1.0,osc));
    const bump=(t:number)=> t>=5?0.40:osc(t);
    expect(weakSignalByStepping(4.9,bump)).toBe(true);
    expect(weakSignalByStepping(5,bump)).toBe(false);
    expect(weakSignalByStepping(4,()=>0.30)).toBe(false); // never entered
  });

  it('a query at an arbitrary simT matches stepping the engine there',()=>{
    const e=engine(0);
    e.setPlaneRoute({
      mode:'pointToPoint',speedMps:250,altitudeFt:8000,t0:0,
      centerX:0,centerY:0,radiusM:4000,phase0:0,
      points:[{x:0,y:0},{x:0,y:80_000}],
    });
    const queried=[] as boolean[];
    for(const t of [0,0.7,1,1.7,5,12.3,20]){
      queried.push(e.buoyStatus(0,9,600,t).weakSignal);
    }
    const e2=engine(0);
    e2.setPlaneRoute({
      mode:'pointToPoint',speedMps:250,altitudeFt:8000,t0:0,
      centerX:0,centerY:0,radiusM:4000,phase0:0,
      points:[{x:0,y:0},{x:0,y:80_000}],
    });
    const stepped:boolean[]=[];
    let cursor=0;
    for(const t of [0,0.7,1,1.7,5,12.3,20]){
      if(t>cursor)e2.advance(t-cursor);
      cursor=t;
      stepped.push(e2.buoyStatus(0,9).weakSignal);
    }
    expect(stepped).toEqual(queried);
    // also full status (link + flag) at 12.3
    const e3=engine(0);
    e3.setPlaneRoute({
      mode:'pointToPoint',speedMps:250,altitudeFt:8000,t0:0,
      centerX:0,centerY:0,radiusM:4000,phase0:0,
      points:[{x:0,y:0},{x:0,y:80_000}],
    });
    const q=e3.buoyStatus(0,9,600,12.3);
    e3.advance(12.3);
    const s=e3.buoyStatus(0,9);
    expect(s.weakSignal).toBe(q.weakSignal);
    expect(s.linkQuality).toBe(q.linkQuality);
    expect(s.batteryFrac).toBe(q.batteryFrac);
  });

  it('refreshWeakSignal snapshot of the flag matches a later query at the same simT',()=>{
    const e=engine(0);
    e.setPlaneRoute({
      mode:'pointToPoint',speedMps:250,altitudeFt:8000,t0:0,
      centerX:0,centerY:0,radiusM:4000,phase0:0,
      points:[{x:0,y:0},{x:0,y:80_000}],
    });
    e.advance(8);
    const snap=new Map(e.refreshWeakSignal());
    expect(snap.get('buoy-1')).toBe(e.buoyStatus(0,9).weakSignal);
    // a fresh engine restored to the same time recovers the same flag
    const e2=engine(0);
    e2.setPlaneRoute({
      mode:'pointToPoint',speedMps:250,altitudeFt:8000,t0:0,
      centerX:0,centerY:0,radiusM:4000,phase0:0,
      points:[{x:0,y:0},{x:0,y:80_000}],
    });
    e2.advance(8);
    expect(e2.refreshWeakSignal().get('buoy-1')).toBe(snap.get('buoy-1'));
  });
});
