// Deterministic harmonics + Doppler teaching plate (Part 2). Same ideal pass as cpa-plate-iii.
// Fictional fundamental 23.4 Hz with harmonics 1..6 (illustrative family, not a platform signature).
import {writeFileSync} from 'node:fs';
import {geometry,createGeometry,advance,doppler,knotsToMps,C} from '../src/index.js';
const f1=23.4,N=6,speedKn=6,v=knotsToMps(speedKn),rCpa=1200,zs=80,zr=60,durS=900,dt=5,tCpa=450;
const src={x:-v*tCpa,y:rCpa,depth:zs,course:Math.PI/2,speed:v},rx={x:0,y:0,depth:zr,course:0,speed:0},g=createGeometry();
const samples:{tS:number;fHz:number[]}[]=[];
for(let t=0;t<=durS;t+=dt){geometry(src,rx,g);samples.push({tS:t,fHz:Array.from({length:N},(_,k)=>doppler(f1*(k+1),g.sourceRadial,g.receiverRadial))});advance(src,dt);}
const first=samples[0].fHz,last=samples.at(-1)!.fHz;
const perHarmonic=first.map((hi,k)=>({n:k+1,restHz:+(f1*(k+1)).toFixed(3),startHz:hi,endHz:last[k],approachToRecedeSpreadHz:hi-last[k],perSideApproxHz:(hi-last[k])/2,spreadOverN:(hi-last[k])/(k+1),ratioToFundamentalAtStart:hi/first[0]}));
const out={assumptions:'Ideal straight pass at constant speed and depth; stationary receiver; exact Doppler; c = '+C+' m/s; all harmonics share one source.',
 truth:{fundamentalHz:f1,harmonics:N,speedKn,tCpaS:tCpa,cpaSlantRangeM:Math.hypot(rCpa,zs-zr)},
 perHarmonic,
 teach:['Figures are the approach-to-recede SPREAD across the window; each side of rest is about half of it.','Every harmonic of one source shifts by the same FRACTION, so the nth harmonic shifts n times as many hertz as the fundamental.',
  'The ratio fn/f1 stays exactly n through the pass, so HARM cursors locked to f1 stay on the family while it bends.',
  'A line whose shift does not scale with n belongs to a different source (or is not a harmonic of this one).',
  'Measure Doppler on the highest clean harmonic: the shift in Hz is largest there, so reading error matters least.'],
 display:'Waterfall: frequency x, time y, newest at bottom; t=0 is the top row.',samples};
writeFileSync('bench/results/harmonic-doppler-plate.json',JSON.stringify(out));
console.log(JSON.stringify(perHarmonic.map(p=>({n:p.n,shift:+p.approachToRecedeSpreadHz.toFixed(4),perN:+p.spreadOverN.toFixed(5),ratio:+p.ratioToFundamentalAtStart.toFixed(6)}))));
