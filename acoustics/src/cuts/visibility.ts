import {CUT_BINS,CUT_FMAX,CutSession} from './render.js';
import {STARTER_CUTS} from './starterPack.js';
import type {CutSeed,CutClassifyingLine} from './types.js';
/** Shared cut-visibility window (Lead-approved 2026-11-08): both acoustics and FE tests read this. */
export const CUT_VISIBILITY_WINDOW={rows:120,rowDtS:.25,centerFrac:.5,fLoHz:12,fHiHz:2000,guardBins:3,sideBins:8,minContrastDb:6} as const;
export function cutVisibilityIds():readonly string[]{return STARTER_CUTS.map(c=>c.id);}
/** Mean raw LOFAR row over `rows` rows centred at `centerS` (default: centerFrac of duration). */
export function meanRawRow(cut:CutSeed|string,centerS?:number,rows:number=CUT_VISIBILITY_WINDOW.rows):Float64Array{
 const seed=typeof cut==='string'?STARTER_CUTS.find(c=>c.id===cut)!:cut,s=new CutSession(seed);
 const c=centerS??seed.durationS*CUT_VISIBILITY_WINDOW.centerFrac,start=Math.max(0,Math.round(c/CUT_VISIBILITY_WINDOW.rowDtS-rows/2));
 const b=new Float32Array(CUT_BINS),acc=new Float64Array(CUT_BINS);let i=0,n=0;
 while(n<rows&&s.writeLofarRow(b)>=0){if(i++<start)continue;for(let k=0;k<CUT_BINS;k++)acc[k]+=b[k];n++;}
 s.dispose();for(let k=0;k<CUT_BINS;k++)acc[k]/=Math.max(1,n);return acc;
}
/** Contrast (dB) of bin k vs median of bins guard+1..side away on both sides. */
export function localContrastDb(m:ArrayLike<number>,k:number):number{
 const {guardBins:g,sideBins:w}=CUT_VISIBILITY_WINDOW,nb:number[]=[];
 for(let d=g;d<=w;d++){if(k-d>=0)nb.push(m[k-d]);if(k+d<m.length)nb.push(m[k+d]);}
 nb.sort((a,b)=>a-b);return m[k]-nb[nb.length>>1];
}
export function bestLine(m:ArrayLike<number>,fLo:number=CUT_VISIBILITY_WINDOW.fLoHz,fHi:number=CUT_VISIBILITY_WINDOW.fHiHz):{hz:number;contrastDb:number}{
 const df=CUT_FMAX/(CUT_BINS-1);let best=-Infinity,bk=0;
 for(let k=Math.ceil(fLo/df);k<=Math.min(m.length-1,Math.floor(fHi/df));k++){const c=localContrastDb(m,k);if(c>best){best=c;bk=k;}}
 return {hz:bk*df,contrastDb:best};
}
/** Peak local contrast near a nominal Hz (Doppler / bin-centre slack). */
export function contrastNearHz(m:ArrayLike<number>,hz:number,halfHz=Math.max(25,hz*.025)):{hz:number;contrastDb:number}{
 const df=CUT_FMAX/(CUT_BINS-1),lo=Math.max(0,Math.floor((hz-halfHz)/df)),hi=Math.min(m.length-1,Math.ceil((hz+halfHz)/df));
 let best=-Infinity,bk=lo;
 for(let k=lo;k<=hi;k++){const c=localContrastDb(m,k);if(c>best){best=c;bk=k;}}
 return {hz:bk*df,contrastDb:best};
}
/** Seeded HYDP burst start used by scenarioFromCut (keep in sync with render.ts). */
export function cutHydpAtS(cut:CutSeed):number{return Math.min(45,Math.max(15,Math.floor(cut.durationS*.08)));}
/** Resolve a classifying line's nominal Hz from the seed or a live mid/moment snapshot. */
export function resolveLessonHz(cut:CutSeed,line:CutClassifyingLine,atS?:number):number|undefined{
 if(line.nominalHz!==undefined&&line.nominalHz>0)return line.nominalHz;
 const s=new CutSession(cut),buf=new Float32Array(CUT_BINS),target=atS??cut.durationS*CUT_VISIBILITY_WINDOW.centerFrac;
 while(s.simT<target&&s.writeLofarRow(buf)>=0){/* drain */}
 const tonals=s.engine.scenario.contacts.find(c=>c.category!=='surface')?.params.tonals??[];
 const match=tonals.filter(t=>t.lineFamily===line.lineFamily&&(line.n===undefined||t.harmonic===line.n));
 const live=match.find(t=>t.power>0)||match[0];s.dispose();
 return live&&live.hz>0?live.hz:undefined;
}
export interface LessonContrast{
 line:CutClassifyingLine;hz:number|undefined;peakHz:number|undefined;contrastDb:number|undefined;
 inWindow:boolean;/** Expect low contrast (masked fund / skipped harmonic). */expectMasked:boolean;
 /** Moment window used (HYDP burst), else shared mid-cut. */window:'mid'|'hydp-moment'|'broadband-skip';
}
/** Per classifying-line contrast on the shared mid window, or a HYDP moment window when needed. */
export function lessonLineContrasts(cut:CutSeed|string):LessonContrast[]{
 const seed=typeof cut==='string'?STARTER_CUTS.find(c=>c.id===cut)!:cut;
 const mid=meanRawRow(seed);
 const needsHydp=seed.classifyingLines.some(l=>l.lineFamily==='HYDP');
 const hydpAt=cutHydpAtS(seed);
 const hydpMoment=needsHydp?meanRawRow(seed,hydpAt+1.2,20):null;
 const {fLoHz,fHiHz,minContrastDb}=CUT_VISIBILITY_WINDOW;void minContrastDb;
 return seed.classifyingLines.map(line=>{
  const expectMasked=(line.behaviour==='skipped')||(line.behaviour==='harmonics-only'&&line.n===1&&line.lineFamily==='HYDP');
  // Cavitation / broadband teaching: tonal contrast is not the lesson metric.
  if(line.behaviour==='broadband'){
   const hz=resolveLessonHz(seed,line);
   return {line,hz,peakHz:hz,contrastDb:undefined,inWindow:!!hz&&hz>=fLoHz&&hz<=fHiHz,expectMasked:false,window:'broadband-skip' as const};
  }
  // Slow crawl BR is a DEMON lesson (gramLooks slow-demon-blade), not a LOFAR mid-window tonal.
  if(line.lineFamily==='BR'&&(seed.gramLooks??[]).includes('slow-demon-blade')){
   const hz=resolveLessonHz(seed,line);
   return {line,hz,peakHz:hz,contrastDb:undefined,inWindow:false,expectMasked:false,window:'demon-skip' as const};
  }
  const useHydp=line.lineFamily==='HYDP'&&hydpMoment;
  const at=useHydp?hydpAt+1.2:seed.durationS*CUT_VISIBILITY_WINDOW.centerFrac;
  const hz=resolveLessonHz(seed,line,at);
  if(!(hz!==undefined&&hz>0))return {line,hz:undefined,peakHz:undefined,contrastDb:undefined,inWindow:false,expectMasked,window:useHydp?'hydp-moment':'mid'};
  const inWindow=hz>=fLoHz&&hz<=fHiHz;
  if(!inWindow)return {line,hz,peakHz:undefined,contrastDb:undefined,inWindow:false,expectMasked,window:useHydp?'hydp-moment':'mid'};
  const row=useHydp?hydpMoment!:mid;
  // Masked fundamentals: keep a tight Hz window so a nearby unrelated line cannot fake a peak.
  const peak=contrastNearHz(row,hz,expectMasked?8:undefined);
  return {line,hz,peakHz:peak.hz,contrastDb:peak.contrastDb,inWindow:true,expectMasked,window:useHydp?'hydp-moment':'mid'};
 });
}
