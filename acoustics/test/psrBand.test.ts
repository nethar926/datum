import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,writePlantTonals,
 LOFAR_BAND_PRESETS,coupledSpeedWindowKn,coupledErpmInBand,firingRateHz,
 PSR_TYPICAL_MAX_RPM,PSR_OUTLIER_MAX_RPM,PSR_OUTLIER_MAX_SHAFT_RPM,PSR_TYPICAL_LO_HZ,PSR_TYPICAL_HI_HZ,
 PSR_ENVELOPE_LO_HZ,PSR_ENVELOPE_HI_HZ,ERPM_ENVELOPE_LO,ERPM_ENVELOPE_HI,
 surfaceTypes,
} from '../src/index.js';

const VLF_HI=LOFAR_BAND_PRESETS.find(p=>p.id==='VLF')!.band[1];
const patrolKn=(c:typeof catalog.classes[number])=>Math.min(10,Math.max(8,c.params.quietSpeedKn+2),c.params.maxSpeedKn);
const psrAt=(c:typeof catalog.classes[number],kn:number)=>c.tpk*kn/60;
const median=(xs:number[])=>{const a=[...xs].sort((u,v)=>u-v),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};

describe('PSR band (Wilson 2026-11-06)',()=>{
 it('speed = rpm / TPK and blade rate = PSR × blades',()=>{
  for(const c of catalog.classes){
   expect(c.tpk).toBeCloseTo(c.maxPsrpm/c.params.maxSpeedKn,12);
   expect(c.shafts).toBeLessThanOrEqual(2);
   const speed=c.params.maxSpeedKn*.5,s=deriveSignature(c,'base',{speedKn:speed,depthM:50,mode:c.plant==='nuclear'?'NUC':'BATT'});
   configurePropulsion(s,1,'psr',s.propulsion?.mode??'BATT');updateDerivedSignature(s,effectiveParams(c),speed,50,c.plant==='nuclear'?'NUC':'BATT');
   const t=s.propulsion!;expect(t.shafts[0].rpm).toBeCloseTo(c.tpk*speed,8);expect(t.propulsor.brHz).toBeCloseTo(t.shafts[0].hz*c.params.blades,10);
  }
 });

 it('operating PSR never exceeds class max; envelope 1–17 Hz with creep allowed below 1',()=>{
  for(const c of catalog.classes){
   const maxPsr=c.maxPsrpm/60;expect(maxPsr).toBeLessThanOrEqual(PSR_ENVELOPE_HI_HZ+1e-9);
   for(const kn of [c.params.quietSpeedKn,patrolKn(c),c.params.maxSpeedKn]){
    const psr=psrAt(c,kn);expect(psr).toBeLessThanOrEqual(maxPsr+1e-9);
    if(kn>=c.params.quietSpeedKn)expect(psr).toBeGreaterThanOrEqual(PSR_ENVELOPE_LO_HZ-1e-6);
   }
   // creep may sit below 1 Hz
   expect(psrAt(c,Math.min(1.5,c.params.quietSpeedKn*.25))).toBeLessThan(PSR_ENVELOPE_LO_HZ+2);
  }
 });

 it('most class maxima ≤550 RPM; only whitelisted outliers may reach 600–1020',()=>{
  const outliers=new Set(Object.keys(PSR_OUTLIER_MAX_SHAFT_RPM));
  expect(outliers.size).toBeGreaterThanOrEqual(1);expect(outliers.size).toBeLessThanOrEqual(2);
  for(const c of catalog.classes){
   if(outliers.has(c.id)){
    expect(c.maxPsrpm).toBe(PSR_OUTLIER_MAX_SHAFT_RPM[c.id]);
    expect(c.maxPsrpm).toBeGreaterThan(PSR_TYPICAL_MAX_RPM);
    expect(c.maxPsrpm).toBeLessThanOrEqual(PSR_OUTLIER_MAX_RPM);
   }else expect(c.maxPsrpm).toBeLessThanOrEqual(PSR_TYPICAL_MAX_RPM);
  }
 });

 it('fleet median patrol PSR sits in the typical 2–7 Hz teaching band',()=>{
  const med=median(catalog.classes.map(c=>psrAt(c,patrolKn(c))));
  expect(med).toBeGreaterThanOrEqual(PSR_TYPICAL_LO_HZ);expect(med).toBeLessThanOrEqual(PSR_TYPICAL_HI_HZ);
 });
});

describe('ERPM bands and coupling (Wilson / Lead)',()=>{
 it('diesel ERPM sheets sit in 150–2000 and ClassParams mirrors each engine band',()=>{
  for(const c of catalog.classes.filter(c=>c.plant==='diesel')){
   expect(c.params.erpmMin).toBeGreaterThanOrEqual(ERPM_ENVELOPE_LO);
   expect(c.params.erpmMax).toBeLessThanOrEqual(ERPM_ENVELOPE_HI);
   expect(c.params.erpmMin).toBeLessThanOrEqual(c.params.erpmMax);
   const p=c.machinery;expect(p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric').toBe(true);
   if(p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric'){
    for(const e of p.engines){
     expect(e.erpm.obsMin).toBeGreaterThanOrEqual(ERPM_ENVELOPE_LO-1e-9);
     expect(e.erpm.obsMax).toBeLessThanOrEqual(ERPM_ENVELOPE_HI+1e-9);
     expect(e.erpm.normal).toBeGreaterThanOrEqual(e.erpm.obsMin);expect(e.erpm.normal).toBeLessThanOrEqual(e.erpm.obsMax);
    }
    expect(c.params.erpmMin).toBeCloseTo(Math.min(...p.engines.map(e=>e.erpm.obsMin)),8);
    expect(c.params.erpmMax).toBeCloseTo(Math.max(...p.engines.map(e=>e.erpm.obsMax)),8);
   }
  }
 });

 it('diesel-direct classes are 2-stroke, ratio 1, and CFR = CSR = PSR when coupled',()=>{
  const directs=catalog.classes.filter(c=>c.params.propulsion==='dieselDirect');
  expect(directs.length).toBeGreaterThan(0);
  for(const c of directs){
   const p=c.machinery;expect(p.kind).toBe('dieselDirect');
   if(p.kind!=='dieselDirect')continue;
   expect(p.drivetrain!.kind).toBe('direct');expect(p.drivetrain!.ratio).toBe(1);
   expect(c.params.reductionRatio).toBe(1);expect(c.params.erpmMax).toBe(c.maxPsrpm);
   for(const e of p.engines){expect(e.stroke).toBe(2);expect(e.cylinders).toBe(6);}
   const win=coupledSpeedWindowKn(c)!;const speed=Math.min(c.params.maxSpeedKn,.5*(win.min+win.max));
   const s=deriveSignature(c,'base',{speedKn:speed,depthM:10,mode:'SNORK'});
   configurePropulsion(s,2,'dd', 'SNORK');updateDerivedSignature(s,effectiveParams(c),speed,10,'SNORK');
   const t=s.propulsion!;expect(t.declutched).toBeFalsy();expect(t.shafts[0].coupled).toBe(true);
   for(const e of t.engines.filter(e=>e.running)){
    expect(e.csrHz).toBeCloseTo(t.shafts[0].hz,10);expect(e.cfrHz).toBeCloseTo(e.csrHz,10); // 2-stroke
    expect(e.efrHz).toBeCloseTo(firingRateHz(e,e.erpm),10);
   }
  }
 });

 it('geared classes keep CSR = PSR × R:R while coupled; R:R stays fixed',()=>{
  for(const c of catalog.classes.filter(c=>c.params.propulsion==='dieselGearReduction')){
   const p=c.machinery;expect(p.kind).toBe('dieselGR');if(p.kind!=='dieselGR')continue;
   const ratio=p.drivetrain!.ratio;expect(ratio).toBeGreaterThan(1);
   const win=coupledSpeedWindowKn(c)!;const speed=Math.min(c.params.maxSpeedKn,Math.max(win.min+.1,.5*(win.min+win.max)));
   expect(coupledErpmInBand(c,c.tpk*speed)).toBe(true);
   const s=deriveSignature(c,'base',{speedKn:speed,depthM:12,mode:'SNORK'});
   configurePropulsion(s,3,'gr','SNORK');updateDerivedSignature(s,effectiveParams(c),speed,12,'SNORK');
   const t=s.propulsion!;expect(t.ratio).toBe(ratio);expect(t.shafts[0].coupled).toBe(true);expect(t.declutched).toBeFalsy();
   for(const e of t.engines.filter(e=>e.running))expect(e.csrHz).toBeCloseTo(t.shafts[0].hz*ratio,8);
   // Second speed still in band: same R:R
   const speed2=Math.min(win.max-.05,speed+1);updateDerivedSignature(s,effectiveParams(c),speed2,12,'SNORK');
   expect(s.propulsion!.ratio).toBe(ratio);expect(s.propulsion!.shafts[0].coupled).toBe(true);
   for(const e of s.propulsion!.engines.filter(e=>e.running))expect(e.csrHz).toBeCloseTo(s.propulsion!.shafts[0].hz*ratio,8);
  }
 });

 it('no coupled sample places ERPM outside its own engine band; declutch is deterministic',()=>{
  for(const c of catalog.classes.filter(c=>c.params.propulsion==='dieselDirect'||c.params.propulsion==='dieselGearReduction')){
   const win=coupledSpeedWindowKn(c)!;expect(win.max).toBeGreaterThanOrEqual(win.min);
   const s=deriveSignature(c,'base',{speedKn:c.params.maxSpeedKn*.5,depthM:10,mode:'SNORK'});
   configurePropulsion(s,5,'clutch','SNORK');
   for(const frac of [0,.05,.15,.35,.55,.75,.95,1]){
    const speed=c.params.maxSpeedKn*frac;updateDerivedSignature(s,effectiveParams(c),speed,10,'SNORK');
    const t=s.propulsion!,p=c.machinery;if(p.kind!=='dieselDirect'&&p.kind!=='dieselGR')continue;
    const expectCouple=speed+1e-9>=win.min&&speed-1e-9<=win.max&&speed>0;
    if(expectCouple){
     expect(t.declutched).toBeFalsy();expect(t.shafts[0].coupled).toBe(true);
     for(const e of t.engines.filter(e=>e.running)){
      const sheet=p.engines.find(x=>x.id===e.id)!;
      expect(e.erpm).toBeGreaterThanOrEqual(sheet.erpm.obsMin-1e-6);
      expect(e.erpm).toBeLessThanOrEqual(sheet.erpm.obsMax+1e-6);
     }
    }else if(frac>0&&(speed<win.min||speed>win.max)){
     if(!c.declutchToMotor){
      // Unflagged (direct drive / fixed-coupled GR): command rejected, previous valid command held in band.
      expect(t.commandStatus).toBe('rejected');expect(t.declutched).toBeFalsy();expect(t.shafts[0].coupled).toBe(true);
      for(const e of t.engines.filter(e=>e.running)){const sheet=p.engines.find(x=>x.id===e.id)!;expect(e.erpm).toBeGreaterThanOrEqual(sheet.erpm.obsMin-1e-6);expect(e.erpm).toBeLessThanOrEqual(sheet.erpm.obsMax+1e-6);}
      continue;
     }
     // Flagged declutchToMotor: shaft on motor; diesel keeps charging at band-valid ERPM.
     expect(t.declutched).toBe(true);expect(t.shafts[0].coupled).toBe(false);
     expect(t.engines.some(e=>e.running&&e.erpm>0)).toBe(true);
     for(const e of t.engines.filter(e=>e.running)){const sheet=p.engines.find(x=>x.id===e.id)!;expect(e.erpm).toBeCloseTo(sheet.erpm.normal,8);}
     expect(t.shafts[0].rpm).toBeGreaterThan(0);expect(t.motor!.rpm).toBeGreaterThan(0);
    }
   }
   // Determinism: same speed → same declutch flag
   updateDerivedSignature(s,effectiveParams(c),Math.max(0.5,win.min*.5),10,'SNORK');
   const a=s.propulsion!.declutched===true;updateDerivedSignature(s,effectiveParams(c),Math.max(0.5,win.min*.5),10,'SNORK');
   expect(s.propulsion!.declutched===true).toBe(a);
  }
 });

 it('diesel-electric: CSR independent of PSR; battery drops engine lines but keeps PSR/BR',()=>{
  const c=catalog.classes.find(c=>c.params.propulsion==='dieselElectric')!;
  const s=deriveSignature(c,'base',{speedKn:6,depthM:40,mode:'SNORK'});
  configurePropulsion(s,7,'de','SNORK');updateDerivedSignature(s,effectiveParams(c),6,40,'SNORK');writePlantTonals(s,'SNORK',c.params.electricalHarmonics,c.params.srcHzPerKn,6);
  const csr1=s.propulsion!.engines.filter(e=>e.running).map(e=>e.csrHz);expect(csr1.length).toBeGreaterThan(0);
  const psr1=s.propulsion!.shafts[0].hz;
  updateDerivedSignature(s,effectiveParams(c),12,40,'SNORK');writePlantTonals(s,'SNORK',c.params.electricalHarmonics,c.params.srcHzPerKn,12);
  expect(s.propulsion!.shafts[0].hz).toBeGreaterThan(psr1+1e-6);
  expect(s.propulsion!.engines.filter(e=>e.running).map(e=>e.csrHz)).toEqual(csr1); // speed change leaves CSR
  // Reverse: plantRpmScale changes CSR, PSR unchanged (D/E shafts are not engine-coupled)
  const psr2=s.propulsion!.shafts[0].hz;s.plantRpmScale=1.15;updateDerivedSignature(s,effectiveParams(c),12,40,'SNORK');
  expect(s.propulsion!.shafts[0].hz).toBeCloseTo(psr2,8);
  expect(s.propulsion!.engines.filter(e=>e.running).some(e=>Math.abs(e.csrHz-csr1[0])>1e-6)).toBe(true);
  s.plantRpmScale=1;
  // Battery: engine families absent (zero power / not running); PSR & BR remain.
  updateDerivedSignature(s,effectiveParams(c),8,40,'BATT');writePlantTonals(s,'BATT',c.params.electricalHarmonics,c.params.srcHzPerKn,8);
  expect(s.propulsion!.engines.every(e=>!e.running&&e.erpm===0)).toBe(true);
  expect(s.propulsion!.shafts[0].hz).toBeGreaterThan(0);expect(s.propulsion!.propulsor.brHz).toBeCloseTo(s.propulsion!.shafts[0].hz*c.params.blades,10);
  const live=s.tonals!.filter(l=>l.power>0);expect(live.some(l=>l.lineFamily==='PSR')).toBe(true);expect(live.some(l=>l.lineFamily==='BR')).toBe(true);
  for(const fam of ['CSR','CFR','EFR','EDA'] as const)expect(live.some(l=>l.lineFamily===fam)).toBe(false);
 });

 it('geared / diesel-electric CSR ≠ PSR except possible single-point coincidence',()=>{
  for(const c of catalog.classes.filter(c=>c.params.propulsion==='dieselGearReduction'||c.params.propulsion==='dieselElectric')){
   const mode=c.params.propulsion==='dieselElectric'?'SNORK':'SNORK';
   const speeds=[c.params.quietSpeedKn,patrolKn(c),c.params.maxSpeedKn*.8].filter(v=>v>0);
   let equal=0;for(const speed of speeds){
    const s=deriveSignature(c,'base',{speedKn:speed,depthM:15,mode});configurePropulsion(s,9,'neq',mode);updateDerivedSignature(s,effectiveParams(c),speed,15,mode);
    const t=s.propulsion!;for(const e of t.engines.filter(e=>e.running)){if(Math.abs(e.csrHz-t.shafts[0].hz)<1e-6)equal++;else expect(e.csrHz).not.toBeCloseTo(t.shafts[0].hz,5);}
   }
   expect(equal).toBeLessThanOrEqual(1); // coincidence at a single operating point only
  }
 });
});

describe('EFR vs VLF (report helper)',()=>{
 it('flags EFR fundamentals/harmonics that leave VLF using plantModel formulas',()=>{
  const flags:{id:string;engine:string;stroke:2|4;cylinders:number;erpm:number;csrHz:number;cfrHz:number;efrHz:number;harmonic:number;hz:number;vlfHi:number}[]=[];
  for(const c of catalog.classes.filter(c=>c.plant==='diesel')){
   const p=c.machinery;if(!('engines' in p))continue;
   for(const e of p.engines){
    const erpm=e.erpm.obsMax,csr=erpm/60,cfr=csr/(e.stroke===4?2:1),efr=firingRateHz(e,erpm);
    for(const h of [1,2,3,4,5,6]){
     const hz=efr*h;if(hz>VLF_HI)flags.push({id:c.id,engine:e.id,stroke:e.stroke,cylinders:e.cylinders,erpm,csrHz:csr,cfrHz:cfr,efrHz:efr,harmonic:h,hz,vlfHi:VLF_HI});
    }
   }
  }
  // Keep as soft documentation assert: list is non-null; rich 16-cyl stacks may leave VLF.
  expect(VLF_HI).toBe(200);expect(Array.isArray(flags)).toBe(true);
  (globalThis as {__efrVlfFlags?:typeof flags}).__efrVlfFlags=flags;
 });
});


describe('Class max-speed bands (Wilson)',()=>{
 it('diesel max ≤ 28 kn and fleet median diesel max sits in 16–19 kn',()=>{
  const diesel=catalog.classes.filter(c=>c.plant==='diesel');
  expect(diesel.length).toBeGreaterThan(5);
  for(const c of diesel)expect(c.params.maxSpeedKn).toBeLessThanOrEqual(28);
  const med=median(diesel.map(c=>c.params.maxSpeedKn));
  expect(med).toBeGreaterThanOrEqual(16);expect(med).toBeLessThanOrEqual(19);
 });
 it('nuclear classes may exceed 30 kn and sit in a 25–35 kn teaching spread',()=>{
  const nuclear=catalog.classes.filter(c=>c.plant==='nuclear');
  expect(nuclear.some(c=>c.params.maxSpeedKn>30)).toBe(true);
  for(const c of nuclear){expect(c.params.maxSpeedKn).toBeGreaterThanOrEqual(25);expect(c.params.maxSpeedKn).toBeLessThanOrEqual(35);}
 });
 it('maxSpeed × TPK = max shaft RPM; quiet stays below cavitation inception',()=>{
  for(const c of catalog.classes){
   expect(c.tpk*c.params.maxSpeedKn).toBeCloseTo(c.maxPsrpm,8);
   expect(c.params.quietSpeedKn).toBeLessThan(c.params.maxSpeedKn);
   expect(c.quietSpeedKts[1]).toBeLessThan(c.params.cavitation.surfaceInceptionKn*Math.sqrt(1+100*c.params.cavitation.depthCoefficient));
  }
 });
});

describe('surface shaft rates',()=>{
 it('surface templates expose maxRpm in the typical teaching shaft band',()=>{
  for(const t of surfaceTypes){
   expect(t.maxRpm).toBeGreaterThanOrEqual(300);expect(t.maxRpm).toBeLessThanOrEqual(PSR_TYPICAL_MAX_RPM);
   expect(t.maxRpm/60).toBeLessThanOrEqual(PSR_ENVELOPE_HI_HZ);
  }
 });
});
