import {describe,it,expect} from 'vitest';
import {
  catalog,deriveSignature,updateDerivedSignature,effectiveParams,configurePropulsion,
} from '../src/index.js';

describe('D/E bus-locked ERPM ⊥ shaft',()=>{
 it('changing shaft speed does not move diesel ERPM / generator Hz in D/E mode',()=>{
  const c=catalog.classes.find(x=>x.drivetrainCode==='DEL')!;
  const p=effectiveParams(c);
  const s=deriveSignature(c,'base',{speedKn:3,depthM:8,mode:'D/E'});
  configurePropulsion(s,11,c.id,'D/E');
  updateDerivedSignature(s,p,3,8,'D/E');
  const erpm0=s.propulsion!.engines.filter(e=>e.running).map(e=>e.erpm);
  const gen0=s.propulsion!.generators!.map(g=>g.hz);
  expect(erpm0.length).toBeGreaterThan(0);
  expect(s.propulsion!.shafts[0].coupled).toBe(false);
  // Speed up / slow down shaft via motor — ERPM must stay bus-locked.
  for(const kn of [1.5,5,7,2]){
   updateDerivedSignature(s,p,kn,8,'D/E');
   expect(s.propulsion!.mode).toBe('D/E');
   expect(s.propulsion!.shafts[0].coupled).toBe(false);
   expect(s.propulsion!.engines.filter(e=>e.running).map(e=>e.erpm)).toEqual(erpm0);
   expect(s.propulsion!.generators!.map(g=>g.hz)).toEqual(gen0);
   // Shaft Hz must move with speed (motor drive).
   expect(s.propulsion!.shafts[0].hz).toBeGreaterThan(0);
  }
  const slow=s.propulsion!.shafts[0].hz;
  updateDerivedSignature(s,p,6,8,'D/E');
  expect(s.propulsion!.shafts[0].hz).not.toBeCloseTo(slow,6);
  expect(s.propulsion!.engines.filter(e=>e.running).map(e=>e.erpm)).toEqual(erpm0);
 });
});
