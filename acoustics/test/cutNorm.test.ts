import {describe,it,expect} from 'vitest';
import {
  renderCut,getCutSeed,
  CUT_BINS,CUT_FMAX,CUT_LOFAR_NORM,DEMON_NORM,
  SplitWindowNormalizer,normalizeCutRow,normalizeDemonRow,
  AcousticEngine,cpaScenario,
} from '../src/index.js';

describe('CUT_LOFAR_NORM / SplitWindowNormalizer',()=>{
 it('exports cut-tuned window longer than the live-band default (24)',()=>{
  expect(CUT_LOFAR_NORM.window).toBeGreaterThan(24);
  expect(CUT_LOFAR_NORM.guard).toBe(3);
  expect(CUT_LOFAR_NORM.floorDb).toBe(1);
  expect(CUT_LOFAR_NORM.ceilDb).toBe(22);
 });

 it('flattens a sloped background, keeps tonals, keeps NaN (closed-form)',()=>{
  // Algorithm check with a short window (same as FE live-band default); cut window is
  // longer and is covered by the brindleflux SNR test below.
  const n=512,src=new Float32Array(n),dst=new Float32Array(n);
  for(let i=0;i<n;i++)src[i]=100-i*.05;
  src[200]+=12;
  const nz=new SplitWindowNormalizer(n,24,3);
  nz.apply(src,0,dst,0);
  for(let i=40;i<n-40;i++)if(Math.abs(i-200)>30)expect(Math.abs(dst[i])).toBeLessThan(.01);
  expect(dst[200]).toBeCloseTo(12,1);
  src.fill(NaN);nz.apply(src,0,dst,0);
  expect(dst.every(v=>Number.isNaN(v))).toBe(true);
 });

 it('normalizeCutRow matches SplitWindowNormalizer with CUT_LOFAR_NORM',()=>{
  const n=128,src=new Float32Array(n),a=new Float32Array(n),b=new Float32Array(n);
  for(let i=0;i<n;i++)src[i]=50+Math.sin(i/7);
  src[40]+=8;
  normalizeCutRow(src,0,a,0,n);
  new SplitWindowNormalizer(n,CUT_LOFAR_NORM.window,CUT_LOFAR_NORM.guard).apply(src,0,b,0);
  expect([...a]).toEqual([...b]);
 });
});

describe('cut tonal whitened SNR (brindleflux)',()=>{
 /** Average ~80 LOFAR rows near CPA (~176 s) and measure CFR-fundamental whitened SNR. */
 function avgNearCpa(cutId:string,targetT=176,span=20){
  const session=renderCut(cutId),row=new Float32Array(CUT_BINS),avg=new Float64Array(CUT_BINS);
  let n=0;
  while(session.simT<targetT){
   if(session.writeLofarRow(row)<0)break;
   if(session.simT>=targetT-span){for(let i=0;i<CUT_BINS;i++)avg[i]+=row[i];n++;}
  }
  session.dispose();
  for(let i=0;i<CUT_BINS;i++)avg[i]/=n;
  return {avg:Float32Array.from(avg),n};
 }
 function whitenedSnr(src:Float32Array,bin:number,window:number,guard:number){
  const dst=new Float32Array(src.length);
  new SplitWindowNormalizer(src.length,window,guard).apply(src,0,dst,0);
  let pb=bin,pv=dst[bin];
  for(let i=Math.max(0,bin-2);i<=Math.min(src.length-1,bin+2);i++)if(dst[i]>pv){pv=dst[i];pb=i;}
  const vals=[...dst].filter(v=>v===v).sort((a,b)=>a-b);
  return {snr:pv-vals[vals.length>>1],peak:pv,bin:pb};
 }

 it('legacy w=24 crushes CFR; CUT_LOFAR_NORM restores ≳8 dB whitened SNR',()=>{
  const cut=getCutSeed('cut-brindleflux-snork')!;
  const fBin=CUT_FMAX/(CUT_BINS-1);
  const probe=renderCut(cut);
  const cfrLine=probe.engine.scenario.contacts[0].params.tonals!
   .find(t=>t.lineFamily==='CFR'&&(t.harmonic??1)===1)!;
  const cfrBin=Math.round(cfrLine.hz/fBin);
  probe.dispose();
  const {avg}=avgNearCpa(cut.id);

  const legacy=whitenedSnr(avg,cfrBin,24,3);
  const tuned=whitenedSnr(avg,cfrBin,CUT_LOFAR_NORM.window,CUT_LOFAR_NORM.guard);
  expect(legacy.snr).toBeLessThan(5);
  expect(tuned.snr).toBeGreaterThanOrEqual(8);
  expect(tuned.snr).toBeGreaterThan(legacy.snr+3);
  // Still inside the 1–22 LUT (not absolute-BB territory)
  expect(tuned.peak).toBeLessThan(CUT_LOFAR_NORM.ceilDb);
 });

 it('does not change raw CutSession rows (seek≡playback content untouched)',()=>{
  const a=renderCut('cut-brindleflux-snork'),b=renderCut('cut-brindleflux-snork');
  expect(a.checksumFirstRows(16)).toBe(b.checksumFirstRows(16));
  a.dispose();b.dispose();
 });
});

describe('DEMON_NORM + empty-bin floor clamp',()=>{
 it('advertises 0–30 dB display range (not live NB 1–22)',()=>{
  expect(DEMON_NORM.floorDb).toBe(0);
  expect(DEMON_NORM.ceilDb).toBe(30);
  expect(DEMON_NORM.clampFloorDb).toBeLessThan(0);
  expect(DEMON_NORM.clampFloorDb).toBeGreaterThanOrEqual(-10);
 });

 it('engine DEMON rows never fall below clampFloorDb; peaks still exceed 22 dB',()=>{
  const s=cpaScenario();s.contacts[0].params.modulation=.6;
  const e=new AcousticEngine(s),id=e.subscribe({kind:'demon',buoyId:1}),row=new Float32Array(512);
  e.advance(.25);expect(e.writeRow(id,row)).toBe(0);
  let min=Infinity,max=-Infinity;
  for(const v of row){if(v!==v)continue;min=Math.min(min,v);max=Math.max(max,v);}
  expect(min).toBeGreaterThanOrEqual(DEMON_NORM.clampFloorDb-1e-9);
  expect(max).toBeGreaterThan(22); // why FE must not reuse 1–22 LUT
  expect(e.configs().find(c=>c.kind==='demon')).toMatchObject({dbFloor:0,dbCeil:30});
 });

 it('normalizeDemonRow whitening stays inside ceil after clamp (no full-height bomb)',()=>{
  // Synthetic row: mostly quiet, one −300 empty bin, one +12 line — legacy FE path would explode.
  const src=new Float32Array(512).fill(0);
  src[10]=-300;src[40]=12;
  const dst=new Float32Array(512);
  normalizeDemonRow(src,0,dst,0,512,DEMON_NORM,true);
  let max=-Infinity;
  for(const v of dst)if(v===v)max=Math.max(max,v);
  expect(max).toBeLessThan(DEMON_NORM.ceilDb);
  expect(max).toBeGreaterThan(5);
 });

 it('cut DEMON rows respect the same floor',()=>{
  const s=renderCut('cut-pebblewisp-demon');
  const lofar=new Float32Array(s.lofar.bins),demon=new Float32Array(512);
  let saw=false,min=Infinity;
  while(s.simT<20){
   s.writeLofarRow(lofar);
   if(s.writeDemonRow(demon)<0)continue;
   saw=true;
   for(const v of demon)if(v===v)min=Math.min(min,v);
  }
  s.dispose();
  expect(saw).toBe(true);
  expect(min).toBeGreaterThanOrEqual(DEMON_NORM.clampFloorDb-1e-9);
 });
});
