import {describe,it,expect} from 'vitest';
import {catalog,deriveSignature,effectiveParams,writePlantTonals,configurePropulsion,updateDerivedSignature} from '../src/index.js';

function aipSig(classId:string){
 const c=catalog.classes.find(x=>x.id===classId)!;
 const mode={speedKn:3,depthM:50,mode:'AIP' as const,reactorOffline:c.plant==='nuclear'};
 const s=deriveSignature(c,'base',mode);
 writePlantTonals(s,'AIP',effectiveParams(c).electricalHarmonics,effectiveParams(c).srcHzPerKn,3);
 return {c,s,t:s.propulsion!};
}

describe('AIP plant tones by kind',()=>{
 it('Stirling (gloamspiral): 14 Hz shaft = generator rpm/60; h2 at 28 Hz; no regenerator wording in plant',()=>{
  const {s,t}=aipSig('red-gloamspiral');
  expect(s.plantSpec!.aip!.kind).toBe('stirling');
  const g=t.generators![0];
  expect(g.hz).toBe(28); // AIP electrical
  expect(g.rpm).toBe(28*60/2); // 840
  const shaftHz=g.rpm/60;
  expect(shaftHz).toBeCloseTo(14,10);
  const aux=s.tonals!.filter(l=>l.lineFamily==='AUX'&&l.power>0&&l.stability==='stable');
  const h1=aux.find(l=>Math.abs(l.hz-shaftHz)<1e-9);
  const h2=aux.find(l=>Math.abs(l.hz-2*shaftHz)<1e-9);
  expect(h1).toBeTruthy();
  expect(h2).toBeTruthy();
  expect(h1!.hz).toBe(shaftHz);
  // No line labelled as regenerator; shaft-rate family is the Stirling giveaway.
  expect(aux.some(l=>/regenerator/i.test(String((l as {id?:string}).id??'')))).toBe(false);
 });

 it('fuelcell (frostwhorl): emits no shaft-rate AIP line; pumps/blower/inverter instead',()=>{
  const {s,t}=aipSig('red-frostwhorl');
  expect(s.plantSpec!.aip!.kind).toBe('fuelcell');
  const g=t.generators![0];
  // Generator still carries AIP_HZ for GRID electrical, but plant AUX must not be shaft=rpm/60.
  const shaftCandidate=g.rpm/60; // would be 21 Hz if treated like Stirling
  const aux=s.tonals!.filter(l=>l.lineFamily==='AUX'&&l.power>0);
  expect(aux.some(l=>Math.abs(l.hz-shaftCandidate)<1e-6)).toBe(false);
  expect(aux.some(l=>Math.abs(l.hz-AIP_SHAFT_STIRLING)<1e-6)).toBe(false);
  // Illustrative FC plant: reactant, coolant, cathode blower, DC/DC inverter fundamentals.
  const fund=new Set(aux.filter(l=>l.harmonic===1).map(l=>+l.hz.toFixed(6)));
  expect(fund.has(23)).toBe(true);
  expect(fund.has(31)).toBe(true);
  expect(fund.has(47)).toBe(true);
  expect(fund.has(42)).toBe(true);
  for(const l of aux)expect(l.stability).toBe('stable');
 });

 it('closed-cycle AIP keeps an engine-firing-based line (invented CFR)',()=>{
  // No catalog class is closed-cycle; force via plantSpec override on a diesel AIP-capable hull.
  const c=catalog.classes.find(x=>x.id==='red-gloamspiral')!;
  const s=deriveSignature(c,'base',{speedKn:3,depthM:50,mode:'AIP'});
  s.plantSpec!.aip={kind:'closed-cycle',powerKw:90,maxSpeedKts:5,enduranceDays:10};
  configurePropulsion(s,1,'de','AIP');
  updateDerivedSignature(s,effectiveParams(c),3,50,'AIP');
  writePlantTonals(s,'AIP',effectiveParams(c).electricalHarmonics,effectiveParams(c).srcHzPerKn,3);
  const aux=s.tonals!.filter(l=>l.lineFamily==='AUX'&&l.power>0&&l.stability==='stable');
  expect(aux.some(l=>Math.abs(l.hz-17)<1e-9&&l.harmonic===1)).toBe(true);
  expect(aux.some(l=>Math.abs(l.hz-34)<1e-9&&l.harmonic===2)).toBe(true);
 });
});

const AIP_SHAFT_STIRLING=14;
