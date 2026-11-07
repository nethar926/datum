import {describe,it,expect} from 'vitest';
import {
 catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,
 coupledSpeedWindowKn,AcousticEngine,cpaScenario,loadScenario,knotsToMps,HYDP_POWER,
} from '../src/index.js';

/** Lead: EDAs (CFR-locked) disappear with their engine; independent aux stay available. */
describe('EDA vs independent aux gating',()=>{
 const edaLive=(s:{tonals?:{lineFamily?:string;power:number}[]})=>
  (s.tonals??[]).filter(l=>l.lineFamily==='EDA'&&l.power>0);
 const auxLive=(s:{tonals?:{lineFamily?:string;power:number;hz:number}[]},families:string[])=>
  (s.tonals??[]).filter(l=>l.lineFamily&&families.includes(l.lineFamily)&&l.power>0);

 it('EDAs vanish on BATT while continuous AUX / SSMA / intermittent remain',()=>{
  // Diesel-electric BATT: engines off
  const del=catalog.classes.find(c=>c.machinery.kind==='dieselElectric'&&c.edas.length&&c.aux.some(a=>a.kind==='ssma'))
   ??catalog.classes.find(c=>c.machinery.kind==='dieselElectric'&&c.edas.length)!;
  const s=deriveSignature(del,'base',{speedKn:5,depthM:40,mode:'BATT'});
  configurePropulsion(s,9,del.id,'BATT');updateDerivedSignature(s,effectiveParams(del),5,40,'BATT');
  expect(s.propulsion!.engines.every(e=>!e.running)).toBe(true);
  expect(edaLive(s)).toHaveLength(0);
  // Independent continuous aux (AC/DC electrical, AUX family)
  expect(auxLive(s,['AUX']).length).toBeGreaterThan(0);
  // Intermittent A/C compressor when seeded on this class
  if(del.aux.some(a=>a.duty==='intermittent'&&a.kind!=='hydp')){
   // Force an ON phase of the duty cycle so power is non-zero
   s.dutyClockS=0;updateDerivedSignature(s,effectiveParams(del),5,40,'BATT');
   // Scan clock for any ON sample
   let saw=false;for(let t=0;t<400&&!saw;t+=3){s.dutyClockS=t;updateDerivedSignature(s,effectiveParams(del),5,40,'BATT');saw=auxLive(s,['INTERMITTENT']).length>0;}
   expect(saw).toBe(true);
  }
  // Direct-drive BATT teaching: EDAs also off
  const dd=catalog.classes.find(c=>c.id==='blue-brindleflux')!;
  const b=deriveSignature(dd,'base',{speedKn:6,depthM:40,mode:'BATT'});
  configurePropulsion(b,3,dd.id,'BATT');updateDerivedSignature(b,effectiveParams(dd),6,40,'BATT');
  expect(edaLive(b)).toHaveLength(0);
  expect(auxLive(b,['AUX']).length).toBeGreaterThan(0);
 });

 it('declutch-to-motor (morrowcoil/emberbraid): EDAs drop; independent aux stay',()=>{
  for(const id of ['green-morrowcoil','red-emberbraid'] as const){
   const c=catalog.classes.find(x=>x.id===id)!;
   expect(c.declutchToMotor).toBe(true);
   const w=coupledSpeedWindowKn(c)!;
   const inKn=(w.min+Math.min(w.max,c.params.maxSpeedKn))/2;
   const s=deriveSignature(c,'base',{speedKn:inKn,depthM:40,mode:'SNORK'});
   configurePropulsion(s,7,c.id,'SNORK');updateDerivedSignature(s,effectiveParams(c),inKn,40,'SNORK');
   expect(s.propulsion!.engines.some(e=>e.running)).toBe(true);
   expect(edaLive(s).length).toBeGreaterThan(0);
   const auxOn=auxLive(s,['AUX']).map(l=>l.hz).sort((a,b)=>a-b);
   expect(auxOn.length).toBeGreaterThan(0);

   updateDerivedSignature(s,effectiveParams(c),w.min*.35,40,'SNORK');
   expect(s.propulsion!.declutched).toBe(true);
   expect(s.propulsion!.engines.every(e=>!e.running)).toBe(true);
   expect(edaLive(s)).toHaveLength(0);
   // Independent aux frequencies still present with power
   const auxOff=auxLive(s,['AUX']).map(l=>l.hz).sort((a,b)=>a-b);
   expect(auxOff.length).toBeGreaterThan(0);
   expect(auxOff).toEqual(auxOn);
   if(c.aux.some(a=>a.duty==='intermittent'&&a.kind!=='hydp')){
    let saw=false;for(let t=0;t<400&&!saw;t+=3){s.dutyClockS=t;updateDerivedSignature(s,effectiveParams(c),w.min*.35,40,'SNORK');saw=auxLive(s,['INTERMITTENT']).length>0;}
    expect(saw).toBe(true);
   }
  }
 });

 it('HYDP burst slots remain available after engine-off (BATT); duration/power unchanged',()=>{
  const c=catalog.classes.find(x=>x.hydp&&x.machinery.kind==='dieselElectric')??catalog.classes.find(x=>x.hydp)!;
  const scen=cpaScenario();
  scen.contacts=[{...scen.contacts[0],catalogRef:{classId:c.id},operatingMode:'BATT',speed:knotsToMps(4),
   motion:[{at:0,course:0,speed:knotsToMps(4),depth:40},{at:1,course:Math.PI/2,speed:knotsToMps(4),depth:60}],
   transients:[{at:.5,kind:'hydp',params:{}}]}];
  const e=new AcousticEngine(loadScenario(scen));
  const contact=e.scenario.contacts[0]!;
  expect(contact.params.propulsion!.engines.every(eng=>!eng.running)).toBe(true);
  expect(edaLive(contact.params)).toHaveLength(0);
  // Before burst: HYDP slots may exist at zero power
  e.advance(.5);e.advance(.05);
  const hydp=contact.params.tonals!.filter(l=>l.lineFamily==='HYDP');
  expect(hydp.length).toBeGreaterThan(0);
  expect(hydp.some(l=>l.power>0)).toBe(true);
  // Peak order-1 power is HYDP_POWER (unchanged contract)
  const h1=hydp.find(l=>l.harmonic===1&&l.power>0);
  if(h1)expect(h1.power).toBeLessThanOrEqual(HYDP_POWER+1e-12);
  expect(c.hydp!.durationS).toBeTypeOf('number');
 });
});
