// Deterministic Lloyd's mirror teaching plate for the Field Manual (Part 2). Same ideal pass as cpa-plate-iii
// (6 kn, horizontal CPA 1200 m, source 80 m, receiver 60 m, CPA at t=450 s, 15-min window, dt=5 s).
// Broadband source, flat (smooth) sea surface, pressure-release image (reflection -1). Fictional geometry only.
import {writeFileSync} from 'node:fs';
import {exactGain,pathDifference,nullSpacing,fitLloydsMirror,knotsToMps,C} from '../src/index.js';
const speedKn=6,v=knotsToMps(speedKn),rCpa=1200,zs=80,zr=60,durS=900,dt=5,tCpa=450,fMax=500,df=2.5;
const t=[] as number[];for(let s=0;s<=durS;s+=dt)t.push(s);
const freqs=[] as number[];for(let f=0;f<=fMax+1e-9;f+=df)freqs.push(+f.toFixed(3));
const r=(s:number)=>Math.hypot(rCpa,v*(s-tCpa));
// Gram rows: 10log10 of exact two-path gain relative to direct path (0 dB = direct path alone).
const gramDb=t.map(s=>freqs.map(f=>+(10*Math.log10(Math.max(1e-6,exactGain(f,r(s),zs,zr)))).toFixed(1)));
// Exact null (dark fringe) frequencies f_n = n c / dR and far-field approximation n c r/(2 zs zr).
const nulls=t.map(s=>{const dR=pathDifference(r(s),zs,zr),ff=nullSpacing(r(s),zs,zr);return {tS:s,rangeM:+r(s).toFixed(2),exactHz:[1,2].map(n=>+(n*C/dR).toFixed(3)),farFieldHz:[1,2].map(n=>+(n*ff).toFixed(3))};});
const iC=t.indexOf(tCpa),spacingCpa=C/pathDifference(rCpa,zs,zr),spacingEnd=C/pathDifference(r(0),zs,zr);
const fit=fitLloydsMirror(nulls.map(n=>({simT:n.tS,spacingHz:n.exactHz[0]})),{zr,c:C,rangeSource:{kind:'cpaFit',rCPA:rCpa,speed:v,tCPA:tCpa}});
const out={assumptions:'Ideal straight pass at constant speed and depth; stationary receiver; smooth pressure-release surface (reflection -1); isovelocity c = '+C+' m/s; no bottom path. Far-field form valid for r >> zs, zr.',
 truth:{speedKn,speedMps:v,tCpaS:tCpa,cpaHorizontalRangeM:rCpa,srcDepthM:zs,rxDepthM:zr},
 atCpa:{firstNullHzExact:spacingCpa,firstNullHzFarField:nullSpacing(rCpa,zs,zr),note:'Fringes are narrowest (tightest spacing) at CPA, where range is least; this is the turning point of the "bat wing".'},
 atWindowEdge:{tS:0,rangeM:r(0),firstNullHzExact:spacingEnd},
 readDepth:{formula:'zs = c r / (2 zr Δf)',fromCpaSpacingM:C*rCpa/(2*zr*spacingCpa),needs:'range from the CPA/Doppler fit and the known receiver depth; spacing alone gives only zs·zr/r'},
 fit:{ok:fit.ok,zsM:fit.zs,depthRatio:fit.depthRatio},
 display:'Waterfall: frequency x (0-'+fMax+' Hz, '+df+' Hz bins), time y, newest at bottom; t=0 is the top row. Values in dB re direct path.',
 axes:{tS:t,freqHz:freqs},nulls,gramDb};
writeFileSync('bench/results/lloyd-plate.json',JSON.stringify(out));
const {gramDb:_g,nulls:_n,axes:_a,...summary}=out;console.log(JSON.stringify(summary,null,1));
