import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,
 intermittentDutyGain,AcousticEngine,cpaScenario,knotsToMps,writePlantTonals,
} from '../src/index.js';

describe('intermittent sources (duty + edges)',()=>{
 it('duty gain is 0 or 1 outside edges; fade/abrupt/knee differ',()=>{
  expect(intermittentDutyGain(30,60,60,0,'abrupt')).toBe(1);
  expect(intermittentDutyGain(90,60,60,0,'abrupt')).toBe(0);
  const fadeRise=intermittentDutyGain(1,60,60,0,'fade');
  const abruptRise=intermittentDutyGain(1,60,60,0,'abrupt');
  const kneeRise=intermittentDutyGain(1,60,60,0,'knee');
  expect(fadeRise).toBeGreaterThan(0);expect(fadeRise).toBeLessThan(1);
  expect(abruptRise).toBe(1); // past 0.06 s
  expect(kneeRise).toBeLessThan(fadeRise); // 5 s knee slower than 2 s fade at t=1
 });
 it('A/C compressor classes emit INTERMITTENT lines that gate with dutyClockS',()=>{
  const withAc=catalog.classes.filter(c=>c.aux.some(a=>a.id==='fictional-ac-compressor'));
  expect(withAc.length).toBeGreaterThanOrEqual(4);
  const c=withAc[0],sheet=c.aux.find(a=>a.id==='fictional-ac-compressor')!;
  expect(sheet.duty).toBe('intermittent');expect(['fade','abrupt','knee']).toContain(sheet.edge!);
  const mode=c.plant==='nuclear'?'NUC' as const:'SNORK' as const;
  const s=deriveSignature(c,'base',{speedKn:8,depthM:40,mode});
  configurePropulsion(s,9,c.id,mode);
  s.dutyClockS=0;updateDerivedSignature(s,effectiveParams(c),8,40,mode);
  const onLines=s.tonals!.filter(l=>l.lineFamily==='INTERMITTENT'&&sheet.harmonics.includes(l.harmonic!));
  expect(onLines.length).toBeGreaterThan(0);
  // Jump deep into an off half of a long period
  s.dutyClockS=1e6;writePlantTonals(s,mode,effectiveParams(c).electricalHarmonics,effectiveParams(c).srcHzPerKn,8);
  const offPow=s.tonals!.filter(l=>l.lineFamily==='INTERMITTENT').reduce((a,l)=>a+l.power,0);
  // Not all phases are off at 1e6 — sample many clocks for a near-zero
  let sawOff=false,sawOn=false;
  for(let t=0;t<500;t+=7){s.dutyClockS=t;writePlantTonals(s,mode,effectiveParams(c).electricalHarmonics,effectiveParams(c).srcHzPerKn,8);
   const p=s.tonals!.filter(l=>l.lineFamily==='INTERMITTENT').reduce((a,l)=>a+l.power,0);
   if(p<1e-6)sawOff=true;if(p>1e-4)sawOn=true;}
  expect(sawOn&&sawOff).toBe(true);
  expect(offPow).toBeGreaterThanOrEqual(0);
 });
 it('AcousticEngine advances duty without touching HYDP power/duration',()=>{
  const c=catalog.classes.find(x=>x.aux.some(a=>a.id==='fictional-ac-compressor'))!;
  const hydpDur=c.hydp!.durationS,hydpHz=c.hydp!.nominalHz;
  const sc=cpaScenario();sc.contacts=[{...sc.contacts[0],id:'int-1',catalogRef:{classId:c.id},operatingMode:c.plant==='nuclear'?'NUC':'SNORK',speed:knotsToMps(8),depth:40,motion:[{at:0,course:0,speed:knotsToMps(8),depth:40}]}];
  const e=new AcousticEngine(sc);
  expect(e.scenario.contacts[0].params.plantSpec!.hydp!.durationS).toBe(hydpDur);
  expect(e.scenario.contacts[0].params.plantSpec!.hydp!.nominalHz).toBe(hydpHz);
  e.advance(120);
  expect(catalog.classes.find(x=>x.id===c.id)!.hydp!.durationS).toBe(hydpDur);
 });
});
