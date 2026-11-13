import {describe,it,expect} from 'vitest';
import {
  AcousticEngine, cpaScenario, fictionalSignature, geometry, createGeometry,
  autoBearingsFromState, sendBearingFromPeakAt, AUTO_BEARING_MIN_QUALITY,
  BEARING_NOISE_K, bearingSigmaDeg, wrapDeg,
} from '../src/index.js';
import type {Contact} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';
import type {ContactPose} from '../src/autoBearings.js';

function contactAt(id:string,bearingDeg:number,rangeM:number,over:Partial<Contact['params']>={}):Contact {
  const rad=bearingDeg*Math.PI/180;
  const params={
    ...fictionalSignature,label:id,levelDb:160,tonalRefDb:160,modulation:0,cavitationPower:0,
    tonals:[{family:'motor' as const,hz:90,power:1}],
    ...over,
  };
  return {
    id,category:'subsurface',classificationTarget:true,
    x:rangeM*Math.sin(rad),y:rangeM*Math.cos(rad),depth:60,course:0,speed:0,
    motion:[{at:0,course:0,speed:0,depth:60}],
    params,
  };
}

function buoy():Buoy {
  return {id:'buoy-1',rfChannel:1,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type:'difar'};
}

function scenario(contacts:Contact[]) {
  const s=cpaScenario();
  s.bins=512;s.fmax=500;s.band=[0,500];s.seed=7;
  s.environment.seaState=0;s.environment.shipping='light';
  s.contacts=contacts;s.buoys=[buoy()];s.surfacePool=[];s.surfaceTraffic=0;
  return s;
}

function asPose(c:Contact):ContactPose {
  return {id:c.id,x:c.x,y:c.y,depth:c.depth,course:c.course,speed:c.speed,active:c.active,lines:c.params.tonals,params:c.params};
}

describe('autoBearings + ALI sendBearingFromPeak',()=>{
  it('emits one strongest-SNR bearing per DIFAR buoy and contact above the quality floor',()=>{
    const a=contactAt('alpha',45,400);
    const b=contactAt('bravo',120,400,{tonals:[{family:'motor',hz:140,power:1}],tonalRefDb:160});
    const env=scenario([a,b]).environment;
    const rows=autoBearingsFromState({
      buoys:[buoy()],contacts:[asPose(a),asPose(b)],environment:env,seed:7,atSimTime:0,
    });
    expect(AUTO_BEARING_MIN_QUALITY).toBe(10);
    expect(rows).toHaveLength(2);
    const ids=rows.map(r=>r.contactId).sort();
    expect(ids).toEqual(['alpha','bravo']);
    for (const r of rows) {
      expect(r.buoyId).toBe(1);
      expect(r.quality).toBeGreaterThanOrEqual(10);
      expect(r.snrDb).toBe(r.quality);
      expect(r.sigmaDeg).toBeCloseTo(bearingSigmaDeg(10**(r.snrDb/10)),10);
      expect(r.sigmaDeg).toBeLessThanOrEqual(90);
      expect(r.brgDeg).toBeGreaterThanOrEqual(0);
      expect(r.brgDeg).toBeLessThan(360);
      expect(r.freqHz).toBeGreaterThan(0);
    }
    const truthA=geometry(a,buoy(),createGeometry()).bearing*180/Math.PI;
    const alpha=rows.find(r=>r.contactId==='alpha')!;
    const err=Math.abs(((alpha.brgDeg-truthA+540)%360)-180);
    expect(err).toBeLessThan(20);
  });

  it('is deterministic by seed and skips contacts below the threshold',()=>{
    const a=contactAt('alpha',45,400);
    const far=contactAt('far',10,80_000,{tonalRefDb:80,levelDb:80});
    const env=scenario([a,far]).environment;
    const args={buoys:[buoy()],contacts:[asPose(a),asPose(far)],environment:env,seed:11,atSimTime:12};
    const x=autoBearingsFromState(args);
    const y=autoBearingsFromState(args);
    expect(x).toEqual(y);
    expect(x.some(r=>r.contactId==='alpha')).toBe(true);
    expect(x.some(r=>r.contactId==='far')).toBe(false);
    const z=autoBearingsFromState({...args,seed:99});
    expect(z.find(r=>r.contactId==='alpha')!.brgDeg).not.toBe(x.find(r=>r.contactId==='alpha')!.brgDeg);
  });

  it('AcousticEngine.autoBearings is a stable atSimTime stream and does not mutate time',()=>{
    const e=new AcousticEngine(scenario([contactAt('alpha',45,400)]));
    const t0=e.time;
    const a=e.autoBearings(0);
    const b=e.autoBearings(0);
    expect(a).toEqual(b);
    expect(e.time).toBe(t0);
    expect(a[0]).toMatchObject({buoyId:expect.any(Number),contactId:'alpha',freqHz:expect.any(Number),brgDeg:expect.any(Number),quality:expect.any(Number),snrDb:expect.any(Number),sigmaDeg:expect.any(Number)});
    const later=e.autoBearings(30);
    expect(later[0]!.brgDeg).not.toBe(a[0]!.brgDeg);
    expect(e.time).toBe(t0);
  });

  it('sendBearingFromPeak reuses DIFAR math and returns bearingDeg, sigmaDeg, snrDb',()=>{
    const c=contactAt('alpha',45,400);
    const s=scenario([c]);
    const peak=sendBearingFromPeakAt({
      buoy:buoy(),buoyIndex:0,contacts:[asPose(c)],environment:s.environment,seed:7,atSimTime:0,freqHz:90,
    });
    expect(peak.bearingDeg).toBeGreaterThanOrEqual(0);
    expect(peak.bearingDeg).toBeLessThan(360);
    expect(peak.sigmaDeg).toBeGreaterThan(0);
    expect(peak.snrDb).toBeGreaterThan(10);
    expect(peak.freqHz).toBeGreaterThan(0);
    const again=sendBearingFromPeakAt({
      buoy:buoy(),buoyIndex:0,contacts:[asPose(c)],environment:s.environment,seed:7,atSimTime:0,freqHz:90,
    });
    expect(again).toEqual(peak);
    const band=sendBearingFromPeakAt({
      buoy:buoy(),buoyIndex:0,contacts:[asPose(c)],environment:s.environment,seed:7,atSimTime:0,band:[50,150],
    });
    expect(band.snrDb).toBeCloseTo(peak.snrDb,6);

    const e=new AcousticEngine(s);
    const t0=e.time;
    const fromEng=e.sendBearingFromPeak(1,90,0);
    const fromEngAgain=e.sendBearingFromPeak(1,90,0);
    expect(fromEngAgain).toEqual(fromEng);
    expect(e.time).toBe(t0);
    expect(fromEng.snrDb).toBeGreaterThan(10);
    expect(fromEng.sigmaDeg).toBeGreaterThan(0);
    const err=Math.abs(((fromEng.bearingDeg-45+540)%360)-180);
    expect(err).toBeLessThan(20);
    const fromBand=e.sendBearingFromPeak(1,[50,150],0);
    expect(fromBand.snrDb).toBeGreaterThan(10);
  });

  it('wrapDeg stays in [0, 360)',()=>{
    expect(wrapDeg(-10)).toBe(350);
    expect(wrapDeg(370)).toBe(10);
    expect(BEARING_NOISE_K).toBe(20);
  });
});
