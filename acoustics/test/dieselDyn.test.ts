import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,ENGINE_HARMONICS,
 DIESEL_BRIGHTNESS_PROFILES,pickDieselBrightness,pickDieselRichness,dieselHarmonicGain,
 AcousticEngine,dieselDynScenario,exampleScenarios,loadScenario,cpaScenario,knotsToMps,
 getCutSeed,renderCut,generateScenario,presetToParams,pickHydpShape,HYDP_MAX_ORDERS,HYDP_POWER,
 LineWander,configurePropulsion,coupledSpeedWindowKn,
} from '../src/index.js';

describe('richer fictional diesel engine families',()=>{
 it('emits CSR/CFR/EFR through ENGINE_HARMONICS with seeded uneven powers',()=>{
  expect(ENGINE_HARMONICS).toEqual([1,2,3,4,5,6]);
  expect(DIESEL_BRIGHTNESS_PROFILES.length).toBeGreaterThanOrEqual(4);
  for(const c of catalog.classes.filter(c=>c.plant==='diesel')){
   const win=coupledSpeedWindowKn(c),speedKn=win?Math.min(c.params.maxSpeedKn,Math.max(8,win.min+.05)):8;
   const s=deriveSignature(c,'base',{speedKn,depthM:10,mode:'SNORK'});
   configurePropulsion(s,7,c.id,'SNORK');updateDerivedSignature(s,effectiveParams(c),speedKn,10,'SNORK');
   for(const fam of ['CSR','CFR','EFR'] as const){
    const lines=s.tonals!.filter(l=>l.lineFamily===fam);
    expect(new Set(lines.map(l=>l.harmonic))).toEqual(new Set(ENGINE_HARMONICS));
    expect(lines.some(l=>l.power>0)).toBe(true);
   }
   expect(c.edas.length).toBeGreaterThanOrEqual(2);
   expect(c.edas.every(e=>e.harmonics.includes(3))).toBe(true);
  }
 });
 it('brightness profiles vary and EFR>CSR>CFR is common but not always',()=>{
  const seen=new Set<string>();let efrWins=0;
  for(let seed=0;seed<60;seed++){const b=pickDieselBrightness(seed,'t','e0');seen.add(`${b.efr}:${b.csr}:${b.cfr}`);if(b.efr>b.csr&&b.csr>b.cfr)efrWins++;}
  expect(seen.size).toBeGreaterThan(1);expect(efrWins).toBeGreaterThan(20);expect(efrWins).toBeLessThan(55);
  const rich=new Set<string>();for(let seed=0;seed<40;seed++)rich.add(pickDieselRichness(seed,`c${seed}`));
  expect(rich.has('sparse')&&rich.has('partial')&&rich.has('rich')).toBe(true);
  expect(dieselHarmonicGain('sparse',1)).toBeGreaterThan(dieselHarmonicGain('sparse',5));
 });
});

describe('engine-ramp ratio lock (incl. EDA)',()=>{
 it('CSR/CFR/EFR/EDA share the same fractional Δf/f through a plantRpmScale knee',()=>{
  const c=catalog.classes.find(x=>x.id==='blue-brindleflux')!,p=effectiveParams(c),s=deriveSignature(c,'base',{speedKn:10,depthM:12,mode:'SNORK'});
  const snap=(scale:number)=>{s.plantRpmScale=scale;updateDerivedSignature(s,p,10,12,'SNORK');
   const e=s.propulsion!.engines.find(x=>x.running)!;
   return {
    csrHz:e.csrHz,cfrHz:e.cfrHz,efrHz:e.efrHz,shaft:s.propulsion!.shafts[0].hz,cyl:e.cylinders,
    csr:s.tonals!.find(l=>l.lineFamily==='CSR'&&l.harmonic===1)!.hz,
    cfr:s.tonals!.find(l=>l.lineFamily==='CFR'&&l.harmonic===1)!.hz,
    efr:s.tonals!.find(l=>l.lineFamily==='EFR'&&l.harmonic===1)!.hz,
    eda:s.tonals!.find(l=>l.lineFamily==='EDA'&&l.harmonic===1&&l.eda?.name==='LOP')!.hz,
    efr6:s.tonals!.find(l=>l.lineFamily==='EFR'&&l.harmonic===6)!.hz,
   };};
  const a=snap(1),b=snap(.88),r=.88;
  for(const k of ['csrHz','cfrHz','efrHz','csr','cfr','efr','eda','efr6'] as const)expect(b[k]/a[k]).toBeCloseTo(r,10);
  // EDA stays CFR-locked (×27.75), not a fixed oscillator
  expect(a.eda).toBeCloseTo(a.cfrHz*27.75,10);expect(b.eda).toBeCloseTo(b.cfrHz*27.75,10);
  expect(a.csrHz).toBe(a.cfrHz);expect(a.efrHz).toBe(a.cfrHz*a.cyl);
  expect(b.csrHz).toBe(b.shaft);
  expect(a.efr6-b.efr6).toBeCloseTo(6*(a.efr-b.efr),8);
 });
 it('AcousticEngine lerps engine-ramp, holds end scale, and EDA tracks',()=>{
  const e=new AcousticEngine(dieselDynScenario());
  const c=e.scenario.contacts[0];
  const cfr=()=>c.params.tonals!.find(l=>l.lineFamily==='CFR'&&l.harmonic===1)!;
  const eda=()=>c.params.tonals!.find(l=>l.lineFamily==='EDA'&&l.harmonic===1)!;
  const ramp=c.transients!.find(t=>t.kind==='engine-ramp')!,at=ramp.at,dur=Number(ramp.params.durationS),to=Number(ramp.params.toScale);
  const f0=cfr().hz,e0=eda().hz;expect(c.params.plantRpmScale??1).toBe(1);
  e.advance(Math.max(0,at-1));expect(cfr().hz).toBeCloseTo(f0,5);
  e.advance(dur+2);expect(c.params.plantRpmScale!).toBeCloseTo(to,4);
  expect(cfr().hz/f0).toBeCloseTo(to,4);expect(eda().hz/e0).toBeCloseTo(to,4);
  // Hold end scale while still before any post-knee speed leg
  const mid=cfr().hz;e.advance(5);expect(cfr().hz).toBeCloseTo(mid,5);expect(c.params.plantRpmScale!).toBeCloseTo(to,4);
 });
});

describe('HYDP squally bursts + AC/DC',()=>{
 it('pickHydpShape varies orders and drownFundamental by seed',()=>{
  const shapes=Array.from({length:80},(_,i)=>pickHydpShape(i,`c${i}`));
  expect(new Set(shapes.map(s=>s.orders)).size).toBeGreaterThan(2);
  expect(shapes.some(s=>s.drownFundamental)).toBe(true);
  expect(shapes.every(s=>s.fadeS>=.04&&s.fadeS<=.12)).toBe(true);
  expect(HYDP_MAX_ORDERS).toBe(4);expect(HYDP_POWER).toBeGreaterThan(.1);
 });
 it('AC AUX is stable/discrete; DC wanders a few Hz without dropouts',()=>{
  for(const c of catalog.classes.filter(c=>c.plant==='diesel')){
   expect(c.aux.some(a=>a.kind==='dcvr'&&a.stability==='unstable')).toBe(true);
   for(const a of c.aux){
    if(a.kind==='electrical'||a.kind==='acPump'||a.kind==='acvr'){expect(a.stability).toBe('stable');expect(a.width).toBe('discrete');}
    if(a.kind==='dcvr'){expect(a.stability).toBe('unstable');expect(a.width).toBe('discrete');}
   }
  }
  const c=catalog.classes.find(x=>x.plant==='diesel')!,s=deriveSignature(c,'base',{speedKn:5,depthM:10,mode:'SNORK'});
  const w=new LineWander(s,9,c.id);const dc=w.lines.find(l=>l.lineFamily==='AUX'&&l.stability==='unstable')!,ac=w.lines.find(l=>l.lineFamily==='GRID'||(l.lineFamily==='AUX'&&l.stability==='stable'));
  expect(dc).toBeTruthy();let min=Infinity,max=-Infinity;for(let i=0;i<400;i++){w.advance(.25);expect(dc.power).toBeGreaterThan(0);min=Math.min(min,dc.frequencyHz!);max=Math.max(max,dc.frequencyHz!);}
  expect(max-min).toBeGreaterThan(1.5); // few Hz wander
  if(ac){const a0=ac.frequencyHz!;for(let i=0;i<100;i++){w.advance(.25);expect(Math.abs(ac.frequencyHz!-a0)).toBeLessThan(.05);} }
 });
});

describe('SIM + cut paths',()=>{
 it('m3-diesel-dyn example validates with a varied engine-ramp',()=>{
  expect(exampleScenarios['m3-diesel-dyn']).toEqual(dieselDynScenario());
  const s=dieselDynScenario();expect(()=>loadScenario(s)).not.toThrow();
  expect(s.contacts[0].transients?.some(t=>t.kind==='engine-ramp')).toBe(true);
 });
 it('generated SNORK/SURF diesels get an engine-ramp after CPA hold',()=>{
  let hits=0;
  for(let seed=0;seed<40;seed++){const s=generateScenario(presetToParams('easy',seed));
   for(const c of s.contacts.filter(c=>c.category!=='surface')){
    if(c.operatingMode!=='SNORK'&&c.operatingMode!=='SURF')continue;
    if(catalog.classes.find(k=>k.id===c.catalogRef!.classId)?.plant!=='diesel')continue;
    expect(c.transients?.some(t=>t.kind==='engine-ramp'&&t.at>=720)).toBe(true);hits++;}}
  expect(hits).toBeGreaterThan(10);
 });
 it('brindleflux cut schedules engine-knee and ratio-locks through it',()=>{
  const cut=getCutSeed('cut-brindleflux-snork')!;
  expect(cut.gramLooks).toContain('engine-knee');
  const s=renderCut(cut),c=s.engine.scenario.contacts[0];
  const ramp=c.transients!.find(t=>t.kind==='engine-ramp')!;expect(ramp).toBeTruthy();
  const f0=c.params.tonals!.find(l=>l.lineFamily==='CFR'&&l.harmonic===1)!.hz;
  const row=new Float32Array(s.lofar.bins);const end=Number(ramp.at)+Number(ramp.params.durationS)+5;
  while(s.simT<end&&!s.done)s.writeLofarRow(row);
  expect(c.params.plantRpmScale!).toBeLessThan(.99);
  expect(c.params.tonals!.find(l=>l.lineFamily==='CFR'&&l.harmonic===1)!.hz).toBeLessThan(f0);
 });
 it('rejects malformed engine-ramp transients',()=>{
  const s=cpaScenario();s.contacts[0].transients=[{at:10,kind:'engine-ramp',params:{durationS:0,toScale:.9}}];
  expect(()=>loadScenario(s)).toThrow(/transient/);
 });
});
