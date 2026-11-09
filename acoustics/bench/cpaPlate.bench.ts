// Deterministic CPA teaching example for the Field Manual (Plate iii).
// Ideal straight, constant-speed, constant-depth pass past a stationary buoy, using the sim's own
// geometry() and exact doppler(). Fictional tonal; not a platform signature.
import {writeFileSync} from 'node:fs';
import {geometry,createGeometry,advance,doppler,dopplerApprox,fitCpaFromDoppler,knotsToMps,C} from '../src/index.js';
const f0=142.0, speedKn=6, v=knotsToMps(speedKn), cpaHorizM=1200, srcDepth=80, rxDepth=60, durS=900, dt=5, tCpa=450;
// Source heads east (course 90°); at t=tCpa it is due north of the buoy by cpaHorizM.
const src={x:-v*tCpa,y:cpaHorizM,depth:srcDepth,course:Math.PI/2,speed:v}, rx={x:0,y:0,depth:rxDepth,course:0,speed:0};
const g=createGeometry(), samples:{tS:number;fHz:number;fApproxHz:number;rangeM:number;bearingDeg:number}[]=[];
for(let t=0;t<=durS;t+=dt){geometry(src,rx,g);samples.push({tS:t,fHz:doppler(f0,g.sourceRadial,g.receiverRadial),fApproxHz:dopplerApprox(f0,g.sourceRadial,g.receiverRadial),rangeM:g.range,bearingDeg:g.bearing*180/Math.PI});advance(src,dt);}
const R=Math.hypot(cpaHorizM,srcDepth-rxDepth);
const fhiAsym=doppler(f0,v),floAsym=doppler(f0,-v);           // infinite-range asymptotes
const fhiObs=samples[0].fHz,floObs=samples.at(-1)!.fHz;        // what a 15-min gram actually shows
const iC=samples.findIndex(s=>s.tS===tCpa),slopeNum=(samples[iC+1].fHz-samples[iC-1].fHz)/(2*dt),slopeFormula=-f0*v*v/(C*R);
const fit=fitCpaFromDoppler(samples.map(({tS,fHz})=>({tS,fHz})));
const out={assumptions:'Low-speed approximation; constant-frequency source; straight pass at constant speed and depth; stationary receiver; R = closest slant range; c = '+C+' m/s',
 truth:{f0,speedKn,speedMps:v,tCpaS:tCpa,cpaSlantRangeM:R,srcDepthM:srcDepth,rxDepthM:rxDepth},
 readFromAsymptotes:{fhi:fhiAsym,flo:floAsym,f0Est:(fhiAsym+floAsym)/2,speedEstMps:C*(fhiAsym-floAsym)/(fhiAsym+floAsym)},
 readFromGramEnds:{fhi:fhiObs,flo:floObs,f0Est:(fhiObs+floObs)/2,speedEstMps:C*(fhiObs-floObs)/(fhiObs+floObs),note:'15-min window ends short of the asymptotes, so the end-point read under-estimates speed'},
 slopeAtCpa:{numericHzPerS:slopeNum,formulaHzPerS:slopeFormula,rangeFromSlopeM:-f0*v*v/(C*slopeNum)},
 fit, display:'Waterfall: frequency x, time y, newest at bottom; t=0 is the top row.',samples};
writeFileSync('bench/results/cpa-plate-iii.json',JSON.stringify(out,null,1));
const {samples:_s,...summary}=out;console.log(JSON.stringify(summary,null,1));
