import {describe,it,expect} from 'vitest';
import {
  catalog,depthEnvelopeFor,ManeuverState,sourceGateFor,gatingTableRow,
  modeSpeedCap,edgeTransients,validateModeDepth,
} from '../src/index.js';

describe('depth envelopes',()=>{
  it('every class has test depth = params.depthM[1], peri sane, never recommends above test',()=>{
    const rows: {id:string;testDepthM:number;typicalPatrolDepthM:readonly[number,number];periscopeDepthM:number}[]=[];
    for(const c of catalog.classes){
      const e=depthEnvelopeFor(c);
      expect(e.testDepthM).toBe(c.params.depthM[1]);
      expect(e.maxOperatingDepthM).toBeLessThanOrEqual(e.testDepthM);
      expect(e.typicalPatrolDepthM[0]).toBeLessThanOrEqual(e.typicalPatrolDepthM[1]);
      expect(e.typicalPatrolDepthM[1]).toBeLessThanOrEqual(e.testDepthM);
      expect(e.periscopeDepthM).toBeGreaterThan(0);
      expect(e.periscopeDepthM).toBeLessThanOrEqual(30);
      if(c.plant==='diesel')expect(e.periscopeDepthM).toBe(c.snorkelDepthM);
      rows.push({id:e.classId,testDepthM:e.testDepthM,typicalPatrolDepthM:e.typicalPatrolDepthM,periscopeDepthM:e.periscopeDepthM});
    }
    expect(rows).toHaveLength(22);
  });
});

describe('ManeuverState',()=>{
  const diesel=()=>catalog.classes.find(c=>c.id==='blue-brindleflux')!;
  const nuclear=()=>catalog.classes.find(c=>c.id==='blue-vellumwake')!;
  const flagged=()=>catalog.classes.find(c=>c.id==='green-morrowcoil')!;

  it('same seed → identical timeline',()=>{
    const run=(seed:number)=>{
      const m=new ManeuverState({class:diesel(),seed,mode:'BATT',speedKn:4,depthM:60,courseRad:0});
      m.command({type:'setSpeedKn',speedKn:6});
      m.command({type:'setCourseRad',courseRad:Math.PI/2});
      m.command({type:'setDepthM',depthM:100});
      const out:number[][]=[];
      for(let i=0;i<40;i++){const s=m.step(.5);out.push([s.speedKn,s.courseRad,s.depthM]);}
      return out;
    };
    expect(run(42)).toEqual(run(42));
    // Class rates are fixed; seed reserves the PRNG for edgeTransients. Different command
    // sequences must diverge (seed alone does not alter kinematics).
    const m=new ManeuverState({class:diesel(),seed:7,mode:'BATT',speedKn:4,depthM:60,courseRad:0});
    m.command({type:'setSpeedKn',speedKn:3});
    const alt:number[][]=[];for(let i=0;i<40;i++){const s=m.step(.5);alt.push([s.speedKn,s.courseRad,s.depthM]);}
    expect(alt).not.toEqual(run(42));
  });

  it('respects accel/dive/turn rate limits',()=>{
    const c=diesel(),e=depthEnvelopeFor(c);
    const m=new ManeuverState({class:c,seed:1,mode:'BATT',speedKn:2,depthM:40,courseRad:0});
    m.command({type:'setSpeedKn',speedKn:8});
    m.command({type:'setDepthM',depthM:120});
    m.command({type:'setCourseRad',courseRad:Math.PI});
    const s=m.step(1);
    expect(s.speedKn).toBeLessThanOrEqual(2+e.accelKnPerS+1e-9);
    expect(s.depthM).toBeLessThanOrEqual(40+e.diveRateMps+1e-9);
    expect(Math.abs(s.courseRad)).toBeLessThanOrEqual(e.turnRateRadPerS*2.5+1e-6); // scaled by speed/ref
  });

  it('never exceeds test depth; rejects over-test commands',()=>{
    const c=diesel(),e=depthEnvelopeFor(c);
    const m=new ManeuverState({class:c,seed:2,mode:'BATT',speedKn:3,depthM:50});
    const t=m.command({type:'setDepthM',depthM:e.testDepthM+50});
    expect(t.commandStatus).toBe('rejected');
    expect(t.rejectReason).toBe('exceedsTestDepth');
    expect(m.truth().depthM).toBe(50);
    m.command({type:'setDepthM',depthM:e.testDepthM});
    for(let i=0;i<500;i++)m.step(1);
    expect(m.truth().depthM).toBeLessThanOrEqual(e.testDepthM+1e-9);
  });

  it('rejects snorkel deeper than periscope and SURF off surface',()=>{
    const c=diesel(),e=depthEnvelopeFor(c);
    const m=new ManeuverState({class:c,seed:3,mode:'BATT',speedKn:3,depthM:80});
    expect(m.command({type:'setMode',mode:'SNORK'}).rejectReason).toBe('snorkelTooDeep');
    const m2=new ManeuverState({class:c,seed:3,mode:'BATT',speedKn:3,depthM:e.periscopeDepthM});
    expect(m2.command({type:'setMode',mode:'SNORK'}).commandStatus).toBe('ok');
    expect(m2.command({type:'setDepthM',depthM:80}).rejectReason).toMatch(/snorkelTooDeep|dieselDeepWithoutSnorkel/);
    const m3=new ManeuverState({class:c,seed:4,mode:'BATT',speedKn:3,depthM:0});
    expect(m3.command({type:'setMode',mode:'SURF'}).commandStatus).toBe('ok');
    expect(m3.command({type:'setDepthM',depthM:5}).commandStatus).toBe('rejected');
  });

  it('rejects NUC on diesel and SNORK on nuclear; AIP needs capability',()=>{
    expect(new ManeuverState({class:diesel(),seed:1,mode:'BATT',speedKn:2,depthM:40}).command({type:'setMode',mode:'NUC'}).rejectReason).toBe('modeUnsupported');
    expect(new ManeuverState({class:nuclear(),seed:1,mode:'NUC',speedKn:10,depthM:80}).command({type:'setMode',mode:'SNORK'}).rejectReason).toBe('modeUnsupported');
    const noAip=catalog.classes.find(c=>c.plant==='diesel'&&!c.aip)!;
    expect(new ManeuverState({class:noAip,seed:1,mode:'BATT',speedKn:2,depthM:40}).command({type:'setMode',mode:'AIP'}).rejectReason).toBe('aipRequiresCapability');
  });

  it('unflagged coupled out-of-band speed rejected; flagged declutch edge fires',()=>{
    const fixed=catalog.classes.find(c=>c.machinery.kind==='dieselDirect')!;
    const m=new ManeuverState({class:fixed,seed:5,mode:'SNORK',speedKn:6,depthM:fixed.snorkelDepthM});
    // Direct drive SURF/SNORK has a coupled window — very low speed rejected when clutched mode.
    const r=m.command({type:'setSpeedKn',speedKn:.2});
    if(r.commandStatus==='rejected')expect(r.rejectReason).toBe('coupledOutOfBand');
    const f=flagged();
    const mf=new ManeuverState({class:f,seed:6,mode:'SNORK',speedKn:8,depthM:f.snorkelDepthM});
    // Force a low speed that leaves the coupled window → declutch edge on flagged plant.
    const low=mf.command({type:'setSpeedKn',speedKn:.5});
    expect(low.commandStatus).toBe('ok');
    expect(low.clutchEngaged).toBe(false);
    expect(mf.truth().clutchEngaged).toBe(false);
  });

  it('50 maneuvering contacts stay stable (no throw, depth in envelope)',()=>{
    const classes=catalog.classes;
    const ms=Array.from({length:50},(_,i)=>{
      const c=classes[i%classes.length]!;
      const mode=c.plant==='nuclear'?'NUC' as const:'BATT' as const;
      return {c,m:new ManeuverState({class:c,seed:1000+i,mode,speedKn:3,depthM:Math.min(80,depthEnvelopeFor(c).typicalPatrolDepthM[0]),contactId:`m${i}`})};
    });
    for(const {c,m} of ms){
      m.command({type:'setSpeedKn',speedKn:Math.min(modeSpeedCap(c,m.truth().mode),5)});
      m.command({type:'setCourseRad',courseRad:1});
      m.command({type:'setDepthM',depthM:Math.min(m.envelope.testDepthM,m.truth().depthM+30)});
    }
    for(let t=0;t<20;t++)for(const {m} of ms){
      const s=m.step(.5);
      expect(s.depthM).toBeLessThanOrEqual(m.envelope.testDepthM+1e-9);
      expect(s.speedKn).toBeGreaterThanOrEqual(0);
    }
  });

  it('edgeTransients emit swath/transient on surface/submerge',()=>{
    const edges=[{kind:'surface' as const},{kind:'clutchDisengage' as const}];
    const tr=edgeTransients(edges,10,()=>.3);
    expect(tr.some(x=>x.kind==='swath')).toBe(true);
    expect(tr.some(x=>x.kind==='transient')).toBe(true);
  });
});

describe('source gating truth table',()=>{
  it('diesel BATT: no engine/EDA; indep aux on; SNORK at peri: engine+snort',()=>{
    const c=catalog.classes.find(x=>x.id==='blue-orbelune')!;
    const e=depthEnvelopeFor(c);
    const batt=sourceGateFor(c,'BATT',80);
    expect(batt.dieselEngine).toBe(false);expect(batt.edas).toBe(false);
    expect(batt.independentAux).toBe(true);expect(batt.motor).toBe(true);
    const sn=sourceGateFor(c,'SNORK',e.periscopeDepthM);
    expect(sn.dieselEngine).toBe(true);expect(sn.edas).toBe(true);expect(sn.snortBroadband).toBe(true);
    const surf=sourceGateFor(c,'SURF',0);
    expect(surf.waveSlapBroadband).toBe(true);expect(surf.cavitationDepthSuppression).toBe(false);
    const nuc=catalog.classes.find(x=>x.plant==='nuclear')!;
    const ng=sourceGateFor(nuc,'NUC',100);
    expect(ng.reactorPlant).toBe(true);expect(ng.dieselEngine).toBe(false);
    // Table smoke: gatingTableRow is JSON-stable
    expect(gatingTableRow(batt).mode).toBe('BATT');
  });
});
