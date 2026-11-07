import {describe,it,expect} from 'vitest';
import {catalog,deriveSignature,configurePropulsion,updateDerivedSignature,effectiveParams,coupledSpeedWindowKn,commandSpeedWindowKn,generateScenario,presetToParams,mpsToKnots,resolveReference,type SubmarineClass,type ModeInput} from '../src/index.js';

const byId=(id:string)=>catalog.classes.find(c=>c.id===id)!;
const patrolKn=(c:SubmarineClass)=>Math.min(10,Math.max(8,c.params.quietSpeedKn+2),c.params.maxSpeedKn);
function sig(c:SubmarineClass,speed:number,mode:ModeInput,seed=3){const s=deriveSignature(c,'base',{speedKn:speed,depthM:50,mode});configurePropulsion(s,seed,'pres',mode);updateDerivedSignature(s,effectiveParams(c),speed,50,mode);return s;}
const modeOf=(c:SubmarineClass):ModeInput=>c.plant==='nuclear'?'NUC':'BATT';
describe('declutchToMotor flag (Lead)',()=>{
 const geared=catalog.classes.filter(c=>c.machinery.kind==='dieselGR');
 const flagged=geared.filter(c=>c.declutchToMotor),unflagged=catalog.classes.filter(c=>(c.machinery.kind==='dieselGR'||c.machinery.kind==='dieselDirect')&&!c.declutchToMotor);
 it('flag only on geared diesels with a propulsion motor; both kinds present',()=>{
  expect(flagged.map(c=>c.id).sort()).toEqual(['green-morrowcoil','red-emberbraid']);expect(geared.some(c=>!c.declutchToMotor)).toBe(true);
  for(const c of catalog.classes)if(c.declutchToMotor){expect(c.machinery.kind).toBe('dieselGR');expect(c.machinery.motor).toBeTruthy();expect(c.idKeys.declutchToMotor).toBe(true);}
 });
 it('unflagged coupled classes never declutch; out-of-band commands are rejected deterministically',()=>{
  for(const c of unflagged){const win=coupledSpeedWindowKn(c)!,inKn=(win.min+Math.min(win.max,c.params.maxSpeedKn))/2;
   const run=()=>{const s=sig(c,inKn,'SNORK');const out:unknown[]=[];for(const kn of [inKn,win.min*.4,c.params.maxSpeedKn,inKn,win.min*.2]){if(kn>c.params.maxSpeedKn)continue;updateDerivedSignature(s,effectiveParams(c),kn,10,'SNORK');const t=s.propulsion!;expect(t.declutched).toBeFalsy();out.push([kn,t.commandStatus,t.shafts[0].rpm,t.shafts[0].coupled]);}return out;};
   const a=run(),b=run();expect(b).toEqual(a);
   const s=sig(c,inKn,'SNORK'),held=s.propulsion!.shafts[0].rpm;updateDerivedSignature(s,effectiveParams(c),win.min*.4,10,'SNORK');
   expect(s.propulsion!.commandStatus).toBe('rejected');expect(s.propulsion!.shafts[0].rpm).toBeCloseTo(held,9);expect(s.propulsion!.shafts[0].coupled).toBe(true);
   updateDerivedSignature(s,effectiveParams(c),inKn,10,'SNORK');expect(s.propulsion!.commandStatus).toBe('ok');}
 });
 it('flagged classes still declutch and re-engage',()=>{
  for(const c of flagged){const win=coupledSpeedWindowKn(c)!,inKn=(win.min+Math.min(win.max,c.params.maxSpeedKn))/2,s=sig(c,inKn,'SNORK');
   expect(s.propulsion!.shafts[0].coupled).toBe(true);updateDerivedSignature(s,effectiveParams(c),win.min*.4,10,'SNORK');expect(s.propulsion!.declutched).toBe(true);expect(s.propulsion!.shafts[0].coupled).toBe(false);
   updateDerivedSignature(s,effectiveParams(c),inKn,10,'SNORK');expect(s.propulsion!.declutched).toBeFalsy();expect(s.propulsion!.shafts[0].coupled).toBe(true);}
 });
 it('scenario and AI tactics never command out-of-band speeds for unflagged coupled classes',()=>{
  let checked=0;for(const d of ['easy','regular','difficult'] as const)for(let seed=0;seed<80;seed++){const sc=generateScenario(presetToParams(d,seed));
   for(const ct of sc.contacts){if(!ct.catalogRef)continue;const k=resolveReference(ct.catalogRef).klass,w=commandSpeedWindowKn(k,ct.operatingMode??'normal');if(!w)continue;
    for(const leg of ct.motion!){const kn=mpsToKnots(leg.speed);expect(kn).toBeGreaterThanOrEqual(w.min);expect(kn).toBeLessThanOrEqual(w.max);checked++;}}}
  expect(checked).toBeGreaterThan(0);
 });
});
