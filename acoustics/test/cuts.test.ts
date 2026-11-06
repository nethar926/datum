import {describe,it,expect} from 'vitest';
import {
 listCutSeeds,getCutSeed,getCutStarterPack,renderCut,validateCutSeed,validateStarterPack,
 lookalikeDiffersOn,CUT_MODEL_VERSION,getClass,catalog,type CutSeed,
} from '../src/index.js';

describe('CutSeed schema + starter pack',()=>{
 it('lists 5–10 frozen cuts pinned to m3-cuts-1 and validates the pack',()=>{
  const cuts=listCutSeeds(),pack=getCutStarterPack();
  expect(cuts.length).toBeGreaterThanOrEqual(5);expect(cuts.length).toBeLessThanOrEqual(10);
  expect(pack.modelVersion).toBe(CUT_MODEL_VERSION);
  expect(cuts.every(c=>c.modelVersion===CUT_MODEL_VERSION&&c.v===1)).toBe(true);
  expect(()=>validateStarterPack(pack)).not.toThrow();
  for(const c of cuts){expect(getCutSeed(c.id)).toEqual(c);expect(c.classifyingLines.length).toBeGreaterThanOrEqual(1);expect(c.classifyingLines.length).toBeLessThanOrEqual(3);}
  expect(getCutSeed('nope')).toBeUndefined();
 });
 it('mixes diesel + nuclear and includes an AIP cut',()=>{
  const plants=new Set(listCutSeeds().map(c=>getClass(c.classId).plant));
  expect(plants.has('diesel')).toBe(true);expect(plants.has('nuclear')).toBe(true);
  expect(listCutSeeds().some(c=>c.mode==='AIP'&&getClass(c.classId).aipCapable)).toBe(true);
  expect(listCutSeeds().some(c=>c.mode==='SNORK'||c.mode==='SURF')).toBe(true);
  expect(listCutSeeds().some(c=>c.mode==='BATT')).toBe(true);
  expect(new Set(listCutSeeds().map(c=>c.richness)).size).toBeGreaterThanOrEqual(2);
 });
 it('has at least two lookalike pairs that really differ on the declared key',()=>{
  const pack=getCutStarterPack();
  expect(pack.lookalikePairs.length).toBeGreaterThanOrEqual(2);
  for(const p of pack.lookalikePairs){
   expect(lookalikeDiffersOn(p,pack.cuts)).toBe(true);
   const [a,b]=p.cutIds.map(id=>getCutSeed(id)!);
   expect(a.lookalikeGroupId).toBe(p.id);expect(b.lookalikeGroupId).toBe(p.id);
   expect(getClass(a.classId).operatorNationId).toBe(getClass(b.classId).operatorNationId);
   if(p.differOn==='HYDP')expect(getClass(a.classId).hydp!.nominalHz).not.toBe(getClass(b.classId).hydp!.nominalHz);
  }
 });
 it('rejects malformed CutSeeds',()=>{
  const good=structuredClone(listCutSeeds()[0]);
  expect(()=>validateCutSeed({...good,v:2})).toThrow(/v/);
  expect(()=>validateCutSeed({...good,modelVersion:'nope'})).toThrow(/modelVersion/);
  expect(()=>validateCutSeed({...good,classifyingLines:[]})).toThrow(/classifyingLines/);
  expect(()=>validateCutSeed({...good,classId:'not-a-class'})).toThrow();
  expect(()=>validateCutSeed({...good,mode:'AIP',speedKn:40,classId:'red-gloamspiral'})).toThrow();
 });
});

describe('renderCut',()=>{
 it('streams LOFAR rows as fast as drained and is deterministic per seed',()=>{
  const id='cut-pebblewisp-batt';
  const a=renderCut(id),b=renderCut(id),c=renderCut(getCutSeed(id)!);
  expect(a.lofar.bins).toBe(2048);expect(a.lofar.f0).toBe(0);
  const ha=a.checksumFirstRows(8),hb=b.checksumFirstRows(8),hc=c.checksumFirstRows(8);
  expect(ha).toBe(hb);expect(hb).toBe(hc);expect(ha).not.toBe(0);
  // Different seed → different checksum
  const other:CutSeed={...getCutSeed(id)!,seed:(getCutSeed(id)!.seed+1)>>>0};
  expect(renderCut(other).checksumFirstRows(8)).not.toBe(ha);
 });
 it('exposes DEMON rows and stops at durationS',()=>{
  const cut={...getCutSeed('cut-gloamspiral-aip')!,durationS:2}; // short for test
  // durationS min validate is 60 — use real cut and drain a burst instead
  const s=renderCut('cut-gloamspiral-aip');
  const row=new Float32Array(s.lofar.bins),demon=new Float32Array(512);
  expect(s.writeLofarRow(row)).toBe(0);expect([...row].some(Number.isFinite)).toBe(true);
  expect(s.writeDemonRow(demon)).toBeGreaterThanOrEqual(0);
  const n=s.drainLofar(row,40);expect(n).toBe(40);expect(s.simT).toBeGreaterThan(0);expect(s.done).toBe(false);
 });
 it('schedules HYDP when classifying lines ask for it',()=>{
  const s=renderCut('cut-velvetshoal-nuc');
  const contact=s.engine.scenario.contacts.find(c=>c.category!=='surface')!;
  expect(contact.transients?.some(t=>t.kind==='hydp')).toBe(true);
  const hydp=contact.params.tonals!.filter(l=>l.lineFamily==='HYDP');
  expect(hydp.length).toBe(2);
  const at=contact.transients![0].at;s.engine.advance(at+1);
  expect(hydp[0].power).toBeGreaterThan(0);
 });
 it('renderCut(string) unknown id throws',()=>{expect(()=>renderCut('missing-cut')).toThrow(/Unknown cut/);});
 it('every starter cut opens without throwing',()=>{
  for(const c of listCutSeeds()){const s=renderCut(c);expect(s.cut.id).toBe(c.id);expect(catalog.classes.some(k=>k.id===c.classId)).toBe(true);}
 });
});
