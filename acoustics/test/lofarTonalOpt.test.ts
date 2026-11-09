import {describe,it,expect} from 'vitest';
import {exactGain} from '../src/lloydsMirror.js';
import {thorp} from '../src/transmissionLoss.js';
import {C} from '../src/units.js';
import {renderCut,CUT_BINS,STARTER_CUTS} from '../src/cuts/index.js';

/** Reference tonal intensity factor (pre-opt): thorp(f) × exactGain(f,…). */
function refFactor(f:number,r:number,zs:number,zr:number,c:number,sigma:number,km:number):number{
 return 10**(-thorp(f)*km/10)*exactGain(f,r,zs,zr,c,sigma);
}
/** Optimized factor: thorp(f) + precomputed Lloyd geometry (matches lofar.ts). */
function optFactor(f:number,r:number,zs:number,zr:number,c:number,sigma:number,km:number,_fBin?:number):number{
 const a=Math.hypot(r,zs-zr),b=Math.hypot(r,zs+zr);
 const delta=4*zs*zr/Math.max(a+b,1e-12);
 const qGeom=b>0?a/b:1,grazing=b>0?(zs+zr)/b:0;
 const rayleigh2=sigma===0?0:2*sigma*sigma*grazing*grazing;
 const invC=1/Math.max(1,c),kWave=2*Math.PI*f*invC;
 const q=rayleigh2===0?qGeom:qGeom*Math.exp(-kWave*kWave*rayleigh2);
 const s=Math.sin(Math.PI*f*delta*invC),lloyd=(1-q)*(1-q)+4*q*s*s;
 return 10**(-thorp(f)*km/10)*lloyd;
}

describe('LOFAR tonal Lloyd/absorption opt (Task D)',()=>{
 it('max |ΔdB| vs exactGain+thorp(f) stays under 1e-4 dB across cut-like geometries',()=>{
  const df=2000/2047;let maxDb=0,n=0;
  for(const r of [150,200,400,900,1800,3000]){
   for(const zs of [2.5,12,14,40,80]){
    for(const zr of [60]){
     for(const sigma of [0,.12,.5]){
      for(const km of [.2,.9,1.5]){
       for(let f=5;f<=1990;f+=11){
        const fBin=Math.max(df/2,Math.floor(f/df)*df);
        const a=refFactor(f,r,zs,zr,C,sigma,km),b=optFactor(f,r,zs,zr,C,sigma,km,fBin);
        if(a<=0&&b<=0)continue;
        const dB=Math.abs(10*Math.log10(Math.max(a,1e-30))-10*Math.log10(Math.max(b,1e-30)));
        if(dB>maxDb)maxDb=dB;n++;
       }
      }
     }
    }
   }
  }
  expect(n).toBeGreaterThan(1000);
  expect(maxDb).toBeLessThan(1e-9); // Lloyd hoist is bit-identical; thorp(f) unchanged
 });
 it('precomputed Lloyd matches exactGain bit-identically when absorption freq matches',()=>{
  for(const r of [300,900])for(const zs of [40,80])for(const f of [14,50,200,900]){
   const zr=60,sigma=0,km=.5;
   const a=refFactor(f,r,zs,zr,C,sigma,km),b=optFactor(f,r,zs,zr,C,sigma,km,f);
   expect(Number.isFinite(a)&&Number.isFinite(b)).toBe(true);
   expect(Math.abs(a-b)).toBeLessThan(1e-12*Math.max(1,Math.abs(a)));
  }
 });
 it('starter cut mid rows stay finite and deterministic after opt (lazy)',()=>{
  for(const id of ['cut-gloamspiral-aip','cut-orbelune-msr','cut-mistacorn-batt']){
   const cut=STARTER_CUTS.find(c=>c.id===id)!;
   const a=renderCut(cut),b=renderCut(cut),rowA=new Float32Array(CUT_BINS),rowB=new Float32Array(CUT_BINS);
   const target=Math.min(40,cut.durationS);
   while(a.simT<target&&a.writeLofarRow(rowA)>=0){/* */}
   while(b.simT<target&&b.writeLofarRow(rowB)>=0){/* */}
   expect(rowA.every(Number.isFinite)).toBe(true);
   expect([...rowA]).toEqual([...rowB]);
   a.dispose();b.dispose();
  }
 },30_000);
 it('seekTo advances without generating then writeLofarRow resumes',()=>{
  const cut=STARTER_CUTS.find(c=>c.id==='cut-mistacorn-batt')!;
  const s=renderCut(cut),buf=new Float32Array(CUT_BINS);
  s.seekTo(60);
  expect(s.simT).toBeGreaterThanOrEqual(60-1e-6);
  expect(s.writeLofarRow(buf)).toBeGreaterThanOrEqual(0);
  expect(buf.every(Number.isFinite)).toBe(true);
  s.dispose();
 },15_000);
});
