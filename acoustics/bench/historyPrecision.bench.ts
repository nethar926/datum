/**
 * History storage precision study (Lead 2026-11-08): Float32 vs Float16-dB vs Uint8-dB
 * for LOFAR row history.
 *
 * Model: FE keeps a 600-row hot ring at 2 Hz display (= 5 min). Older history lives in a
 * cold CPU store; on scroll-back rows are paged in (dequantized) into the hot path.
 * This bench quantizes each Float32 row to the candidate cold format and measures LM /
 * Doppler / contrast on the paged-back (dequantized) values — same path Dorian's store uses.
 * Also documents Float16-of-LINEAR overflow (must store dB).
 *
 * Run: node_modules/.bin/tsx bench/historyPrecision.bench.ts
 * Writes: bench/results/history-precision.json
 */
import {writeFileSync} from 'node:fs';
import {AcousticEngine} from '../src/engine.js';
import {lloydsCpaScenario,cpaScenario} from '../src/scenario.js';
import {pathDifference,exactGain,C} from '../src/index.js';
import {fitCpaFromDoppler} from '../src/fitCpaFromDoppler.js';
import {fitLloydsMirror} from '../src/fitLloydsMirror.js';
import {
 STARTER_CUTS,meanRawRow,localContrastDb,contrastNearHz,lessonLineContrasts,
 CUT_VISIBILITY_WINDOW as W,CUT_BINS,CUT_FMAX,
} from '../src/cuts/index.js';
import {
 UINT8_SPAN_DB,UINT8_FLOOR_DB,f16round,quantizeFloat16Db,quantizeUint8Db,quantizeFloat16Linear,
} from '../src/historyQuantize.js';

function errStats(a:number[],b:number[]):{max:number;mean:number;n:number}{
 let max=0,sum=0,n=0;
 for(let i=0;i<a.length;i++){
  if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))continue;
  const e=Math.abs(a[i]-b[i]);if(e>max)max=e;sum+=e;n++;
 }
 return {max,mean:n?sum/n:0,n};
}

/** Local minima / maxima times in a 1-D series (simple 3-point). */
function extremaTimes(y:Float64Array,t0:number,dt:number):{mins:number[];maxs:number[]}{
 const mins:number[]=[],maxs:number[]=[];
 for(let i=1;i<y.length-1;i++){
  if(y[i]<y[i-1]&&y[i]<y[i+1])mins.push(t0+i*dt);
  if(y[i]>y[i-1]&&y[i]>y[i+1])maxs.push(t0+i*dt);
 }
 return {mins,maxs};
}

/** Parabolic peak bin → Hz. */
function peakHzParabola(row:ArrayLike<number>,lo:number,hi:number,df:number):number{
 let best=lo,bv=-Infinity;
 for(let k=lo;k<=hi;k++)if(row[k]>bv){bv=row[k];best=k;}
 if(best<=lo||best>=hi)return best*df;
 const y0=row[best-1],y1=row[best],y2=row[best+1];
 const denom=(y0-2*y1+y2);if(Math.abs(denom)<1e-12)return best*df;
 const delta=.5*(y0-y2)/denom;
 return (best+Math.max(-.5,Math.min(.5,delta)))*df;
}

type Fmt='float32'|'float16db'|'uint8db';

function applyFmt(src:Float32Array,fmt:Fmt,scratch:Float32Array):Float32Array{
 if(fmt==='float32'){scratch.set(src);return scratch;}
 if(fmt==='float16db')return quantizeFloat16Db(src,scratch);
 return quantizeUint8Db(src,UINT8_FLOOR_DB,UINT8_SPAN_DB,scratch);
}

// ─── 1) Lloyd's mirror gram from seeded broadband CPA ─────────────────
function runLloyd(){
 const s=lloydsCpaScenario(712);
 const e=new AcousticEngine(s,712);
 const dt=.25,rows=240; // 60 s
 const bins=s.bins,df=s.fmax/(bins-1);
 const gram=new Float32Array(rows*bins);
 const t0=e.scenario.time;
 for(let r=0;r<rows;r++){
  const out=e.step(dt);
  gram.set(out[0].row,r*bins);
 }
 // Track a mid-band bin (~2.5 kHz) time series + fringe spacing vs time
 const fTrack=2500,kTrack=Math.round(fTrack/df);
 const c=e.scenario.contacts[0],b=e.scenario.buoys[0];
 // Re-sim for truth range per row is expensive; use kinematics from start pose
 const speed=c.speed,course=c.course;
 let x=c.x-speed*Math.sin(course)*(e.scenario.time-t0); // approximate back — use stored
 // Better: re-run collecting geometry each row
 const e2=new AcousticEngine(lloydsCpaScenario(712),712);
 const ranges:number[]=[];
 const spacingExact:number[]=[];
 for(let r=0;r<rows;r++){
  e2.step(dt);
  const cc=e2.scenario.contacts[0],bb=e2.scenario.buoys[0];
  const rh=Math.hypot(cc.x-bb.x,cc.y-bb.y);
  ranges.push(rh);
  spacingExact.push(C/pathDifference(rh,cc.depth,bb.depth));
 }
 const results:Record<string,unknown>={};
 for(const fmt of ['float32','float16db','uint8db'] as Fmt[]){
  const series=new Float64Array(rows);
  const scratch=new Float32Array(bins);
  const spacings:number[]=[];
  for(let r=0;r<rows;r++){
   const row=gram.subarray(r*bins,(r+1)*bins);
   const q=applyFmt(row,fmt,scratch);
   series[r]=q[kTrack];
   // First-null estimate: min in 0.5..1.5× exact spacing band
   const sp0=spacingExact[r];
   const lo=Math.max(1,Math.floor(.5*sp0/df)),hi=Math.min(bins-2,Math.ceil(1.5*sp0/df));
   let best=lo,bv=Infinity;
   for(let k=lo;k<=hi;k++)if(q[k]<bv){bv=q[k];best=k;}
   spacings.push(best*df);
  }
  const ext=extremaTimes(series,t0,dt);
  // CPA turning point of spacing (min spacing ≈ CPA)
  let iMin=0;for(let i=1;i<spacings.length;i++)if(spacings[i]<spacings[iMin])iMin=i;
  const tCpaEst=t0+iMin*dt;
  const fit=fitLloydsMirror(spacings.map((spacingHz,i)=>({simT:t0+i*dt,spacingHz})).filter((_,i)=>i%4===0),{
   zr:b.depth,c:C,rangeSource:{kind:'cpaFit',rCPA:Math.min(...ranges),speed,tCPA:tCpaEst},
  });
  results[fmt]={
   trackHz:fTrack,
   nullTimes:ext.mins.slice(0,8),
   peakTimes:ext.maxs.slice(0,8),
   tCpaEst:+tCpaEst.toFixed(3),
   spacingAtCpaHz:+spacings[iMin].toFixed(3),
   fitOk:fit.ok,
   fitZs:fit.ok?+fit.zs.toFixed(3):null,
   fitDepthRatio:fit.ok?+fit.depthRatio.toFixed(4):null,
   residualRms:fit.ok?+fit.residualRms.toFixed(4):null,
  };
 }
 // Errors vs float32
 const ref=results.float32 as {nullTimes:number[];peakTimes:number[];tCpaEst:number;spacingAtCpaHz:number;fitZs:number|null};
 for(const fmt of ['float16db','uint8db'] as const){
  const r=results[fmt] as typeof ref;
  const nullErr=errStats(ref.nullTimes,r.nullTimes);
  const peakErr=errStats(ref.peakTimes,r.peakTimes);
  (results as any)[fmt].errorsVsFloat32={
   nullTimeMaxS:+nullErr.max.toFixed(4),nullTimeMeanS:+nullErr.mean.toFixed(4),
   peakTimeMaxS:+peakErr.max.toFixed(4),peakTimeMeanS:+peakErr.mean.toFixed(4),
   tCpaErrS:+Math.abs(ref.tCpaEst-r.tCpaEst).toFixed(4),
   spacingAtCpaErrHz:+Math.abs(ref.spacingAtCpaHz-r.spacingAtCpaHz).toFixed(4),
   zsErrM:ref.fitZs!=null&&r.fitZs!=null?+Math.abs(ref.fitZs-r.fitZs).toFixed(4):null,
  };
 }
 // Float16 linear overflow demo on a hot LM row
 const hot=gram.subarray(Math.floor(rows/2)*bins,Math.floor(rows/2)*bins+bins);
 const lin=quantizeFloat16Linear(hot);
 results.float16Linear={
  note:'Float16 max finite is 65504; LOFAR dB→linear overflows for typical gram levels (ambient ~50–80 dB → 1e5–1e8). History MUST store dB (or other log), never linear power in f16.',
  overflows:lin.overflows,underflows:lin.underflows,maxLin:+lin.maxLin.toFixed(3),bins:bins,
  overflowFraction:+(lin.overflows/bins).toFixed(4),
 };
 return {scenario:'lloydsCpaScenario(712)',rows,bins,dtS:dt,fMax:s.fmax,formats:results};
}

// ─── 2) Doppler peak track from clean CPA tonal pass ───────────────────
function runDoppler(){
 // cpaScenario: single fictional contact, steady straight pass — clean S-curve.
 const s=cpaScenario();s.seed=42;s.bins=1024;s.fmax=500;
 const e=new AcousticEngine(s,42);
 const dt=.25,rows=480; // 120 s
 const bins=s.bins,df=s.fmax/(bins-1);
 const gram=new Float32Array(rows*bins);
 e.step(0);
 const truthLines=e.scenario.contacts[0].lines??[];
 const target=(truthLines.find(l=>l.power>0&&l.hz>30&&l.hz<200)
  ??truthLines.find(l=>l.power>0)
  ??{hz:s.contacts[0].params.tonalHz||100});
 const fNom=target.hz??100;
 for(let r=0;r<rows;r++)gram.set(e.step(dt)[0].row,r*bins);
 const halfBins=Math.max(3,Math.ceil(8/df));
 const results:Record<string,unknown>={};
 for(const fmt of ['float32','float16db','uint8db'] as Fmt[]){
  const scratch=new Float32Array(bins);
  const track:number[]=[];
  for(let r=0;r<rows;r++){
   const q=applyFmt(gram.subarray(r*bins,(r+1)*bins),fmt,scratch);
   const k0=Math.round(fNom/df);
   const lo=Math.max(1,k0-halfBins*3),hi=Math.min(bins-2,k0+halfBins*3);
   // Follow previous estimate after first samples
   const prev=track.length?track[track.length-1]/df:k0;
   const lo2=Math.max(1,Math.floor(prev)-halfBins),hi2=Math.min(bins-2,Math.ceil(prev)+halfBins);
   track.push(peakHzParabola(q,lo2,hi2,df));
  }
  const t0=0; // relative
  const samples=track.map((fHz,i)=>({tS:i*dt,fHz}));
  // Approach / recede: mean of first 40 vs last 40
  const n=40;
  const fApp=samples.slice(0,n).reduce((a,s)=>a+s.fHz,0)/n;
  const fRec=samples.slice(-n).reduce((a,s)=>a+s.fHz,0)/n;
  const fit=fitCpaFromDoppler(samples.filter((_,i)=>i%2===0),{c:C,maxSpeed:40});
  results[fmt]={
   fNom:+fNom.toFixed(3),
   fApproach:+fApp.toFixed(4),
   fRecede:+fRec.toFixed(4),
   shiftHz:+(fApp-fRec).toFixed(4),
   fitOk:fit.ok,
   fitF0:fit.ok?+fit.f0.toFixed(4):null,
   fitSpeedMps:fit.ok?+fit.speed.toFixed(4):null,
   fitTCpa:fit.ok?+fit.tCPA.toFixed(3):null,
   fitRCpa:fit.ok?+fit.rCPA.toFixed(2):null,
   trackHz:track.filter((_,i)=>i%20===0).map(v=>+v.toFixed(4)),
  };
 }
 const ref=results.float32 as any;
 for(const fmt of ['float16db','uint8db'] as const){
  const r=results[fmt] as any;
  const trackErr=errStats(
   (results.float32 as any).trackHz,
   r.trackHz,
  );
  r.errorsVsFloat32={
   trackMaxHz:+trackErr.max.toFixed(5),
   trackMeanHz:+trackErr.mean.toFixed(5),
   shiftErrHz:+Math.abs(ref.shiftHz-r.shiftHz).toFixed(5),
   f0ErrHz:ref.fitF0!=null&&r.fitF0!=null?+Math.abs(ref.fitF0-r.fitF0).toFixed(5):null,
   speedErrMps:ref.fitSpeedMps!=null&&r.fitSpeedMps!=null?+Math.abs(ref.fitSpeedMps-r.fitSpeedMps).toFixed(5):null,
  };
 }
 return {scenario:'cpaScenario(seed=42)',rows,bins,dtS:dt,fMax:s.fmax,fNom,formats:results};
}

// ─── 3) Line contrast on shared window (starter cut) ───────────────────
function runContrast(){
 const cut=STARTER_CUTS.find(c=>c.id==='cut-orbelune-msr')!;
 const mid=meanRawRow(cut); // Float64 mean
 const lessons=lessonLineContrasts(cut);
 const df=CUT_FMAX/(CUT_BINS-1);
 const results:Record<string,unknown>={};
 for(const fmt of ['float32','float16db','uint8db'] as Fmt[]){
  const row=new Float32Array(mid.length);
  if(fmt==='float32')row.set(mid);
  else if(fmt==='float16db')quantizeFloat16Db(mid as any,row);
  else quantizeUint8Db(mid as any,UINT8_FLOOR_DB,UINT8_SPAN_DB,row);
  const perLesson=lessons.filter(l=>l.inWindow&&l.hz).map(l=>{
   const peak=contrastNearHz(row,l.hz!,l.expectMasked?8:undefined);
   return {family:l.line.lineFamily,n:l.line.n,hz:l.hz,contrastDb:+peak.contrastDb.toFixed(4),peakHz:+peak.hz.toFixed(2)};
  });
  // Also best-line
  let best=-Infinity,bk=0;
  for(let k=Math.ceil(W.fLoHz/df);k<=Math.min(row.length-1,Math.floor(W.fHiHz/df));k++){
   const c=localContrastDb(row,k);if(c>best){best=c;bk=k;}
  }
  results[fmt]={bestHz:+(bk*df).toFixed(2),bestContrastDb:+best.toFixed(4),lessons:perLesson};
 }
 const ref=results.float32 as any;
 for(const fmt of ['float16db','uint8db'] as const){
  const r=results[fmt] as any;
  const contrasts=ref.lessons.map((l:any,i:number)=>[l.contrastDb,r.lessons[i].contrastDb] as [number,number]);
  const e=errStats(contrasts.map((x:number[])=>x[0]),contrasts.map((x:number[])=>x[1]));
  r.errorsVsFloat32={
   lessonContrastMaxDb:+e.max.toFixed(5),
   lessonContrastMeanDb:+e.mean.toFixed(5),
   bestContrastErrDb:+Math.abs(ref.bestContrastDb-r.bestContrastDb).toFixed(5),
  };
 }
 return {cutId:cut.id,window:W,uint8:{floorDb:UINT8_FLOOR_DB,spanDb:UINT8_SPAN_DB},formats:results};
}

const lloyd=runLloyd();
const doppler=runDoppler();
const contrast=runContrast();

function verdict(){
 const lm16=(lloyd.formats as any).float16db.errorsVsFloat32;
 const lm8=(lloyd.formats as any).uint8db.errorsVsFloat32;
 const d16=(doppler.formats as any).float16db.errorsVsFloat32;
 const d8=(doppler.formats as any).uint8db.errorsVsFloat32;
 const c16=(contrast.formats as any).float16db.errorsVsFloat32;
 const c8=(contrast.formats as any).uint8db.errorsVsFloat32;
 const f16Linear=(lloyd.formats as any).float16Linear;
 // Float16-dB: step ~0.03–0.06 dB near 60–120 → expect sub-bin / sub-0.1 dB errors
 const f16Ok=
  lm16.tCpaErrS<=0.5&&lm16.spacingAtCpaErrHz<1&&
  d16.trackMeanHz<0.05&&d16.shiftErrHz<0.05&&
  c16.lessonContrastMaxDb<0.1;
 const u8HurtsContrast=c8.lessonContrastMaxDb>=0.1; // ~⅓ of a Uint8 step is already measurable
 const u8DopplerOk=d8.trackMeanHz<0.1&&d8.shiftErrHz<0.1; // Doppler is bin-position, not level
 return {
  float16Db:{
   losesAnythingMeasurable:!f16Ok,
   ok:f16Ok,
   lessonContrastMaxDb:c16.lessonContrastMaxDb,
   summary:f16Ok
    ?'Float16-dB errors stay below measurement noise for LM fringe timing, Doppler track, and line contrast. Safe for CPU history.'
    :'Float16-dB showed measurable error on at least one metric — inspect tables.',
  },
  uint8Db:{
   losesAnythingMeasurable:u8HurtsContrast||lm8.spacingAtCpaErrHz>=0.5||(lm8.zsErrM!=null&&lm8.zsErrM>1),
   dopplerMostlyOk:u8DopplerOk,
   lessonContrastMaxDb:c8.lessonContrastMaxDb,
   summary:u8HurtsContrast
    ?`Uint8-dB (~${(80/255).toFixed(2)} dB/step over 80 dB) changes lesson contrast by up to ${c8.lessonContrastMaxDb.toFixed(2)} dB; Doppler bin-track stays nearly intact. Reject for history; prefer Float16-dB.`
    :'Uint8-dB stayed within tolerance on this plate set (still lossy; Lead preference remains Float16).',
  },
  float16Linear:{
   mustStoreDb:true,
   overflowFraction:f16Linear.overflowFraction,
   summary:'Float16 of linear power overflows on ordinary gram levels; history must store dB (or another log domain).',
  },
 };
}

const out={
 note:'History precision (cold-store page-back): Float32 hot reference vs Float16-dB / Uint8-dB cold formats dequantized as if paged into the 600-row @ 2 Hz (5 min) hot ring. Uint8 span 80 dB from floor 40. Float16-linear unsuitable. Fictional scenarios only. GPU textures already Float16.',
 generatedAt:new Date().toISOString(),
 uint8:{floorDb:UINT8_FLOOR_DB,spanDb:UINT8_SPAN_DB,stepDb:+(UINT8_SPAN_DB/255).toFixed(4)},
 float16DbNote:'IEEE-754 binary16 via Math.f16round; ~0.03–0.06 dB step near 60–120 dB.',
 lloyd,
 doppler,
 contrast,
 verdict:verdict(),
};
writeFileSync('bench/results/history-precision.json',JSON.stringify(out,null,1));
console.log(JSON.stringify({verdict:out.verdict,lm16:(lloyd.formats as any).float16db.errorsVsFloat32,lm8:(lloyd.formats as any).uint8db.errorsVsFloat32,d16:(doppler.formats as any).float16db.errorsVsFloat32,d8:(doppler.formats as any).uint8db.errorsVsFloat32,c16:(contrast.formats as any).float16db.errorsVsFloat32,c8:(contrast.formats as any).uint8db.errorsVsFloat32,f16lin:(lloyd.formats as any).float16Linear},null,2));
