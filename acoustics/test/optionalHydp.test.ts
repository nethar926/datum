import {describe,it,expect} from 'vitest';
import {catalog,deriveSignature,AcousticEngine,cpaScenario,knotsToMps} from '../src/index.js';

const NO_HYDP=new Set([
 'green-fennelglint','green-opalweft','red-cinderlilt','green-russetwake',
 'red-marigoldrift','blue-quartzwhorl','red-ivorycoil','green-thistledrift',
]);

describe('optional HYDP (~⅓ of classes)',()=>{
 it('exactly the NO_HYDP set lacks hydp; mix of diesel+nuclear on both sides',()=>{
  const missing=catalog.classes.filter(c=>!c.hydp).map(c=>c.id).sort();
  expect(missing).toEqual([...NO_HYDP].sort());
  expect(NO_HYDP.size).toBe(8);
  expect(catalog.classes).toHaveLength(22);
  const keep=catalog.classes.filter(c=>c.hydp);
  expect(keep).toHaveLength(14);
  expect(keep.some(c=>c.plant==='diesel')&&keep.some(c=>c.plant==='nuclear')).toBe(true);
  expect(catalog.classes.filter(c=>!c.hydp&&c.plant==='diesel').length).toBeGreaterThan(0);
  expect(catalog.classes.filter(c=>!c.hydp&&c.plant==='nuclear').length).toBeGreaterThan(0);
  for(const c of catalog.classes.filter(c=>!c.hydp)){
   expect(c.idKeys.hydp).toBeUndefined();
   expect(c.aux.every(a=>a.kind!=='hydp')).toBe(true);
   const s=deriveSignature(c,'base',{speedKn:5,depthM:60,mode:c.plant==='diesel'?'BATT':'NUC'});
   expect(s.plantSpec?.hydp).toBeUndefined();
  }
 });

 it('no-HYDP class still radiates energy (tonals / broadband > 0)',()=>{
  const c=catalog.classes.find(x=>x.id==='green-fennelglint')!;
  const scen=cpaScenario();
  scen.contacts=[{...scen.contacts[0],id:'nohydp',catalogRef:{classId:c.id,variantId:'base',hullId:c.hulls[0].id},operatingMode:'BATT',speed:knotsToMps(5),depth:60,motion:[{at:0,course:0,speed:knotsToMps(5),depth:60}]}];
  scen.surfaceTraffic=0;
  const e=new AcousticEngine(scen,7);
  const sub=e.subscribe({channel:1,kind:'lofar'});
  const row=new Float32Array(sub.bins);
  e.step(.25);e.writeRow(sub.streamId,row);
  let sum=0;for(let i=0;i<row.length;i++)sum+=row[i]!;
  expect(sum).toBeGreaterThan(0);
 });
});
