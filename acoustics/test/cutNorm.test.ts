import {describe,it,expect} from 'vitest';
import {
  renderCut,getCutSeed,
  CUT_BINS,CUT_FMAX,CUT_LOFAR_NORM,CUT_LOFAR_NORM_PASS2,CUT_LOFAR_NORM_GAIN,CUT_LOFAR_NORM_RECIPE,
  DEMON_NORM,
  SplitWindowNormalizer,normalizeCutRow,normalizeCutLofarRow,normalizeDemonRow,
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

 it('normalizeCutRow matches SplitWindowNormalizer with CUT_LOFAR_NORM (pass1)',()=>{
  const n=128,src=new Float32Array(n),a=new Float32Array(n),b=new Float32Array(n);
  for(let i=0;i<n;i++)src[i]=50+Math.sin(i/7);
  src[40]+=8;
  normalizeCutRow(src,0,a,0,n);
  new SplitWindowNormalizer(n,CUT_LOFAR_NORM.window,CUT_LOFAR_NORM.guard).apply(src,0,b,0);
  expect([...a]).toEqual([...b]);
 });
});

describe('CUT_LOFAR_NORM_RECIPE (pass1→pass2→gain)',()=>{
 it('exports Lead-locked 192/3 → 16/3 → gain 5 with 1–22 LUT',()=>{
  expect(CUT_LOFAR_NORM_PASS2.window).toBe(16);
  expect(CUT_LOFAR_NORM_PASS2.guard).toBe(3);
  expect(CUT_LOFAR_NORM_GAIN).toBe(5);
  expect(CUT_LOFAR_NORM_RECIPE).toMatchObject({
   pass1:CUT_LOFAR_NORM,
   pass2:CUT_LOFAR_NORM_PASS2,
   gain:5,
   floorDb:1,
   ceilDb:22,
  });
 });

 /** Local prominence: peak − mean of left/right side windows (guard gap), short W. */
 function localProm(row:Float32Array,bin:number,window=16,guard=3){
  const n=row.length,G=guard,W=window;
  const la=Math.max(0,bin-G-W),lb=Math.max(0,bin-G);
  const ra=Math.min(n,bin+G+1),rb=Math.min(n,bin+G+1+W);
  let s=0,c=0;
  for(let i=la;i<lb;i++){const v=row[i];if(v===v){s+=v;c++;}}
  for(let i=ra;i<rb;i++){const v=row[i];if(v===v){s+=v;c++;}}
  return c>0?row[bin]-s/c:row[bin];
 }

 it('synthetic dense-LF pedestal: recipe lifts local prom + LUT contrast vs bare 192/3',()=>{
  // Quiet mid-band @ 70 dB; dense 0–80 Hz forest pedestal +7 dB with many weak lines;
  // one classifying tonal +3.2 dB above the local forest (matches FE ~3.4 dB local prom).
  const n=CUT_BINS,fBin=CUT_FMAX/(CUT_BINS-1);
  const src=new Float32Array(n).fill(70);
  const lfHi=Math.round(80/fBin);
  for(let i=0;i<=lfHi;i++)src[i]=77+((i%5)-2)*0.15; // carpet with texture
  for(let k=2;k<=12;k++){ // weak plant lines every ~few Hz
   const b=Math.round((k*3.1)/fBin);
   if(b>0&&b<lfHi)src[b]+=1.2;
  }
  const toneBin=Math.round(22/fBin); // ~CFR-like
  src[toneBin]+=3.2;

  const pass1=new Float32Array(n),recipe=new Float32Array(n);
  normalizeCutRow(src,0,pass1,0,n);
  normalizeCutLofarRow(src,0,recipe,0,n);

  const p1Prom=localProm(pass1,toneBin);
  const rProm=localProm(recipe,toneBin);
  // Pass2 flattens neighbors; gain multiplies residual → local prom ≫ bare pass1.
  expect(p1Prom).toBeGreaterThan(2);
  expect(p1Prom).toBeLessThan(5);
  expect(rProm).toBeGreaterThan(p1Prom*CUT_LOFAR_NORM_GAIN*0.7);
  expect(rProm).toBeGreaterThan(8);

  // LUT 1–22: gained tone should sit above mid-scale; carpet median stays darker.
  const lut=(v:number)=>(Math.min(CUT_LOFAR_NORM_RECIPE.ceilDb,Math.max(CUT_LOFAR_NORM_RECIPE.floorDb,v))
   -CUT_LOFAR_NORM_RECIPE.floorDb)/(CUT_LOFAR_NORM_RECIPE.ceilDb-CUT_LOFAR_NORM_RECIPE.floorDb);
  const toneLut=lut(recipe[toneBin]);
  expect(toneLut).toBeGreaterThan(0.45);
  expect(toneLut).toBeLessThan(0.95);
  const carpet:number[]=[];
  for(let i=8;i<lfHi;i++){
   if(Math.abs(i-toneBin)<=6)continue;
   if(recipe[i]===recipe[i])carpet.push(recipe[i]);
  }
  carpet.sort((a,b)=>a-b);
  const carpetMed=carpet[carpet.length>>1]!;
  expect(lut(carpetMed)).toBeLessThan(toneLut-0.2);
  // Bare pass1 LUT contrast (tone vs same carpet median) is weak; recipe widens it.
  const p1Carpet:number[]=[];
  for(let i=8;i<lfHi;i++){
   if(Math.abs(i-toneBin)<=6)continue;
   if(pass1[i]===pass1[i])p1Carpet.push(pass1[i]);
  }
  p1Carpet.sort((a,b)=>a-b);
  const p1Med=p1Carpet[p1Carpet.length>>1]!;
  const p1Contrast=pass1[toneBin]-p1Med;
  const rContrast=recipe[toneBin]-carpetMed;
  expect(rContrast).toBeGreaterThan(p1Contrast*2);
 });

 it('normalizeCutLofarRow is bit-stable and NaN-safe; reuses normalizers',()=>{
  const n=256,src=new Float32Array(n);
  for(let i=0;i<n;i++)src[i]=60+Math.sin(i/5)*2+(i<40?6:0);
  src[20]+=4;src[100]=NaN;
  const a=new Float32Array(n),b=new Float32Array(n);
  const p1=new SplitWindowNormalizer(n,CUT_LOFAR_NORM.window,CUT_LOFAR_NORM.guard);
  const p2=new SplitWindowNormalizer(n,CUT_LOFAR_NORM_PASS2.window,CUT_LOFAR_NORM_PASS2.guard);
  normalizeCutLofarRow(src,0,a,0,n,CUT_LOFAR_NORM_RECIPE,p1,p2);
  normalizeCutLofarRow(src,0,b,0,n,CUT_LOFAR_NORM_RECIPE,p1,p2);
  expect([...a]).toEqual([...b]);
  expect(Number.isNaN(a[100])).toBe(true);
  // Manual pass1→pass2→gain must match helper.
  const mid=new Float32Array(n),manual=new Float32Array(n);
  p1.apply(src,0,mid,0);p2.apply(mid,0,manual,0);
  for(let i=0;i<n;i++)if(manual[i]===manual[i])manual[i]*=CUT_LOFAR_NORM_GAIN;
  expect([...a]).toEqual([...manual]);
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
 function localProm(row:Float32Array,bin:number,window=16,guard=3){
  const n=row.length,G=guard,W=window;
  const la=Math.max(0,bin-G-W),lb=Math.max(0,bin-G);
  const ra=Math.min(n,bin+G+1),rb=Math.min(n,bin+G+1+W);
  let s=0,c=0;
  for(let i=la;i<lb;i++){const v=row[i];if(v===v){s+=v;c++;}}
  for(let i=ra;i<rb;i++){const v=row[i];if(v===v){s+=v;c++;}}
  return c>0?row[bin]-s/c:row[bin];
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

 it('recipe improves CFR local prom vs bare pass1 on brindleflux near CPA',()=>{
  const cut=getCutSeed('cut-brindleflux-snork')!;
  const fBin=CUT_FMAX/(CUT_BINS-1);
  const probe=renderCut(cut);
  const cfrLine=probe.engine.scenario.contacts[0].params.tonals!
   .find(t=>t.lineFamily==='CFR'&&(t.harmonic??1)===1)!;
  const cfrBin=Math.round(cfrLine.hz/fBin);
  probe.dispose();
  const {avg}=avgNearCpa(cut.id);

  const pass1=new Float32Array(CUT_BINS),full=new Float32Array(CUT_BINS);
  normalizeCutRow(avg,0,pass1,0,CUT_BINS);
  normalizeCutLofarRow(avg,0,full,0,CUT_BINS);
  // Peak-pick ±2 around nominal CFR bin after each stage.
  const peakNear=(row:Float32Array)=>{
   let b=cfrBin,v=row[cfrBin];
   for(let i=Math.max(0,cfrBin-2);i<=Math.min(CUT_BINS-1,cfrBin+2);i++)if(row[i]>v){v=row[i];b=i;}
   return {bin:b,v};
  };
  const p1=peakNear(pass1),r=peakNear(full);
  const p1Loc=localProm(pass1,p1.bin);
  const rLoc=localProm(full,r.bin);
  expect(rLoc).toBeGreaterThan(p1Loc*2);
  expect(r.v).toBeGreaterThan(CUT_LOFAR_NORM_RECIPE.floorDb);
  expect(r.v).toBeLessThan(CUT_LOFAR_NORM_RECIPE.ceilDb+5); // may slightly exceed before FE clip
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
