import {CUT_BINS,CUT_FMAX,CutSession} from './render.js';
import {STARTER_CUTS} from './starterPack.js';
import type {CutSeed} from './types.js';
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
