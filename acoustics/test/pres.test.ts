import {describe,it,expect} from 'vitest';
import {catalog,deriveSignature,configurePropulsion,updateDerivedSignature,effectiveParams,writePlantTonals,presEnvelope,ResLofarGenerator,LofarGenerator,resParams,cpaScenario,fictionalSignature,type SubmarineClass,type ModeInput} from '../src/index.js';
import type {Contact,Environment} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';
import type {TonalLine} from '../src/sourceModel.js';
import {CUT_BINS,CUT_FMAX} from '../src/cuts/render.js';

const byId=(id:string)=>catalog.classes.find(c=>c.id===id)!;
const patrolKn=(c:SubmarineClass)=>Math.min(10,Math.max(8,c.params.quietSpeedKn+2),c.params.maxSpeedKn);
function sig(c:SubmarineClass,speed:number,mode:ModeInput,seed=3){const s=deriveSignature(c,'base',{speedKn:speed,depthM:50,mode});configurePropulsion(s,seed,'pres',mode);updateDerivedSignature(s,effectiveParams(c),speed,50,mode);return s;}
const pres=(s:ReturnType<typeof sig>)=>s.tonals!.filter(l=>l.lineFamily==='PRES');
const modeOf=(c:SubmarineClass):ModeInput=>c.plant==='nuclear'?'NUC':'BATT';
const withPres=catalog.classes.filter(c=>c.propResonance);

describe('PRES prop resonance (Wilson: shares PSR spacing, ∝ PSR)',()=>{
 it('a third to a half of classes carry PRES; centre at patrol in tens–low hundreds Hz',()=>{
  expect(withPres.length/catalog.classes.length).toBeGreaterThanOrEqual(1/3);expect(withPres.length/catalog.classes.length).toBeLessThanOrEqual(.5);
  for(const c of withPres){const f=c.propResonance!.nCentre*c.tpk*patrolKn(c)/60;expect(f).toBeGreaterThanOrEqual(20);expect(f).toBeLessThanOrEqual(200);
   const fam=c.idKeys.harmonicFamilies.find(h=>h.lineFamily==='PRES')!;expect(fam.orders).toEqual([c.propResonance!.nCentre-c.propResonance!.halfWidth,c.propResonance!.nCentre+c.propResonance!.halfWidth]);
   expect(fam.fundamentalHz[1]).toBeGreaterThanOrEqual(c.maxPsrpm/60);expect(c.idKeys.linesVisiblePerMode[c.plant==='nuclear'?'NUC':'BATT']).toContain('PRES');}
  for(const c of catalog.classes.filter(c=>!c.propResonance))expect(c.idKeys.harmonicFamilies.some(h=>h.lineFamily==='PRES')).toBe(false);
 });
 it('every PRES line is an integer multiple of its live PSR and spacing equals PSR',()=>{
  for(const c of withPres){const s=sig(c,patrolKn(c),modeOf(c)),t=s.propulsion!,lines=pres(s);expect(lines.length).toBe(c.shafts*(2*c.propResonance!.halfWidth+1));
   for(const l of lines){const psr=t.shafts[l.shaftIndex!].hz,n=l.hz/psr;expect(Math.abs(n-Math.round(n))).toBeLessThan(1e-9);expect(l.harmonic).toBe(Math.round(n));expect(l.fundamentalHz).toBeCloseTo(psr,12);}
   for(let shaft=0;shaft<c.shafts;shaft++){const f=lines.filter(l=>l.shaftIndex===shaft).map(l=>l.hz);for(let k=1;k<f.length;k++)expect(f[k]-f[k-1]).toBeCloseTo(t.shafts[shaft].hz,9);}
   expect(lines.some(l=>l.power>0)).toBe(true);}
 });
 it('doubling PSR doubles every PRES frequency; envelope (orders) is unchanged',()=>{
  for(const c of withPres){const mode=modeOf(c),s=sig(c,patrolKn(c),mode),a=pres(s).map(l=>({hz:l.hz,p:l.power,n:l.harmonic}));
   for(const sh of s.propulsion!.shafts){sh.hz*=2;sh.rpm*=2;}writePlantTonals(s,mode,effectiveParams(c).electricalHarmonics,effectiveParams(c).srcHzPerKn,patrolKn(c));
   const b=pres(s);b.forEach((l,i)=>{expect(l.hz).toBeCloseTo(2*a[i].hz,9);expect(l.harmonic).toBe(a[i].n);});
   if(c.shafts===1)b.forEach((l,i)=>expect(l.power).toBeCloseTo(a[i].p,12));}
 });
 it('envelope is in PSR orders: peak at nCentre, weights only',()=>{for(const c of withPres){const r=c.propResonance!;expect(presEnvelope(r,r.nCentre)).toBe(1);expect(presEnvelope(r,r.nCentre-r.halfWidth)).toBeCloseTo(presEnvelope(r,r.nCentre+r.halfWidth),12);}});
 it('absent when the shaft is stopped',()=>{for(const c of withPres){const s=sig(c,0,modeOf(c));expect(pres(s).every(l=>l.power===0)).toBe(true);}});
 it('on D/E and battery tracks PSR, not the engine',()=>{
  const c=byId('green-fennelglint');for(const mode of ['D/E','BATT'] as const){const s=sig(c,patrolKn(c),mode),t=s.propulsion!;for(const l of pres(s))expect(l.hz).toBeCloseTo(l.harmonic!*t.shafts[0].hz,9);
   const before=pres(s).map(l=>l.hz),sheet=(s.plantSpec!.machinery as {engines:{erpm:{normal:number}}[]}).engines[0];const saved=sheet.erpm.normal;sheet.erpm.normal*=.8;updateDerivedSignature(s,effectiveParams(c),patrolKn(c),50,mode);sheet.erpm.normal=saved;expect(pres(s).map(l=>l.hz)).toEqual(before);}
 });
 it('deterministic for a given seed',()=>{for(const c of withPres){const a=pres(sig(c,patrolKn(c),modeOf(c),11)),b=pres(sig(c,patrolKn(c),modeOf(c),11));expect(b).toEqual(a);}});
 it('speed-windowed classes show PRES only inside [onsetKn, offsetKn]',()=>{
  const c=byId('red-sablequill'),r=c.propResonance!;expect(r.onsetKn).toBeDefined();expect(r.offsetKn).toBeDefined();
  for(const kn of [r.onsetKn!-1,r.offsetKn!+1])expect(pres(sig(c,kn,'NUC')).every(l=>l.power===0)).toBe(true);
  for(const kn of [r.onsetKn!+1,(r.onsetKn!+r.offsetKn!)/2,r.offsetKn!-1])expect(pres(sig(c,kn,'NUC')).some(l=>l.power>0)).toBe(true);
  expect(c.idKeys.propResonance!.speedKts).toEqual([r.onsetKn,r.offsetKn]);
 });
 it('twin shafts emit their own n·PSR lines; matched rates give two coincident lines (no merge)',()=>{
  const c=byId('green-thistledrift'),mode='NUC',s=sig(c,patrolKn(c),mode),t=s.propulsion!,p=effectiveParams(c),w=2*c.propResonance!.halfWidth+1;
  t.shafts[1].hz=t.shafts[0].hz;writePlantTonals(s,mode,p.electricalHarmonics,p.srcHzPerKn,patrolKn(c));const l=pres(s);expect(l.length).toBe(2*w);
  for(let k=0;k<w;k++){expect(l[w+k].hz).toBe(l[k].hz);expect(l[w+k].power).toBe(l[k].power);expect(l[k].power).toBeGreaterThan(0);}
 });
});

// Stream-side resolution: same twin-shaft contact, small rate difference → doublet on ELF 0.0625 Hz,
// single peak on the 0.977 Hz cut stream. Matched rates sum incoherently (physical sum, no double count).
const env=():Environment=>({...cpaScenario().environment});
const buoy:Buoy={id:'buoy-1',rfChannel:1,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type:'passive-omni'};
const contact=(tonals:TonalLine[]):Contact=>({id:'pres',category:'subsurface',x:0,y:400,depth:60,course:0,speed:0,motion:[{at:0,course:0,speed:0,depth:60}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:0,tonals}});
/** Twin centre-order PRES pair from the live model with shaft 1 offset by dHz at order n. */
function twinPair(dHz:number):TonalLine[]{const c=byId('green-thistledrift'),mode='NUC',s=sig(c,patrolKn(c),mode),t=s.propulsion!,p=effectiveParams(c),n=c.propResonance!.nCentre;
 t.shafts[1].hz=t.shafts[0].hz+dHz/n;writePlantTonals(s,mode,p.electricalHarmonics,p.srcHzPerKn,patrolKn(c));
 return pres(s).filter(l=>l.harmonic===n).map(l=>({family:'motor',hz:l.hz,power:1,width:'discrete',stability:'stable'}));}
function resDeposit(lines:TonalLine[],res:2|6,centre:number):{d:Float64Array;df:number;f0:number}{const g=new ResLofarGenerator(buoy,[contact(lines)],500,7,env(),{res,vernierHz:centre});
 const saved=lines.map(l=>l.power);lines.forEach(l=>l.power=0);g.generate();const base=Float64Array.from(g.expected);lines.forEach((l,i)=>l.power=saved[i]);g.generate();const d=new Float64Array(g.bins);for(let i=0;i<g.liveBins;i++)d[i]=g.expected[i]-base[i];return {d,df:resParams(res).fBin,f0:centre-512*resParams(res).fBin};}
function cutDeposit(lines:TonalLine[]):{d:Float64Array;df:number}{const g=new LofarGenerator(buoy,[contact(lines)],CUT_BINS,CUT_FMAX,7,env()),pw=()=>Float64Array.from((g as unknown as {power:Float64Array}).power);
 const saved=lines.map(l=>l.power);lines.forEach(l=>l.power=0);g.generate();const base=pw();lines.forEach((l,i)=>l.power=saved[i]);g.generate();const now=pw();return {d:now.map((v,i)=>v-base[i]),df:CUT_FMAX/(CUT_BINS-1)};}
/** Peaks: local maxima ≥ 25% of the global max. */
function peaks(d:ArrayLike<number>):number{let m=0;for(let i=0;i<d.length;i++)m=Math.max(m,d[i]);let n=0;for(let i=1;i<d.length-1;i++)if(d[i]>=.25*m&&d[i]>d[i-1]&&d[i]>=d[i+1])n++;return n;}
const sum=(a:ArrayLike<number>)=>{let x=0;for(let i=0;i<a.length;i++)x+=a[i];return x;};
describe('PRES twin-shaft resolution is decided by each stream bin',()=>{
 it('0.3 Hz split resolves on ELF 0.0625 Hz and is a single peak on the 0.977 Hz cut stream',()=>{
  const pair=twinPair(.3);expect(Math.abs(pair[1].hz-pair[0].hz)).toBeCloseTo(.3,9);
  expect(resParams(2).fBin).toBe(.0625);const fine=resDeposit(pair,2,(pair[0].hz+pair[1].hz)/2);expect(peaks(fine.d)).toBe(2);
  const coarse=cutDeposit(twinPair(.3));expect(coarse.df).toBeCloseTo(.977,3);expect(peaks(coarse.d)).toBe(1);
 });
 it('matched rates: two coincident lines sum incoherently to the physical total (no double count)',()=>{
  const pair=twinPair(0);expect(pair[1].hz).toBe(pair[0].hz);const centre=pair[0].hz;
  for(const dep of [(l:TonalLine[])=>resDeposit(l,2,centre).d,(l:TonalLine[])=>cutDeposit(l).d]){
   const both=sum(dep(twinPair(0))),a=sum(dep([twinPair(0)[0]])),b=sum(dep([twinPair(0)[1]]));
   expect(a).toBeGreaterThan(0);expect(Math.abs(both/(a+b)-1)).toBeLessThan(1e-9);expect(peaks(dep(twinPair(0)))).toBe(1);}
 });
});
