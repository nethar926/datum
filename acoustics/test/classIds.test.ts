import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {catalog,surfaceTypes,createSurfacePool,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,matchClasses,AcousticEngine,cpaScenario,knotsToMps,type ClassObservations,type IdKeys} from '../src/index.js';
import {identityBands,varyPlantIdentity} from '../src/catalog/plantIdentity.js';
const mid=(r:readonly number[]) => (r[0]+r[1])/2;
const disjoint=(a:readonly number[],b:readonly number[])=>a[1]<b[0]||b[1]<a[0];
const observations=(k:IdKeys):ClassObservations=>{
 const mode=k.engine?'SNORK':'NUC',visible=k.linesVisiblePerMode[mode];
 return {gridHz:k.gridHz,mode,lineFamilies:visible,familyFundamentalsHz:Object.fromEntries(k.harmonicFamilies.filter(f=>visible.includes(f.lineFamily)).map(f=>[f.lineFamily,mid(f.fundamentalHz)])),brToPsr:mid(k.ratios.brToPsr),gearRatio:mid(k.ratios.gear),tpk:mid(k.tpk),...(k.hydp?{hydpHz:mid(k.hydp.nominalHz)}:{}),...(k.ratios.efrToCsr?{efrToCsr:mid(k.ratios.efrToCsr)}:{}),...(k.ratios.msrToMotorShaft?{msrToMotorShaft:mid(k.ratios.msrToMotorShaft),msrToPsr:mid(k.ratios.msrToPsr!)}:{}),...(k.turbineRateHz?{turbineRateHz:mid(k.turbineRateHz),reductionRatio:mid(k.reductionRatio!),...(k.gearMeshHz?.length?{gearMeshHz:mid(k.gearMeshHz[0])}:{}),turboGenHz:mid(k.turboGenHz![0])}:{}),...(k.edas?{edaCfrMultiples:k.edas.map(e=>mid(e.cfrMultiple))}:{}),speedWindows:k.speedWindows.map(w=>w.kind==='SRC'?{kind:'SRC' as const,hz:mid([w.loHz,w.hiHz]),speedKts:mid(w.speedKts)}:{kind:'SWATH' as const,loHz:w.loHz,hiHz:w.hiHz,speedKts:mid(w.speedKts)})};
};
it('class pairs have non-overlapping SWATH bands; HYDP bands disjoint among classes that carry HYDP',()=>{
 const withHydp=catalog.classes.filter(c=>c.hydp&&c.idKeys.hydp);
 expect(withHydp.length).toBeGreaterThanOrEqual(14); // ~2/3 keep HYDP
 expect(withHydp.length).toBeLessThan(catalog.classes.length); // optional
 expect(withHydp.some(c=>c.plant==='diesel')&&withHydp.some(c=>c.plant==='nuclear')).toBe(true);
 expect(catalog.classes.some(c=>!c.hydp&&c.plant==='diesel')&&catalog.classes.some(c=>!c.hydp&&c.plant==='nuclear')).toBe(true);
 for(let i=0;i<withHydp.length;i++)for(let j=i+1;j<withHydp.length;j++){
  expect(disjoint(withHydp[i].idKeys.hydp!.nominalHz,withHydp[j].idKeys.hydp!.nominalHz),`${withHydp[i].id}/${withHydp[j].id}: HYDP`).toBe(true);
 }
 for(let i=0;i<catalog.classes.length;i++)for(let j=i+1;j<catalog.classes.length;j++){
  const a=catalog.classes[i].idKeys,b=catalog.classes[j].idKeys,aw=a.speedWindows.find(w=>w.kind==='SWATH')!,bw=b.speedWindows.find(w=>w.kind==='SWATH')!;
  expect(disjoint([aw.loHz,aw.hiHz],[bw.loHz,bw.hiHz]),'SWATH').toBe(true);expect(aw.hiHz).toBeLessThan(500);expect(bw.hiHz).toBeLessThan(500);
 }
});
it('midpoint observations of each class rank it uniquely first using unchanged matchClasses',()=>{
 for(const c of catalog.classes){const obs=observations(c.idKeys),ranked=matchClasses(obs);expect(ranked[0].id).toBe(c.id);expect(ranked[0].score).toBe(1);expect(ranked[0].ruledOutBy).toEqual([]);expect(ranked[0].score).toBeGreaterThan(ranked[1].score);expect(matchClasses(JSON.parse(JSON.stringify(obs)))).toEqual(ranked);if(obs.hydpHz!==undefined){const hydpOnly=matchClasses({hydpHz:obs.hydpHz});expect(hydpOnly[0].id).toBe(c.id);expect(hydpOnly[0].score).toBeGreaterThan(hydpOnly[1].score);}}
});
it('ID-keyed EDA definitions are varied fractional orders, including the LOP teaching example',()=>{
 const diesel=catalog.classes.filter(c=>c.plant==='diesel'),orders=new Set<string>();for(const c of diesel){expect(c.edas.length).toBeGreaterThanOrEqual(1);expect(c.edas.length).toBeLessThanOrEqual(3);for(const e of c.edas){expect([.25,.5,.75]).toContain(e.cfrMultiple%1);expect(e.name.length).toBeGreaterThan(0);}orders.add(JSON.stringify(c.edas.map(e=>e.cfrMultiple)));const copy=varyPlantIdentity(structuredClone(c),c.id);expect(copy.edas).toEqual(c.edas);}expect(orders.size).toBe(diesel.length);expect(new Set(diesel.flatMap(c=>c.edas.map(e=>e.name))).size).toBeGreaterThan(3);expect(diesel.some(c=>c.edas.some(e=>e.name==='LOP'&&e.cfrMultiple===27.75))).toBe(true);
});
it('slot-pass features occur on only some diesel classes, with 2.5 Hz x 124 = 310 Hz preserved',()=>{
 const diesel=catalog.classes.filter(c=>c.plant==='diesel'),fitted=diesel.filter(c=>c.motorSlots!==undefined);expect(fitted.length).toBeGreaterThan(1);expect(fitted.length).toBeLessThan(diesel.length);expect(catalog.classes.filter(c=>c.plant==='nuclear').every(c=>c.motorSlots===undefined)).toBe(true);for(const c of fitted){expect(c.motorSlots).toBeGreaterThanOrEqual(48);expect(c.motorSlots).toBeLessThanOrEqual(200);expect(Number.isInteger(c.motorSlots)).toBe(true);}
 const example=fitted.find(c=>c.motorSlots===124)!,motor=example.machinery.motor!,speedKn=2.5*60/(example.maxPsrpm*motor.drivetrain.ratio)*example.params.maxSpeedKn,s=deriveSignature(example,'base',{speedKn,depthM:50,mode:'BATT'});expect(2.5*example.motorSlots!).toBe(310);expect(s.propulsion!.motor!.shaftHz).toBeCloseTo(2.5,12);expect(s.propulsion!.motor!.msrHz).toBeCloseTo(310,10);expect(s.tonals!.some(l=>l.lineFamily==='MSR'&&l.harmonic===1&&Math.abs(l.hz-310)<1e-9)).toBe(true);
 for(const c of diesel.filter(c=>c.motorSlots===undefined)){const s=deriveSignature(c,'base',{speedKn:4,depthM:50,mode:'BATT'});expect(s.propulsion!.motor!.slots).toBe(0);expect(s.propulsion!.motor!.msrHz).toBe(0);expect(s.tonals!.some(l=>l.lineFamily==='MSR')).toBe(false);expect(s.tonals!.some(l=>l.family==='motor'&&l.power>0)).toBe(true);expect(c.idKeys.ratios.msrToMotorShaft).toBeUndefined();}
});
it('surface hydraulics and non-direct gearing/auxiliary sources vary by fictional type',()=>{
 const hydraulic=surfaceTypes.map(t=>t.plantSpec.hydp!.nominalHz);expect(new Set(hydraulic).size).toBe(surfaceTypes.length);for(const t of surfaceTypes)expect(t.plantSpec.aux.find(a=>a.kind==='hydp')!.fHz).toBe(t.plantSpec.hydp!.nominalHz);for(const c of createSurfacePool(371))expect(c.params.plantSpec!.hydp).toEqual(surfaceTypes.find(t=>t.id===c.surface!.type)!.plantSpec.hydp);
 const reduced=catalog.classes.filter(c=>c.idKeys.gearing.some(g=>g.kind!=='direct'));expect(new Set(reduced.map(c=>JSON.stringify(c.idKeys.gearing))).size).toBeGreaterThan(reduced.length/2);expect(new Set(catalog.classes.map(c=>c.aux[0].fHz)).size).toBe(catalog.classes.length);expect(new Set(catalog.classes.map(c=>c.params.srcHzPerKn.join(','))).size).toBe(catalog.classes.length);
});
it('fresh independent module runs reproduce all class and surface identities; hash bands ignore input order',()=>{
 const script="import {catalog,surfaceTypes} from './src/index.ts';console.log(JSON.stringify({catalog,surfaceTypes}));",run=()=>execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8'});expect(run()).toBe(run());const ids=catalog.classes.map(c=>c.id),a=identityBands(ids),b=identityBands([...ids].reverse());for(const id of ids)expect(a.get(id)).toEqual(b.get(id));
});

it('all 22 classes and twelve seeded hull draws obey nominal truth CSR/CFR/EFR and BR closed forms within 1e-9',()=>{
 const close=(a:number,b:number)=>expect(Math.abs(a-b)).toBeLessThanOrEqual(1e-9),strokes=new Set<number>();let states=0,running=0;
 for(const c of catalog.classes)for(let seed=0;seed<12;seed++){
  const scenario=cpaScenario(),mode=c.plant==='diesel'?'SNORK' as const:'NUC' as const,limit=c.plant==='diesel'?c.maxSpeedKts.snorkel:c.maxSpeedKts.submerged,depth=c.plant==='diesel'?c.snorkelDepthM/2:100,speeds=[.2*limit,.4*limit,.65*limit,.95*limit];
  scenario.contacts=[{...scenario.contacts[0],id:'orders-proof',catalogRef:{classId:c.id,hullId:c.hulls[seed%c.hulls.length].id,variantId:c.variants[Math.floor(seed/c.hulls.length)%c.variants.length].id},operatingMode:mode,speed:knotsToMps(speeds[0]),depth,motion:speeds.map((speed,at)=>({at,course:0,speed:knotsToMps(speed),depth}))}];scenario.surfaceTraffic=0;
  const engine=new AcousticEngine(scenario,seed);
  for(let at=0;at<speeds.length;at++){
   if(at)engine.advance(1);const contact=engine.tactical().truth!.contacts[0],p=contact.propulsion;states++;
   for(const e of p.engines){strokes.add(e.stroke);if(e.running)running++;close(e.csrHz,e.erpm/60);if(e.stroke===2)close(e.csrHz,e.cfrHz);else close(e.csrHz,2*e.cfrHz);close(e.efrHz,e.cfrHz*e.cylinders);}
   close(p.propulsor.brHz,p.shafts[0].hz*p.propulsor.blades);
   for(let shaft=0;shaft<p.shafts.length;shaft++){const lines=contact.lines.filter(l=>l.lineFamily==='BR'&&l.shaftIndex===shaft);expect(lines).toHaveLength(3);for(const l of lines){close(l.fundamentalHz!,p.shafts[shaft].hz*p.propulsor.blades);close(l.f0Hz,p.shafts[shaft].hz*p.propulsor.blades*l.harmonic!);}}
  }
 }
 expect(states).toBe(22*12*4);expect([...strokes].sort()).toEqual([2,4]);expect(running).toBeGreaterThan(0);
});
it('speed window display names are numbered SRC and SWATH labels for every class',()=>{
 for(const c of catalog.classes){let src=0,swath=0;for(const w of c.speedWindows!)expect(w.name).toBe(w.kind==='SRC'?`SRC-${++src}`:`SWATH-${++swath}`);}
});

it('seeded-truth speedGated windows match SRC/SWATH idKeys; off-window SRC rules out; matcher never reads truth',()=>{
 const src=matchClasses.toString();expect(src.includes('truth')).toBe(false);expect(src.includes('AcousticEngine')).toBe(false);expect(src.includes('speedGated')).toBe(false);
 for(const c of catalog.classes){
  const row=[{id:c.id,idKeys:c.idKeys}],mode=c.plant==='nuclear'?'NUC' as const:'SNORK' as const,depth=c.plant==='diesel'?Math.max(5,c.snorkelDepthM/2):100;
  for(const kind of ['SRC','SWATH'] as const){
   const design=c.speedWindows!.find(w=>w.kind===kind)!,speed=(design.speedKts[0]+design.speedKts[1])/2;
   for(let seed=0;seed<3;seed++){
    const s=deriveSignature(c,'base',{speedKn:speed,depthM:depth,mode});configurePropulsion(s,seed,`window-${c.id}`,mode);updateDerivedSignature(s,effectiveParams(c),speed,depth,mode);
    const gate=s.speedGated!.find(g=>g.kind===kind&&g.active)!;expect(gate).toBeTruthy();
    const obs:ClassObservations={speedWindows:[gate.kind==='SRC'?{kind:'SRC',hz:gate.hz,speedKts:speed}:{kind:'SWATH',loHz:gate.loHz,hiHz:gate.hiHz,speedKts:speed}]};
    const hit=matchClasses(obs,row)[0];expect(hit.matched).toContain(kind);expect(hit.ruledOutBy).not.toContain(kind);expect(hit.score).toBe(1);
   }
  }
  const srcs=c.idKeys.speedWindows.filter(w=>w.kind==='SRC'),outside=Math.min(...srcs.map(w=>w.speedKts[0]))-2,hz=mid([srcs[0].loHz,srcs[0].hiHz]);
  const miss=matchClasses({speedWindows:[{kind:'SRC',hz,speedKts:outside}]},row)[0];expect(miss.ruledOutBy).toContain('SRC');expect(miss.matched).not.toContain('SRC');
  expect(matchClasses({speedWindows:[{kind:'SRC',hz,speedKts:outside}]},[{id:c.id,idKeys:structuredClone(c.idKeys)}])).toEqual(matchClasses({speedWindows:[{kind:'SRC',hz,speedKts:outside}]},row));
 }
});
