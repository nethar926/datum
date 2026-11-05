import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,geometry,createGeometry,fictionalSignature,WorkerRuntime,BEARING_NOISE_K,BEARING_SNR_FLOOR} from '../src/index.js';
import type {Command,GramRows,WorkerRequest,WorkerResponse} from '../src/protocol.js';
import type {Scenario,Contact} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';

const bytes=(a:Float32Array)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const angErr=(got:number,want:number)=>Math.abs(((got-want+540)%360)-180);

function contactAt(bearingDeg:number,rangeM:number,overrides:Partial<Contact['params']>={}):Contact{
  const rad=bearingDeg*Math.PI/180;
  return {
    id:'tgt',category:'subsurface',classificationTarget:true,
    x:rangeM*Math.sin(rad),y:rangeM*Math.cos(rad),depth:60,course:0,speed:0,
    motion:[{at:0,course:0,speed:0,depth:60}],
    params:{...fictionalSignature,levelDb:150,tonalHz:120,shaftHz:1,blades:3,modulation:0,cavitationPower:0,...overrides},
  };
}

function scenario(contacts:Contact[],buoyType:Buoy['type']='difar',bins=512):Scenario{
  const s=cpaScenario();
  s.bins=bins;s.fmax=500;s.band=[0,500];s.seed=7;s.environment.seaState=0;s.environment.shipping='light';
  s.contacts=contacts.map((c,i)=>({...c,id:c.id||`tgt-${i}`}));
  s.buoys=[{id:'buoy-1',rfChannel:1,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type:buoyType}];
  s.surfacePool=[];s.surfaceTraffic=0;
  return s;
}

function peakNear(row:Float32Array,hz:number,fmax:number):number{
  const df=fmax/(row.length-1),c=Math.round(hz/df);let peak=c;
  for(let i=Math.max(1,c-4);i<=Math.min(row.length-2,c+4);i++)if(row[i]>row[peak])peak=i;
  return peak;
}

function circularStdDeg(samples:number[]):number{
  let sx=0,sy=0;for(const d of samples){const r=d*Math.PI/180;sx+=Math.sin(r);sy+=Math.cos(r);}
  const R=Math.hypot(sx,sy)/samples.length;
  return Math.sqrt(Math.max(0,-2*Math.log(Math.max(R,1e-12))))*180/Math.PI;
}

function meanResultantLength(samples:Float32Array|number[]):number{
  let sx=0,sy=0,n=0;for(const d of samples){if(!Number.isFinite(d))continue;const r=d*Math.PI/180;sx+=Math.sin(r);sy+=Math.cos(r);n++;}
  return n?Math.hypot(sx,sy)/n:0;
}

describe('DIFAR per-bin bearing channel',()=>{
  it('exports documented noise-model constants',()=>{
    expect(BEARING_NOISE_K).toBe(20);
    expect(BEARING_SNR_FLOOR).toBe(1);
  });

  it('(a) strong contact at 045°: tonal bins within a few degrees of truth',()=>{
    const e=new AcousticEngine(scenario([contactAt(45,500,{levelDb:160,tonalHz:90})]));
    const g=e.generators[0];
    expect(geometry(e.scenario.contacts[0],e.scenario.buoys[0],createGeometry()).bearing*180/Math.PI).toBeCloseTo(45,5);
    const samples:number[]=[];
    for(let r=0;r<40;r++){g.generate();samples.push(g.bearingRow[peakNear(g.row,90,500)]);}
    const mean=Math.atan2(samples.reduce((s,d)=>s+Math.sin(d*Math.PI/180),0),samples.reduce((s,d)=>s+Math.cos(d*Math.PI/180),0))*180/Math.PI;
    expect(angErr((mean+360)%360,45)).toBeLessThan(5);
    expect(circularStdDeg(samples)).toBeLessThan(10);
  });

  it('(b) bearing spread grows as SNR drops',()=>{
    const loud=new AcousticEngine(scenario([contactAt(30,500,{levelDb:165,tonalHz:100})]));
    const quiet=new AcousticEngine(scenario([contactAt(30,500,{levelDb:122,tonalHz:100})]));
    const loudBrg:number[]=[],quietBrg:number[]=[];
    for(let i=0;i<100;i++){
      loud.generators[0].generate();quiet.generators[0].generate();
      loudBrg.push(loud.generators[0].bearingRow[peakNear(loud.generators[0].row,100,500)]);
      quietBrg.push(quiet.generators[0].bearingRow[peakNear(quiet.generators[0].row,100,500)]);
    }
    expect(circularStdDeg(quietBrg)).toBeGreaterThan(circularStdDeg(loudBrg)*1.5);
  });

  it('(c) pure-ambient bins have roughly uniform bearings (small mean resultant length)',()=>{
    const e=new AcousticEngine(scenario([{...contactAt(10,50_000,{levelDb:90,tonalHz:200}),id:'far'}]));
    const g=e.generators[0];g.generate();
    expect(meanResultantLength(g.bearingRow.subarray(20,120))).toBeLessThan(0.35);
  });

  it('(d) two contacts with tonals in different bins report their own bearings',()=>{
    const e=new AcousticEngine(scenario([
      {...contactAt(45,400,{levelDb:162,tonalHz:80}),id:'a'},
      {...contactAt(200,400,{levelDb:162,tonalHz:220}),id:'b'},
    ]));
    const g=e.generators[0];
    const brgA:number[]=[],brgB:number[]=[];
    for(let r=0;r<30;r++){g.generate();brgA.push(g.bearingRow[peakNear(g.row,80,500)]);brgB.push(g.bearingRow[peakNear(g.row,220,500)]);}
    const mean=(xs:number[])=>(Math.atan2(xs.reduce((s,d)=>s+Math.sin(d*Math.PI/180),0),xs.reduce((s,d)=>s+Math.cos(d*Math.PI/180),0))*180/Math.PI+360)%360;
    expect(angErr(mean(brgA),45)).toBeLessThan(10);
    expect(angErr(mean(brgB),200)).toBeLessThan(10);
  });

  it('(e) same seed yields identical bearingRow',()=>{
    const a=new AcousticEngine(scenario([contactAt(60,900,{levelDb:150})]));
    const b=new AcousticEngine(scenario([contactAt(60,900,{levelDb:150})]));
    a.generators[0].generate();b.generators[0].generate();
    expect(bytes(a.generators[0].bearingRow).equals(bytes(b.generators[0].bearingRow))).toBe(true);
    a.generators[0].generate();b.generators[0].generate();
    expect(bytes(a.generators[0].bearingRow).equals(bytes(b.generators[0].bearingRow))).toBe(true);
  });

  it('(f) LOFAR power output is unchanged vs a power-only generate path',()=>{
    const s=scenario([contactAt(45,1000,{levelDb:140})]);
    const e=new AcousticEngine(s);
    const powerA=new Float32Array(e.scenario.bins);
    e.generators[0].generate(powerA);
    const e2=new AcousticEngine(structuredClone(s));
    const powerB=new Float32Array(e2.scenario.bins);
    e2.generators[0].generate(powerB);
    expect(bytes(powerA).equals(bytes(powerB))).toBe(true);
    const busyA=new AcousticEngine(cpaScenario()),busyB=new AcousticEngine(cpaScenario());
    for(let i=0;i<3;i++){busyA.step(.25);busyB.step(.25);expect(bytes(busyA.rows[0].row).equals(bytes(busyB.rows[0].row))).toBe(true);}
  });

  it('(f2) power bytes match across engines that also fill bearings (regression vs dual-seed isolation)',()=>{
    const s=cpaScenario();
    const a=new AcousticEngine(s),b=new AcousticEngine(structuredClone(s));
    const ra=new Float32Array(s.bins),rb=new Float32Array(s.bins);
    a.advance(.25);b.advance(.25);
    a.writeRow(1,ra);b.writeRow(1,rb);
    expect(bytes(ra).equals(bytes(rb))).toBe(true);
    expect([...a.generators[0].bearingRow].every(Number.isFinite)).toBe(true);
  });

  it('(g) omni fills bearingRow with NaN and skips directional work',()=>{
    const e=new AcousticEngine(scenario([contactAt(45,800,{levelDb:150})],'passive-omni'));
    e.generators[0].generate();
    expect([...e.generators[0].bearingRow].every(Number.isNaN)).toBe(true);
    const out=new Float32Array(e.scenario.bins);
    e.advance(.25);e.writeRow(1,out);
    const brg=new Float32Array(e.scenario.bins);
    e.writeBearingRow(1,brg);
    expect([...brg].every(Number.isNaN)).toBe(true);
  });

  it('(h) workerRuntime gramRows carries bearingDeg of correct length',()=>{
    const messages:WorkerResponse[]=[];
    const runtime=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));
    const send=(m:Command)=>runtime.command({...m,v:1,simT:runtime.simT} as WorkerRequest);
    send({type:'init',seed:42,scenarioId:'cpa-pass'});
    runtime.tick(.25);
    const rows=messages.filter((m):m is GramRows=>m.type==='gramRows');
    expect(rows.length).toBeGreaterThan(0);
    const batch=rows[0];
    expect(batch.bearingDeg).toBeInstanceOf(Float32Array);
    expect(batch.bearingDeg!.length).toBe(batch.data.length);
    expect(batch.bearingDeg!.length).toBe(batch.streamIds.length*1024);
    expect([...batch.bearingDeg!].some(Number.isFinite)).toBe(true);
  });

  it('writeBearingRow mirrors generator after writeRow and rejects short buffers',()=>{
    const e=new AcousticEngine(scenario([contactAt(90,500,{levelDb:150})]));
    const data=new Float32Array(e.scenario.bins),brg=new Float32Array(e.scenario.bins+4);
    e.advance(.25);e.writeRow(1,data);
    e.writeBearingRow(1,brg,2);
    expect(brg.subarray(2,2+e.scenario.bins)).toEqual(e.generators[0].bearingRow);
    expect(()=>e.writeBearingRow(1,new Float32Array(10))).toThrow(/Row size/);
  });
});
