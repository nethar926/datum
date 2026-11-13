import {describe,it,expect} from 'vitest';
import {
  AcousticEngine, cpaScenario, loadScenario, validateScenario,
  inferBuoyType, normalizeBuoy, dropBtBuoy,
  applyCrewAction, dropBuoyPayload,
} from '../src/index.js';

function emptyCpa(){
  const s=cpaScenario();
  s.surfacePool=[];s.surfaceTraffic=0;
  return s;
}

describe('engine buoy type',()=>{
  it('infers canonical type from type, legacy spelling, kind, or difar',()=>{
    expect(inferBuoyType('omni')).toBe('omni');
    expect(inferBuoyType('passive-omni')).toBe('omni');
    expect(inferBuoyType('difar')).toBe('difar');
    expect(inferBuoyType('bt')).toBe('bt');
    expect(inferBuoyType('dicass')).toBe('dicass');
    expect(inferBuoyType({type:'passive-omni'})).toBe('omni');
    expect(inferBuoyType({kind:'difar'})).toBe('difar');
    expect(inferBuoyType({difar:true})).toBe('difar');
    expect(inferBuoyType({difar:false})).toBe('omni');
    expect(inferBuoyType({type:'omni',kind:'difar',difar:true})).toBe('omni');
    expect(inferBuoyType({kind:'bt',difar:true})).toBe('bt');
    expect(normalizeBuoy({type:'passive-omni' as const})).toEqual({type:'omni',difar:false});
    expect(normalizeBuoy({kind:'difar'}).difar).toBe(true);
  });

  it('loadScenario and the engine canonicalize legacy passive-omni and set derived difar',()=>{
    const raw=emptyCpa();
    raw.buoys=[{...raw.buoys[0]!,id:'buoy-1',rfChannel:1,type:'passive-omni'}];
    expect(()=>validateScenario(raw)).not.toThrow();
    const loaded=loadScenario(raw);
    expect(loaded.buoys[0]!.type).toBe('passive-omni');
    const e=new AcousticEngine(raw);
    expect(e.scenario.buoys[0]!.type).toBe('omni');
    expect(e.scenario.buoys[0]!.difar).toBe(false);
    const st=e.buoyStatus(0, 9);
    expect(st.type).toBe('omni');
    expect(st.difar).toBe(false);
    expect(e.tactical().buoys[0]!.type).toBe('omni');
    expect(e.tactical().buoys[0]!.difar).toBe(false);
    expect(e.tactical().buoys[0]!.kind).toBe('omni');
  });

  it('addBuoy, dropBuoy and autoDropPattern write type on inventory and status',()=>{
    const s=emptyCpa();
    s.buoys=[
      {...s.buoys[0]!,id:'buoy-1',rfChannel:1,type:'difar',x:0,y:0},
      {...s.buoys[0]!,id:'buoy-2',rfChannel:2,type:'passive-omni',x:400,y:0},
    ];
    const e=new AcousticEngine(s,undefined,{buoyStartMode:'unplaced',autoDropPattern:true});
    expect(e.scenario.buoys.map(b=>b.type)).toEqual(['difar','omni']);
    expect(e.scenario.buoys.map(b=>b.difar)).toEqual([true,false]);
    expect(e.buoyStatus(0,9).type).toBe('difar');
    expect(e.buoyStatus(0,9).difar).toBe(true);
    expect(e.buoyStatus(1,9).type).toBe('omni');
    expect(e.buoyStatus(1,9).difar).toBe(false);

    const id=e.dropBuoy({channel:3,kind:'difar',x:800,y:0,hydrophoneDepthM:40});
    expect(id).toBe(3);
    const dropped=e.scenario.buoys.find(b=>b.id==='buoy-3')!;
    expect(dropped.type).toBe('difar');
    expect(dropped.difar).toBe(true);
    expect(e.buoyStatus(e.scenario.buoys.length-1,9).type).toBe('difar');

    e.addBuoy({id:'buoy-9',rfChannel:9,type:'dicass',x:0,y:100,depth:40,course:0,speed:0,deployedAt:0,life:7200,placed:true});
    const dicass=e.scenario.buoys.find(b=>b.id==='buoy-9')!;
    expect(dicass.type).toBe('dicass');
    expect(dicass.difar).toBe(false);
    expect(e.buoyStatus(e.scenario.buoys.length-1,9).type).toBe('dicass');
    expect(e.tactical().buoys.find(b=>b.id===9)).toMatchObject({type:'dicass',difar:false,kind:'dicass'});
  });

  it('dropBuoy prefers payload type over kind; pending gram kinds still throw',()=>{
    const e=new AcousticEngine(emptyCpa());
    e.dropBuoy({channel:3,kind:'difar',type:'omni',x:0,y:0,hydrophoneDepthM:40});
    expect(e.scenario.buoys.at(-1)!.type).toBe('omni');
    expect(e.scenario.buoys.at(-1)!.difar).toBe(false);
    expect(()=>e.dropBuoy({channel:4,kind:'bt',x:0,y:0,hydrophoneDepthM:40})).toThrow(/pending approved plan/);
    expect(()=>e.dropBuoy({channel:5,kind:'dicass',x:0,y:0,hydrophoneDepthM:40})).toThrow(/pending approved plan/);
  });

  it('BT drops carry type bt and a derived difar of false',()=>{
    const s=emptyCpa();
    const drop=dropBtBuoy(s,{x:100,y:-40,id:9});
    expect(drop.type).toBe('bt');
    expect(drop.difar).toBe(false);
    const e=new AcousticEngine(s);
    const n=e.scenario.buoys.length;
    const d2=e.dropBtBuoy({x:0,y:0});
    expect(d2.type).toBe('bt');
    expect(d2.difar).toBe(false);
    expect(e.scenario.buoys).toHaveLength(n);
  });

  it('older crew-sync and UserCut payloads without type infer it from kind or difar',()=>{
    const base=()=>new AcousticEngine(emptyCpa());
    const fromKind=base();
    applyCrewAction(fromKind,{seq:1,simT:0,operatorId:'host',kind:'dropBuoy',payload:{channel:3,kind:'difar',x:10,y:20,hydrophoneDepthM:40}});
    expect(fromKind.scenario.buoys.at(-1)).toMatchObject({type:'difar',difar:true});

    const fromDifar=base();
    applyCrewAction(fromDifar,{seq:1,simT:0,operatorId:'host',kind:'dropBuoy',payload:{channel:3,difar:true,x:10,y:20,hydrophoneDepthM:40}});
    expect(fromDifar.scenario.buoys.at(-1)).toMatchObject({type:'difar',difar:true});

    const fresh={channel:4,kind:'omni' as const,x:0,y:0,hydrophoneDepthM:50};
    const payload=JSON.parse(JSON.stringify(dropBuoyPayload(fresh))) as Record<string,unknown>;
    expect(payload.type).toBe('omni');
    expect(payload.difar).toBe(false);
    const fromType=base();
    applyCrewAction(fromType,{seq:1,simT:0,operatorId:'host',kind:'dropBuoy',payload});
    expect(fromType.scenario.buoys.at(-1)).toMatchObject({type:'omni',difar:false,rfChannel:4});
  });

  it('UserCut / crew-sync action JSON with no type still infers on replay',()=>{
    const raw=JSON.stringify({seq:1,simT:0,operatorId:'host',kind:'dropBuoy',payload:{channel:3,kind:'omni',x:5,y:6,hydrophoneDepthM:45}});
    const action=JSON.parse(raw);
    expect('type' in action.payload).toBe(false);
    const e=new AcousticEngine(emptyCpa());
    applyCrewAction(e,action);
    expect(e.scenario.buoys.at(-1)).toMatchObject({type:'omni',difar:false,x:5,y:6,depth:45});
  });
});
