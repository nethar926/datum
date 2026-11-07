import {describe,it,expect} from 'vitest';
import {catalog,deriveSignature,configurePropulsion,updateDerivedSignature,effectiveParams,coupledSpeedWindowKn,generateScenario,presetToParams,AcousticEngine,resolveReference,type SubmarineClass,type Signature} from '../src/index.js';

const coupled=catalog.classes.filter(c=>c.machinery.kind==='dieselDirect'||c.machinery.kind==='dieselGR');
/** Band rule: every running engine inside its own band, or declutched (flagged only), or shaft stopped. */
function checkBand(c:SubmarineClass,s:Signature):'band'|'declutched'|'stopped'|'idle'{
 const t=s.propulsion!,p=c.machinery as Extract<SubmarineClass['machinery'],{engines:unknown}>;
 if(t.declutched){expect(c.declutchToMotor).toBe(true);expect(t.engines.some(e=>e.running)).toBe(true);for(const e of t.engines.filter(e=>e.running)){const b=p.engines.find(x=>x.id===e.id)!.erpm;expect(e.erpm).toBeGreaterThanOrEqual(b.obsMin-1e-6);expect(e.erpm).toBeLessThanOrEqual(b.obsMax+1e-6);}return 'declutched';}
 if(t.shafts[0].rpm<=0){expect(t.engines.every(e=>!e.running)).toBe(true);return 'stopped';}
 let any=false;for(const e of t.engines){if(!e.running)continue;any=true;const b=p.engines.find(x=>x.id===e.id)!.erpm;expect(e.erpm).toBeGreaterThanOrEqual(b.obsMin-1e-6);expect(e.erpm).toBeLessThanOrEqual(b.obsMax+1e-6);}
 return any?'band':'idle';
}
describe('engine band holds through the engine-ramp knee (Lead)',()=>{
 it('every coupled class × seed × knee depth: ERPM in band, declutched (flagged), or stopped',()=>{
  for(const c of coupled){const w=coupledSpeedWindowKn(c)!;
   for(let seed=0;seed<40;seed++){const kn=w.min+(Math.min(w.max,c.params.maxSpeedKn)-w.min)*((seed%10)/9),mode=seed%2?'SNORK' as const:'SURF' as const;
    const s=deriveSignature(c,'base',{speedKn:kn,depthM:mode==='SURF'?0:10,mode});configurePropulsion(s,seed,`knee:${c.id}`,mode);
    for(const scale of [1,.95,.9,.86,.82,.75,.6]){s.plantRpmScale=scale;updateDerivedSignature(s,effectiveParams(c),kn,mode==='SURF'?0:10,mode);const r=checkBand(c,s);
     if(!c.declutchToMotor)expect(r).not.toBe('declutched');
     if(s.propulsion!.kneeLimited)expect(c.declutchToMotor).toBeFalsy();}}}
 });
 it('unflagged knee near the window floor is bounded at the band minimum; flagged declutches',()=>{
  for(const c of coupled){const w=coupledSpeedWindowKn(c)!,kn=w.min*1.01,s=deriveSignature(c,'base',{speedKn:kn,depthM:10,mode:'SNORK'});configurePropulsion(s,1,'floor','SNORK');
   s.plantRpmScale=.82;updateDerivedSignature(s,effectiveParams(c),kn,10,'SNORK');const t=s.propulsion!;
   if(c.declutchToMotor){expect(t.declutched).toBe(true);expect(t.shafts[0].coupled).toBe(false);}
   else{expect(t.kneeLimited).toBe(true);expect(t.declutched).toBeFalsy();const lo=Math.max(...(c.machinery as {engines:{id:string;erpm:{obsMin:number}}[]}).engines.filter(e=>t.engines.find(x=>x.id===e.id)!.running).map(e=>e.erpm.obsMin));expect(Math.min(...t.engines.filter(e=>e.running).map(e=>e.erpm))).toBeCloseTo(lo,6);}
   s.plantRpmScale=1;updateDerivedSignature(s,effectiveParams(c),kn,10,'SNORK');expect(s.propulsion!.declutched).toBeFalsy();expect(s.propulsion!.kneeLimited).toBeFalsy();}
 });
 it('every generated scenario timestep (through the knee) keeps coupled ERPM in band',()=>{
  let samples=0,knees=0;
  for(const d of ['easy','regular','difficult'] as const)for(let seed=0;seed<40;seed++){const e=new AcousticEngine(generateScenario(presetToParams(d,seed)));
   const subs=e.scenario.contacts.filter(c=>c.catalogRef&&['dieselDirect','dieselGR'].includes(resolveReference(c.catalogRef).klass.machinery.kind));if(!subs.length)continue;
   for(let t=0;t<1200;t+=10){e.advance(10);for(const c of subs){const k=resolveReference(c.catalogRef!).klass;checkBand(k,c.params);if(!k.declutchToMotor)expect(c.params.propulsion!.declutched).toBeFalsy();samples++;if((c.params.plantRpmScale??1)<1)knees++;}}}
  expect(samples).toBeGreaterThan(0);expect(knees).toBeGreaterThan(0);
 });
});
