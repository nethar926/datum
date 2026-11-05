import {it,expect} from 'vitest';
import {OPERATING_MODES,catalog,deriveSignature,updateDerivedSignature,effectiveParams,edaFrequencyHz,validateCatalog,buildCompendium,matchClasses,configurePropulsion,LineWander,AcousticEngine,cpaScenario,knotsToMps} from '../src/index.js';
const within=(n:number,r:readonly number[])=>{expect(n).toBeGreaterThanOrEqual(r[0]);expect(n).toBeLessThanOrEqual(r[1]);};
it('canonical mode list is exactly SURF SNORK D/E BATT AIP NUC',()=>{expect(OPERATING_MODES).toEqual(['SURF','SNORK','D/E','BATT','AIP','NUC']);for(const c of catalog.classes)expect(Object.keys(c.idKeys.linesVisiblePerMode)).toEqual(OPERATING_MODES);});
it('every sub has TPK and a validated nested propeller; truth precomputes propulsor and CPP validity',()=>{
 for(const c of catalog.classes){expect(c.tpk).toBeGreaterThan(0);expect(c.propeller).toEqual({shafts:c.shafts,blades:c.params.blades,type:c.propellerType});within(c.propeller.blades,[3,9]);const mode=c.plant==='nuclear'?'NUC':'BATT',s=deriveSignature(c,'base',{speedKn:1,depthM:50,mode}),t=s.propulsion!,p=t.propulsor;
  expect(t.tpk).toBe(c.tpk);expect(t.tpkValid).toBe(c.propeller.type!=='cpp');expect(p).toEqual({shafts:c.shafts,blades:c.params.blades,bladeType:c.propeller.type,brHz:t.shafts[0].hz*c.params.blades});if(c.propeller.type==='cpp')expect(t.tpkMinKts).toBe(c.tpkMinKts);
  updateDerivedSignature(s,effectiveParams(c),4,50,mode);expect(s.propulsion).toBe(t);expect(t.propulsor).toBe(p);expect(t.tpkValid).toBe(true);expect(p.brHz).toBe(t.shafts[0].hz*c.params.blades);within(p.brHz/t.shafts[0].hz,c.idKeys.ratios.brToPsr);
 }
 for(const blades of [2,10]){const c=structuredClone(catalog);c.classes[0].propeller.blades=blades;expect(()=>validateCatalog(c)).toThrow(/propeller/);}
});
it('LOP is CFR x 27.75, strictly between H27 and H28, with 1-3 fractional-order EDAs per diesel class',()=>{
 const hz=edaFrequencyHz(2.5,27.75);expect(hz).toBe(69.375);expect(hz).toBeGreaterThan(27*2.5);expect(hz).toBeLessThan(28*2.5);
 for(const c of catalog.classes.filter(c=>c.plant==='diesel')){within(c.edas.length,[1,3]);expect(c.edas.some(e=>!Number.isInteger(e.cfrMultiple))).toBe(true);const s=deriveSignature(c,'base',{speedKn:5,depthM:5,mode:'SNORK'});for(const l of s.tonals!.filter(l=>l.lineFamily==='EDA')){const engine=s.propulsion!.engines[l.engineIndex!];expect(l.eda).toEqual({name:c.edas.find(e=>e.name===l.eda!.name)!.name,cfrMultiple:c.edas.find(e=>e.name===l.eda!.name)!.cfrMultiple});expect(l.fundamentalHz).toBe(edaFrequencyHz(engine.cfrHz,l.eda!.cfrMultiple));expect(l.hz).toBe(l.fundamentalHz!*l.harmonic!);}
  const refs=s.tonals!.filter(l=>l.eda).map(l=>l.eda);updateDerivedSignature(s,effectiveParams(c),6,5,'SNORK');s.tonals!.filter(l=>l.eda).forEach((l,i)=>expect(l.eda).toBe(refs[i]));
 }
});
it('EDA metadata reaches preallocated tactical truth records',()=>{
 const c=catalog.classes.find(c=>c.plant==='diesel')!,scenario=cpaScenario();scenario.contacts=[{...scenario.contacts[0],catalogRef:{classId:c.id},operatingMode:'SNORK',speed:knotsToMps(5),motion:[{at:0,course:0,speed:knotsToMps(5),depth:5}]}];const e=new AcousticEngine(scenario),lines=e.tactical().truth!.contacts[0].lines,eda=lines.find(l=>l.lineFamily==='EDA')!;expect(eda.eda).toEqual({name:'LOP',cfrMultiple:27.75});const metadata=eda.eda;e.advance(.25);expect(e.tactical().truth!.contacts[0].lines).toBe(lines);expect(eda.eda).toBe(metadata);expect(eda.f0Hz).toBe(eda.fundamentalHz!*eda.harmonic!);
});
it('HYDP and aux duty are validated metadata only, with the fictional 367.77-Hz case in idKeys',()=>{
 const c=catalog.classes.find(c=>c.hydp?.nominalHz===367.77)!;expect(c).toBeTruthy();within(c.hydp!.nominalHz,c.idKeys.hydp!.nominalHz);within(c.hydp!.pairSpacingHz,c.idKeys.hydp!.pairSpacingHz);within(c.hydp!.durationS,c.idKeys.hydp!.durationS);
 const copy=structuredClone(c);copy.hydp!.nominalHz=379.19;copy.aux[0].duty='intermittent';copy.aux[0].dutyOnS=[20,40];copy.aux[0].dutyOffS=[50,90];const state={speedKn:5,depthM:5,mode:'SNORK' as const};expect(deriveSignature(c,'base',state).tonals).toEqual(deriveSignature(copy,'base',state).tonals);
 expect(catalog.classes.some(c=>c.aux.some(a=>a.dutyOnS&&a.dutyOffS))).toBe(true);for(const row of catalog.classes)for(const a of row.aux)expect(['continuous','intermittent']).toContain(a.duty);
 const invalid=structuredClone(catalog);invalid.classes[0].aux[0].duty='intermittent';invalid.classes[0].aux[0].dutyOnS=[5,1];expect(()=>validateCatalog(invalid)).toThrow(/duty/);
});
it('speed windows fade over one knot and retain named SRC/SWATH keys and truth layouts',()=>{
 const c=catalog.classes[1],w=c.speedWindows!.find(w=>w.kind==='SRC')!,p=effectiveParams(c),s=deriveSignature(c,'base',{speedKn:w.speedKts[0],depthM:50,mode:'BATT'}),g=s.speedGated!.find(g=>g.name===w.name)!;
 for(const [speed,gain] of [[w.speedKts[0]-.1,0],[w.speedKts[0],0],[w.speedKts[0]+.25,.25],[w.speedKts[0]+1,1],[w.speedKts[1]-.5,.5],[w.speedKts[1]+.1,0]]){updateDerivedSignature(s,p,speed,50,'BATT');expect(g.gain).toBeCloseTo(gain,12);}expect(c.idKeys.speedWindows.map(g=>g.name)).toEqual(s.speedGated!.map(g=>g.name));
});
it('nuclear ranged keys enclose fifty seeded hull turbine, mesh, TG and reduction values',()=>{
 for(const c of catalog.classes.filter(c=>c.plant==='nuclear')){const keys=c.idKeys,p=c.machinery;if(!('mainTurbines' in p))throw new Error('missing nuclear sheet');within(p.mainTurbines.drivetrain.ratio,keys.reductionRatio!);expect(keys.gearMeshHz).toHaveLength(p.mainTurbines.drivetrain.stages.length);expect(keys.turboGenHz).toHaveLength(p.reactorSets.length);
  for(let seed=0;seed<50;seed++){const speed=c.params.maxSpeedKn*(seed+1)/50,s=deriveSignature(c,'base',{speedKn:speed,depthM:100,mode:'NUC'});configurePropulsion(s,seed,'nuclear-key','NUC');updateDerivedSignature(s,effectiveParams(c),speed,100,'NUC');const wander=new LineWander(s,seed,'nuclear-key');wander.advance(.25);for(const l of wander.lines){const hz=l.frequencyHz!/(l.harmonic??1);if(l.lineFamily==='TURBINE')within(hz,keys.turbineRateHz!);if(l.lineFamily==='TG')expect(keys.turboGenHz!.some(r=>hz>=r[0]&&hz<=r[1])).toBe(true);if(l.lineFamily==='MESH'&&p.kind==='nuclearGR')expect(keys.gearMeshHz!.some(r=>hz>=r[0]&&hz<=r[1])).toBe(true);}}
 }
});
it('matchClasses compares only class idKeys, reports contradictions and ranks deterministically',()=>{
 const view=buildCompendium().classes,observations={gridHz:60,mode:'SNORK' as const,lineFamilies:['CSR','CFR','EFR','EDA'] as const,brToPsr:5,edaCfrMultiples:[27.75]},a=matchClasses(observations);expect(a).toEqual(matchClasses(observations,view));expect(a).toEqual(matchClasses(JSON.parse(JSON.stringify(observations))));expect(a).toHaveLength(catalog.classes.length);expect(a[0].score).toBe(1);expect(a[0].ruledOutBy).toEqual([]);expect(a[0].matched).toContain('brToPsr');expect(a.some(m=>m.ruledOutBy.includes('gridHz'))).toBe(true);expect(a.some(m=>m.ruledOutBy.includes('lineFamily:CSR'))).toBe(true);
 const k=structuredClone(view[0].idKeys),minimal=[{id:'keys-only',idKeys:k}];expect(matchClasses({gridHz:k.gridHz},minimal)[0]).toEqual({id:'keys-only',score:1,matched:['gridHz'],ruledOutBy:[]});k.gridHz=k.gridHz===50?60:50;expect(matchClasses({gridHz:view[0].idKeys.gridHz},minimal)[0].ruledOutBy).toEqual(['gridHz']);expect(matchClasses({},minimal)[0].score).toBe(0);expect(matchClasses({tpk:NaN},minimal)[0].ruledOutBy).toEqual(['tpk']);
});

it('matcher checks ranged family, nuclear, HYDP and gearing evidence without consulting source sheets',()=>{
 const c=catalog.classes.find(c=>c.plant==='nuclear'&&c.hydp&&c.idKeys.gearMeshHz!.length)!,k=c.idKeys,middle=(r:readonly number[])=>(r[0]+r[1])/2,rows=[{id:c.id,idKeys:k}];
 const a=matchClasses({mode:'NUC',lineFamilies:['TURBINE','TG'],familyFundamentalsHz:{TURBINE:middle(k.turbineRateHz!)},turbineRateHz:middle(k.turbineRateHz!),reductionRatio:middle(k.reductionRatio!),gearRatio:middle(k.ratios.gear),gearMeshHz:middle(k.gearMeshHz![0]),turboGenHz:middle(k.turboGenHz![0]),hydpHz:middle(k.hydp!.nominalHz)},rows)[0];expect(a.score).toBe(1);expect(a.ruledOutBy).toEqual([]);expect(a.matched).toContain('fundamental:TURBINE');
 const bad=matchClasses({familyFundamentalsHz:{TURBINE:k.turbineRateHz![1]+1},reductionRatio:-1,turboGenHz:1e9,hydpHz:NaN},rows)[0];expect(bad.score).toBe(0);expect(bad.ruledOutBy).toEqual(['fundamental:TURBINE','reductionRatio','hydpHz','turboGenHz']);
 const diesel=catalog.classes.find(c=>c.plant==='diesel')!;expect(matchClasses({mode:'BATT',lineFamilies:['EDA']},[{id:diesel.id,idKeys:diesel.idKeys}])[0].ruledOutBy).toContain('lineFamily:EDA');
});
