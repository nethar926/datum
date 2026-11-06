import {it,expect} from 'vitest';
import {catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,matchClasses,buildCompendium,LineWander,validateVesselPlant,vanePassHz,fictionalVaneCount} from '../src/index.js';
const within=(n:number,r:readonly number[])=>{expect(n).toBeGreaterThanOrEqual(r[0]);expect(n).toBeLessThanOrEqual(r[1]);};
const nuclear=catalog.classes.filter(c=>c.plant==='nuclear'),diesel=catalog.classes.filter(c=>c.plant==='diesel');
const turbines=(c:typeof catalog.classes[number])=>{const p=c.machinery;if(!('mainTurbines' in p))throw new Error('not nuclear');return p.mainTurbines;};
it('every nuclear class carries a fictional integer vaneCount in 20..80, distinct per class',()=>{
 const counts=nuclear.map(c=>turbines(c).vaneCount);for(const n of counts){expect(Number.isInteger(n)).toBe(true);within(n,[20,80]);}
 expect(new Set(counts).size).toBe(counts.length);for(let i=0;i<40;i++)within(fictionalVaneCount(i),[20,80]);expect(vanePassHz(10,37)).toBe(370);
});
it('VANE lines = turbine rotor Hz × vaneCount at harmonics 1..3, TURBINE rotor lines kept',()=>{
 for(const c of nuclear){const vanes=turbines(c).vaneCount;for(const frac of [.3,.8]){const speed=c.params.maxSpeedKn*frac,s=deriveSignature(c,'base',{speedKn:speed,depthM:100,mode:'NUC'});configurePropulsion(s,3,'vane','NUC');updateDerivedSignature(s,effectiveParams(c),speed,100,'NUC');
  const rotor=s.tonals!.filter(l=>l.lineFamily==='TURBINE'&&l.reactorId===undefined),vane=s.tonals!.filter(l=>l.lineFamily==='VANE');
  expect(rotor.length).toBeGreaterThan(0);expect(vane.length).toBe(rotor.length);
  for(const v of vane){const r=rotor.find(l=>l.shaftIndex===v.shaftIndex&&l.harmonic===1)!;expect(v.family).toBe('turbine');expect([1,2,3]).toContain(v.harmonic);expect(v.fundamentalHz).toBeCloseTo(r.hz*vanes,9);expect(v.hz).toBeCloseTo(r.hz*vanes*v.harmonic!,9);expect(v.power).toBeGreaterThan(0);}
  expect(vane.filter(v=>v.shaftIndex===vane[0].shaftIndex).map(v=>v.harmonic)).toEqual([1,2,3]);
 }}
});
it('diesel classes emit no VANE lines and have no vane idKeys',()=>{
 for(const c of diesel){expect(c.idKeys.vaneRateHz).toBeUndefined();expect(c.idKeys.vaneCount).toBeUndefined();expect(c.idKeys.harmonicFamilies.some(f=>f.lineFamily==='VANE')).toBe(false);for(const m of Object.values(c.idKeys.linesVisiblePerMode))expect(m).not.toContain('VANE');
  const s=deriveSignature(c,'base',{speedKn:c.params.maxSpeedKn*.5,depthM:10,mode:'SNORK'});expect(s.tonals!.some(l=>l.lineFamily==='VANE')).toBe(false);}
});
it('nuclear idKeys expose vaneRateHz = turbineRateHz × vaneCount, vaneCount range, VANE visible in NUC',()=>{
 for(const c of nuclear){const k=c.idKeys,n=turbines(c).vaneCount;expect(k.vaneCount).toEqual([n,n]);expect(k.vaneRateHz![0]).toBeCloseTo(k.turbineRateHz![0]*n,9);expect(k.vaneRateHz![1]).toBeCloseTo(k.turbineRateHz![1]*n,9);
  expect(k.linesVisiblePerMode.NUC).toContain('VANE');expect(k.linesVisiblePerMode.AIP).not.toContain('VANE');const f=k.harmonicFamilies.find(f=>f.lineFamily==='VANE')!;expect(f.orders).toEqual([1,3]);within(k.vaneRateHz![1],[0,f.fundamentalHz[1]*1.0001]);}
});
it('fifty seeded hulls keep VANE fundamentals inside vaneRateHz',()=>{
 for(const c of nuclear)for(let seed=0;seed<50;seed++){const speed=c.params.maxSpeedKn*(seed+1)/50,s=deriveSignature(c,'base',{speedKn:speed,depthM:100,mode:'NUC'});configurePropulsion(s,seed,'vane-key','NUC');updateDerivedSignature(s,effectiveParams(c),speed,100,'NUC');const w=new LineWander(s,seed,'vane-key');w.advance(.25);
  for(const l of w.lines)if(l.lineFamily==='VANE'){const hz=l.frequencyHz!/(l.harmonic??1);within(hz,c.idKeys.vaneRateHz!);}}
});
it('matchClasses ranks the class whose vane keys match and rules out diesels / wrong counts',()=>{
 const view=buildCompendium().classes;
 for(const c of nuclear){const k=c.idKeys,mid=(k.vaneRateHz![0]+k.vaneRateHz![1])/2,ranked=matchClasses({vaneRateHz:mid,vaneCount:k.vaneCount![0]},view);
  expect(ranked[0].id).toBe(c.id);expect(ranked[0].score).toBe(1);expect(ranked[0].matched).toEqual(['vaneRateHz','vaneCount']);expect(ranked.filter(m=>m.score===1).map(m=>m.id)).toEqual([c.id]);
  for(const d of diesel)expect(ranked.find(m=>m.id===d.id)!.ruledOutBy).toEqual(['vaneRateHz','vaneCount']);
  expect(matchClasses({mode:'NUC',lineFamilies:['VANE'],familyFundamentalsHz:{VANE:mid}},[{id:c.id,idKeys:k}])[0].score).toBe(1);
  expect(matchClasses({vaneCount:k.vaneCount![0]+1,vaneRateHz:k.vaneRateHz![1]*1.5},[{id:c.id,idKeys:k}])[0].ruledOutBy).toEqual(['vaneRateHz','vaneCount']);}
});
it('validation rejects a missing or non-integer turbine vaneCount',()=>{
 const c=nuclear[0],spec=structuredClone({maxPsrpm:c.maxPsrpm,shafts:c.shafts,shaftMismatchPct:c.shaftMismatchPct,machinery:c.machinery,edas:c.edas,aux:c.aux,hydp:c.hydp});
 expect(()=>validateVesselPlant(spec as never,c.params.electricalHz)).not.toThrow();
 for(const bad of [undefined,24.5,0,500]){const s=structuredClone(spec);(s.machinery as {mainTurbines:{vaneCount?:number}}).mainTurbines.vaneCount=bad;expect(()=>validateVesselPlant(s as never,c.params.electricalHz)).toThrow();}
});
it('diesel TPK outlier softened: every diesel class sits in the ~8-13 TPK band (Mistacorn 150 rpm / 12 kn)',()=>{
 for(const c of diesel){within(c.tpk,[8,13]);expect(c.tpk).toBeCloseTo(c.maxPsrpm/c.params.maxSpeedKn,12);}
 const m=catalog.classes.find(c=>c.id==='red-dorhan-mistacorn')!;expect(m.maxPsrpm).toBe(150);expect(m.params.maxSpeedKn).toBe(12);expect(m.tpk).toBeCloseTo(12.5,12);
 for(const c of nuclear)within(c.tpk,[5,7]);
});
