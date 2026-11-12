/**
 * Export TypeScript golden fixtures for the Swift engine port (ios/DatumAcoustics).
 *
 * Run from acoustics/:  npx tsx scripts/exportSwiftFixtures.ts [--bench]
 *
 * Fixture boundary: LofarGenerator.generate(). For each captured row we snapshot exactly
 * what the generator reads at that instant (buoy, environment, water column, per-contact
 * kinematic state + live source params + tonal lines) and the outputs it produces (dB row,
 * DIFAR bearing row, top-8 line list, beam bearing). Scenario stepping / catalog derivation
 * stays in TS; the Swift side must reproduce one row from the snapshot, bit-for-bit RNG.
 * Fictional parameters only (public textbook physics).
 */
import {writeFileSync,mkdirSync,statSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LofarGenerator} from '../src/lofar.js';
import {ResLofarGenerator,setTileAccumBudget} from '../src/resGram.js';
import {resParams,resBand,tileBand,tileCountFor,tileIndexForHz,priorityTileOrder,gammaP,gammaUnit,tpswBias,welchEdof,welchRowCorrelation,HANN_OVERLAP_AMPLITUDE,RES_FRAME_S} from '../src/res.js';
import {AcousticEngine} from '../src/engine.js';
import {cpaScenario} from '../src/scenario.js';
import {SIM_STREAM_SET} from '../src/cuts/index.js';
import {renderCut} from '../src/cuts/index.js';
import {mulberry32,gaussian,deriveSeed} from '../src/prng.js';
import {ambientLevel} from '../src/ambientNoise.js';
import {thorp,spreadingLoss,transmissionLoss} from '../src/transmissionLoss.js';
import {soundSpeed,mackenzieOutOfRange,vapourPressurePa,seawaterDensity,cavitationInceptionSpeedKn} from '../src/units.js';
import {buildWaterColumn} from '../src/waterColumn.js';
import {estimateConvergenceZone,czPropagationGainLinear} from '../src/convergenceZone.js';
import {advance,geometry,createGeometry} from '../src/kinematics.js';
import {doppler,dopplerApprox} from '../src/doppler.js';
import {fitCpaFromDoppler,type DopplerSample} from '../src/fitCpaFromDoppler.js';
import {pathDifference,exactGain,interferenceGain,farFieldGain,nullRange,nullSpacing,seaSurfaceSigma} from '../src/lloydsMirror.js';
import {fitLloydsMirror,type LloydFitOptions} from '../src/fitLloydsMirror.js';
import {knotsToMps} from '../src/units.js';
import {striationCurves} from '../src/striationCurves.js';
import {LloydPassTracker,lloydPassQualifier,type LloydPassSample} from '../src/lloydPass.js';
import type {Contact,Environment} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';
import type {TonalLine} from '../src/sourceModel.js';
import {catalog} from '../src/catalog/classes.js';
import {effectiveParams} from '../src/catalog/schema.js';
import {STARTER_CUTS,SCENARIO_CUTS,CutSession,applyRuntimeFidelity} from '../src/cuts/index.js';
import {resForBand,vernierHzForBand} from '../src/streamSet.js';
import {contactSwaths} from '../src/stateHistory.js';
import {exportScenarioGen} from './scenarioGenFixtures.js';

const OUT=join(dirname(fileURLToPath(import.meta.url)),'../../ios/DatumAcoustics/Fixtures');
mkdirSync(OUT,{recursive:true});
// Large fixtures go to Fixtures/generated/ (gitignored; regenerate with ios/DatumAcoustics/scripts/regen-fixtures.sh).
// Committed: the small fixtures in Fixtures/ and the golden manifests in Fixtures/golden/ (hashes only).
const GEN=join(OUT,'generated'),GOLD=join(OUT,'golden');mkdirSync(GEN,{recursive:true});mkdirSync(GOLD,{recursive:true});
const GENERATED=new Set(['scalars-v8math.json','jsmath.json','synth-many-32.json','cut-cinderlilt-cav.json','cut-brindleflux-snork.json','cut-morrowcoil-hydp-masked.json','res-cut-cinderlilt.json','res-cut-brindleflux.json','res-many-32.json']);

/** Float32 values round-trip exactly with 9 significant digits; float64 with 17. */
const f32=(x:number):number|null=>Number.isFinite(x)?Number(Math.fround(x).toPrecision(9)):null;
/** JSON-safe numbers: NaN/±Infinity → null (Swift decodes null as NaN). */
const num=(x:number):number|null=>Number.isFinite(x)?x:null;
const f64=(x:number|undefined):number|null=>x===undefined||!Number.isFinite(x)?null:x;

type Snapshot={rowIndex:number;contacts:unknown[];expected:{row:(number|null)[];bearingRow:(number|null)[]|null;bearingRad:number;lines:{freqHz:number;brgDeg:number;quality:number}[]}};

function snapshotContact(item:any):unknown{
 const c=item.contact as Contact,p=c.params;
 if(c.active===false)return {id:c.id,active:false,expectGain:item.gain};
 const lines=(c.lines??[]) as TonalLine[];
 return {
  id:c.id,active:true,x:c.x,y:c.y,depth:c.depth,course:c.course,speed:c.speed,
  levelDb:p.levelDb,hasTonals:p.tonals!==undefined,tonalRefDb:f64(p.tonalRefDb),cavitationPower:f64(p.cavitationPower),
  flowNoiseDb:f64(p.flowNoiseDb),flowRadiatedFraction:f64(p.flowRadiatedFraction),draughtSurfacedM:f64(p.draughtSurfacedM),
  // Effective tonal frequency = frequencyHz ?? hz (fillTonals); width/sigma fix the constructor kernel.
  lines:lines.map(l=>({hz:f64(l?.frequencyHz??l?.hz??0),power:f64(l?.power??0),width:l?.width??'discrete',sigmaBins:l?.sigmaBins??2.5})),
  swaths:item.swaths.map((w:any)=>({loHz:w.source.loHz,hiHz:w.source.hiHz,gain:w.source.gain})),
  stateBroadband:p.stateBroadband?{snort:{...p.stateBroadband.snort},waveSlap:{...p.stateBroadband.waveSlap}}:null,
  expectGain:item.gain,
 };
}

/** Wrap generate() once; capture rows of instances registered in `want`. */
const want=new Map<LofarGenerator,{rows:Set<number>;out:Snapshot[]}>();
const orig=LofarGenerator.prototype.generate;
LofarGenerator.prototype.generate=function(this:any,out?:Float32Array,offset?:number){
 const w=want.get(this),rowIndex=this.rowIndex as number,take=w?.rows.has(rowIndex);
 const pre=take?this.contacts.map(snapshotContact):null;
 const target=out??this.row,off=offset??0;
 const r=orig.call(this,target,off);
 if(take&&w){
  const row=Array.from(target.subarray(off,off+this.bins),f32);
  const bearingRow=this.difar?Array.from(this.bearingRow as Float32Array,f32):null;
  w.out.push({rowIndex,contacts:pre!,expected:{row,bearingRow,bearingRad:this.bearing,lines:this.lines.slice(0,this.lineCount).map((l:any)=>({...l}))}});
 }
 return r;
};

function header(g:any,seed:number,name:string,source:string,note:string){
 const b=g.buoy as Buoy,wc=g.waterColumn;
 return {name,source,note,seed,bins:g.bins,fmax:g.fmax,f0:g.f0,
  buoy:{id:b.id,type:b.type,x:b.x,y:b.y,depth:b.depth,course:b.course,speed:b.speed},
  environment:{...g.environment},
  waterColumn:wc?{depthM:Array.from(wc.depthM),soundSpeedMps:Array.from(wc.soundSpeedMps)}:null};
}
const files:string[]=[];
function write(name:string,obj:unknown){const f=join(GENERATED.has(name)||name.startsWith('e2e/')?GEN:OUT,name);writeFileSync(f,JSON.stringify(obj));files.push(f);}
/** FNV-1a 32 over raw bytes (same as Swift fnv32Bytes). */
function fnvBytes(u8:Uint8Array,h=0x811c9dc5){for(let i=0;i<u8.length;i++){h^=u8[i];h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
const f64Hash=(a:number[])=>fnvBytes(new Uint8Array(Float64Array.from(a).buffer));
const goldenLibm:Record<string,unknown>={note:'FNV-1a 32 of the little-endian f64 bit patterns of V8 Math.* outputs (inputs regenerated in Swift, see JSMathTests / FdlibmMathTests). Full arrays: Fixtures/generated/.'};

// ---------- 1. PRNG + scalar physics goldens ----------
{
 const seeds=[0,1,42,3228631042,0xffffffff,123456789];
 // values are exact k/2^32 doubles; u32 carries the raw integer so the Swift test can compare bit-for-bit.
 const seq=seeds.map(s=>{const r=mulberry32(s);const values=Array.from({length:64},()=>r());return {seed:s,values,u32:values.map(v=>v*4294967296)};});
 const gauss=seeds.map(s=>{const r=mulberry32(s);return {seed:s,values:Array.from({length:32},()=>gaussian(r))};});
 const ids=['buoy:buoy-1','bearing:buoy-1','contact:fictional-a','contact:sfc-07','','é-ünïcode','🐋 pod'];
 const derive=seeds.flatMap(s=>ids.map(id=>({seed:s,id,value:deriveSeed(s,id)})));
 const reset=(()=>{const r=mulberry32(7);r();r();r.reset!(99);return Array.from({length:8},()=>r());})();
 write('prng.json',{mulberry32:seq,gaussian:gauss,deriveSeed:derive,resetTo99:reset});
 const fs=[0,1,5,10,37.5,100,250,500,999,1000,2000,4000];
 const ambient=fs.flatMap(f=>[0,1,3,6].flatMap(ss=>(['light','moderate','heavy'] as const).flatMap(sh=>[undefined,0,.35,1].map(d=>({f,seaState:ss,shipping:sh,density:d??null,value:ambientLevel(f,ss,sh,d)})))));
 const tl={thorp:fs.map(f=>({f,value:thorp(f)})),spreading:[0,1,10,999,1000,5000,60000].flatMap(r=>(['spherical','cylindrical','hybrid'] as const).map(m=>({range:r,mode:m,transition:1000,value:spreadingLoss(r,m,1000)})))};
 const wc=buildWaterColumn({surfaceTempC:22,deepTempC:3,salinityPsu:35,maxDepthM:4500,samples:64});
 const cz=[[80,60],[40,60],[300,100]].map(([zs,zr])=>{const e=estimateConvergenceZone({profile:wc,zsM:zs,zrM:zr});return {zs,zr,possible:e.possible,rangeM:e.rangeM,criticalDepthM:e.criticalDepthM,gains:[50000,58000,60190,62000,70000].map(r=>({range:r,value:czPropagationGainLinear(r,e,{enabled:true})}))};});
 // V8 Math.exp/Math.log goldens (fdlibm) for jsExp/jsLog; null = NaN.
 const v8x=[0,-0,1,-1,.5,1e-300,5e-324,-5e-324,709.7,709.79,-745.1,-746,1e-9,0.34657359027997264,0.34657359027997270,1.0397207708399179,Infinity,-Infinity,...Array.from({length:3000},(_,i)=>{const r=mulberry32(9000+i);return (r()-.5)*2*10**(r()*6-3);})];
 const sx=(x:number):number|string=>Number.isFinite(x)?x:String(x); // 'Infinity' | '-Infinity' | 'NaN'
 const v8math={x:v8x.map(sx),exp:v8x.map(x=>sx(Math.exp(x))),logAbs:v8x.map(x=>sx(Math.log(Math.abs(x))))};
 write('scalars-v8math.json',{v8math});
 {const num=(v:number|string)=>typeof v==='number'?v:Number(v);goldenLibm.v8math={n:v8x.length,x:Buffer.from(Float64Array.from(v8x).buffer).toString('base64'),exp:f64Hash(v8math.exp.map(num)),logAbs:f64Hash(v8math.logAbs.map(num))};}
 write('scalars.json',{ambient,transmissionLoss:tl,waterColumn:{depthM:Array.from(wc.depthM),soundSpeedMps:Array.from(wc.soundSpeedMps)},convergenceZone:cz});
}

// ---------- 1b. Doppler: closed form + CPA fitter (doppler.ts, fitCpaFromDoppler.ts) ----------
const fitOut=(f:ReturnType<typeof fitCpaFromDoppler>)=>({ok:f.ok,f0:num(f.f0),speed:num(f.speed),tCPA:num(f.tCPA),rCPA:num(f.rCPA),residualRms:num(f.residualRms)});
/** Seeded straight-line pass past a stationary buoy: f(t)=doppler(f0, v_s(t), 0, c) + N(0,σ). Fictional. */
function seededPass(seed:number,o:{n?:number;dt?:number;sigmaHz?:number;from?:number;to?:number;c?:number}={}){
 const r=mulberry32(seed),f0=40+360*r(),speed=2+13*r(),rCpa=300+4700*r(),tCpa=100+500*r(),course=2*Math.PI*r(),c=o.c??1500;
 const n=o.n??71,dt=o.dt??10,from=o.from??0,to=o.to??Infinity;const noise=mulberry32(deriveSeed(seed,'noise'));
 // Place track so CPA (horizontal) happens at tCpa with range rCpa abeam.
 const ux=Math.sin(course),uy=Math.cos(course),src={x:-ux*speed*tCpa+uy*rCpa,y:-uy*speed*tCpa-ux*rCpa,depth:80,course,speed},rx={x:0,y:0,depth:40,course:0,speed:0};
 const g=createGeometry(),samples:DopplerSample[]=[];
 for(let i=0;i<n;i++){const t=i*dt;if(t<from||t>to)continue;const p={...src,x:src.x+ux*speed*t,y:src.y+uy*speed*t};geometry(p,rx,g);samples.push({tS:t,fHz:doppler(f0,g.sourceRadial,g.receiverRadial,c)+(o.sigmaHz?o.sigmaHz*gaussian(noise):0)});}
 return {truth:{f0,speed,rCpa,tCpa,course},samples};
}
{
 const fs=[0,-5,1,90,1234.5],rad=[-2000,-1485.1,-12,-3.5,0,3.5,12,1485.1,2000],cs=[1500,1480,0.5,1];
 const closed=fs.flatMap(f=>rad.flatMap(sr=>[-7,0,4.25,1600].flatMap(rr=>cs.map(c=>({f,sourceRadial:sr,receiverRadial:rr,c,exact:doppler(f,sr,rr,c),approx:dopplerApprox(f,sr,rr,c)})))));
 const defaults=[{f:90,sourceRadial:5,exact:doppler(90,5),approx:dopplerApprox(90,5)},{f:90,sourceRadial:-5,exact:doppler(90,-5),approx:dopplerApprox(90,-5)}];
 const pinned=Array.from({length:71},(_,i)=>{const tS=i*10,u=tS-350,radial=-64*u/Math.hypot(900,8*u);return {tS,fHz:90*1500/(1500-radial)};});
 type Case={name:string;samples:{tS:number|null;fHz:number|null}[];opts:{c?:number;maxSpeed?:number};truth?:unknown};
 const cases:Case[]=[];
 const add=(name:string,samples:DopplerSample[],opts:{c?:number;maxSpeed?:number}={},truth?:unknown)=>cases.push({name,samples:samples.map(s=>({tS:num(s.tS),fHz:num(s.fHz)})),opts,truth});
 add('pinned-90Hz-8mps-900m',pinned,{},{f0:90,speed:8,rCpa:900,tCpa:350});
 for(const seed of [11,22,33,44,55])add(`seeded-${seed}-clean`,seededPass(seed).samples,{},seededPass(seed).truth);
 for(const [seed,sig] of [[66,.01],[77,.05],[88,.2]] as const)add(`seeded-${seed}-noise-${sig}Hz`,seededPass(seed,{sigmaHz:sig}).samples,{},seededPass(seed).truth);
 add('seeded-99-approach-only',seededPass(99,{to:250}).samples,{},seededPass(99).truth);
 add('seeded-101-recede-only',seededPass(101,{from:450}).samples,{},seededPass(101).truth);
 add('seeded-202-sparse-6',seededPass(202,{n:6,dt:120}).samples,{},seededPass(202).truth);
 add('seeded-303-c1480',seededPass(303,{c:1480}).samples,{c:1480},seededPass(303,{c:1480}).truth);
 add('maxSpeed-too-low',pinned,{maxSpeed:5});
 add('degenerate-4-samples',pinned.slice(0,4));
 add('degenerate-empty',[]);
 add('degenerate-constant-f',pinned.map(s=>({...s,fHz:90})));
 add('degenerate-zero-span',pinned.slice(0,8).map(s=>({...s,tS:100})));
 add('degenerate-nan-sample',pinned.map((s,i)=>i===10?{...s,fHz:NaN}:s));
 add('degenerate-nonpositive-f',pinned.map((s,i)=>i===3?{...s,fHz:0}:s));
 add('degenerate-bad-c',pinned,{c:-1});
 add('degenerate-noise-only',Array.from({length:40},(_,i)=>{const r=mulberry32(4242+i);return {tS:i*5,fHz:100+2*(r()-.5)};}));
 const fits=cases.map(cs=>({...cs,expected:fitOut(fitCpaFromDoppler(cs.samples.map(s=>({tS:s.tS??NaN,fHz:s.fHz??NaN})),cs.opts))}));
 write('doppler.json',{closedForm:closed,defaults,fits});

 // ---------- 1c. Lloyd's mirror: closed form + spacing fitter (lloydsMirror.ts, fitLloydsMirror.ts) ----------
 const grid=[0,1,50,333.3,900,5000].flatMap(r=>[[0,40],[2.5,40],[80,40],[150,60],[40,40]].flatMap(([zs,zr])=>[12,90,400.5].flatMap(f=>[0,.12,.5].map(sigma=>({f,r,zs,zr,c:1500,sigma,
  pathDifference:pathDifference(r,zs,zr),exactGain:exactGain(f,r,zs,zr,1500,sigma),interferenceGain:interferenceGain(f,r,zs,zr,1500),farFieldGain:farFieldGain(f,r,zs,zr,1500)})))));
 const extra=[{f:90,r:-10,zs:-3,zr:40,c:0.2,sigma:0,pathDifference:pathDifference(-10,-3,40),exactGain:exactGain(90,-10,-3,40,0.2,0),interferenceGain:interferenceGain(90,-10,-3,40,0.2),farFieldGain:farFieldGain(90,-10,-3,40,0.2)}];
 const nulls=[[90,80,40,1],[90,80,40,3],[250,150,60,2],[40,10,40,0]].map(([f,zs,zr,n])=>({f,zs,zr,n,c:1500,nullRange:nullRange(f,zs,zr,n,1500)}));
 const spacings=[[0,80,40],[900,80,40],[5000,150,60],[100,0,0]].map(([r,zs,zr])=>({r,zs,zr,c:1500,nullSpacing:nullSpacing(r,zs,zr,1500)}));
 const sigmas=[-1,0,.4,.6,1,2.5,3,6,9].map(s=>({seaState:s,value:seaSurfaceSigma(s)}));
 const cpa=fitCpaFromDoppler(pinned);
 const spacing=(rCpa:number,v:number,tCpa:number,zs:number,zr:number,ts:number[],noise=0,seed=1)=>{const r=mulberry32(seed);return ts.map(t=>({simT:t,spacingHz:1500*rCpa/(2*zs*zr)*Math.hypot(1,v*(t-tCpa)/rCpa)+(noise?noise*gaussian(r):0)}));};
 const T=Array.from({length:71},(_,i)=>i*10),T21=Array.from({length:21},(_,i)=>i*10);
 type LCase={name:string;samples:{simT:number|null;spacingHz:number|null}[];opts:{zr?:number;c?:number;basis?:{kind:'manual'|'cpaFit';rCPA:number;speed:number;tCPA?:number|null}|null}};
 const lc:LCase[]=[];
 const ladd=(name:string,samples:{simT:number;spacingHz:number}[],opts:LCase['opts'])=>lc.push({name,samples:samples.map(s=>({simT:num(s.simT),spacingHz:num(s.spacingHz)})),opts});
 const base=spacing(900,8,350,80,40,T);
 ladd('none-basis-relative',base,{zr:40});
 ladd('manual-basis',base,{zr:40,basis:{kind:'manual',rCPA:900,speed:8,tCPA:350}});
 ladd('cpaFit-basis-from-doppler',base,{zr:40,basis:{kind:'cpaFit',rCPA:cpa.rCPA,speed:cpa.speed,tCPA:cpa.tCPA}});
 ladd('manual-no-tCPA',base,{zr:40,basis:{kind:'manual',rCPA:900,speed:8}});
 ladd('demon-21-none',spacing(1000,8,100,80,40,T21),{zr:40});
 ladd('demon-21-manual',spacing(1000,8,100,80,40,T21),{zr:40,basis:{kind:'manual',rCPA:1000,speed:8,tCPA:100}});
 ladd('noisy-0.5Hz-none',spacing(1500,6,300,120,60,T,.5,7),{zr:60});
 ladd('noisy-2Hz-manual',spacing(1500,6,300,120,60,T,2,8),{zr:60,c:1490,basis:{kind:'manual',rCPA:1500,speed:6,tCPA:300}});
 ladd('one-sided-none',spacing(900,8,350,80,40,T.filter(t=>t<300)),{zr:40});
 ladd('default-zr-c',base,{});
 ladd('speed-zero-manual',spacing(900,0,350,80,40,T),{zr:40,basis:{kind:'manual',rCPA:900,speed:0,tCPA:350}});
 ladd('degenerate-2-samples',base.slice(0,2),{zr:40});
 ladd('degenerate-nan',base.map((s,i)=>i===5?{...s,spacingHz:NaN}:s),{zr:40});
 ladd('degenerate-zero-spacing',base.map((s,i)=>i===5?{...s,spacingHz:0}:s),{zr:40});
 ladd('degenerate-bad-zr',base,{zr:0});
 ladd('degenerate-bad-c',base,{zr:40,c:-5});
 ladd('degenerate-bad-rCPA',base,{zr:40,basis:{kind:'manual',rCPA:-1,speed:8,tCPA:350}});
 ladd('degenerate-bad-speed',base,{zr:40,basis:{kind:'manual',rCPA:900,speed:-1,tCPA:350}});
 ladd('degenerate-same-time',base.slice(0,6).map(s=>({...s,simT:42})),{zr:40});
 ladd('concave-down-none',T.map(t=>({simT:t,spacingHz:200-((t-350)/100)**2})),{zr:40});
 const lnum=(x:number)=>num(x);
 const lfits=lc.map(cs=>{const opts:LloydFitOptions={...(cs.opts.zr!==undefined?{zr:cs.opts.zr}:{}),...(cs.opts.c!==undefined?{c:cs.opts.c}:{}),...(cs.opts.basis?{basis:{kind:cs.opts.basis.kind,rCPA:cs.opts.basis.rCPA,speed:cs.opts.basis.speed,...(cs.opts.basis.tCPA!=null?{tCPA:cs.opts.basis.tCPA}:{})}}:{})};
  const f=fitLloydsMirror(cs.samples.map(s=>({simT:s.simT??NaN,spacingHz:s.spacingHz??NaN})),opts);
  return {...cs,expected:{ok:f.ok,basis:f.basis,zs:lnum(f.zs),depthRatio:lnum(f.depthRatio),rCPA:lnum(f.rCPA),speed:lnum(f.speed),tCPA:lnum(f.tCPA),residualRms:lnum(f.residualRms)}};});
 write('lloyd.json',{closedForm:[...grid,...extra],nullRange:nulls,nullSpacing:spacings,seaSurfaceSigma:sigmas,fits:lfits});
}

// ---------- 1d. Propagation: Mackenzie, cavitation helpers, TL wrapper, BT/SSP builder ----------
{
 const Ts=[-10,-2,0,4,10,15,25,30,35],Ss=[0,25,30,35,40,45],Ds=[-5,0,100,1000,4000,8000,9000];
 const mackenzie=Ts.flatMap(T=>Ss.flatMap(S=>Ds.map(D=>({T,S,D,soundSpeed:soundSpeed(T,S,D),outOfRange:mackenzieOutOfRange(T,S,D)}))));
 const oorNaN=[[NaN,35,0],[10,NaN,0],[10,35,NaN]].map(([T,S,D])=>({T:num(T),S:num(S),D:num(D),outOfRange:mackenzieOutOfRange(T,S,D)}));
 const thermo=[-10,-2,0,4,15,25,40,60].map(T=>({T,vapourPressurePa:vapourPressurePa(T),densities:[0,20,35,42,50].map(S=>({S,value:seawaterDensity(T,S)}))}));
 const cav=[[4,0],[4,10],[6.5,80],[6.5,300],[10,0],[3,-20]].flatMap(([v0,d])=>[[15,35],[2,34],[28,38]].map(([T,S])=>({surfaceInceptionKn:v0,depthM:d,temperatureC:T,salinityPsu:S,value:cavitationInceptionSpeedKn(v0,.05,d,T,S)})));
 const cavDefaults=[0,50,200].map(d=>({surfaceInceptionKn:5,depthM:d,value:cavitationInceptionSpeedKn(5,0,d)}));
 const tl=[0,1,10,999,1000,1001,5000,60000].flatMap(r=>[0,50,1000,5000].flatMap(f=>(['spherical','cylindrical','hybrid'] as const).flatMap(m=>[1,1000,2500].map(t=>({range:r,f,mode:m,transition:t,value:transmissionLoss(r,f,m,t)})))));
 const tlDefaults=[[1000,100],[30000,1000]].map(([r,f])=>({range:r,f,value:transmissionLoss(r,f)}));
 const reqs=[
  {name:'default-shape',req:{surfaceTempC:22,deepTempC:3,salinityPsu:35,maxDepthM:4500,samples:64}},
  {name:'defaults-only',req:{surfaceTempC:15,deepTempC:7,salinityPsu:35,maxDepthM:400}},
  {name:'custom-mld-thick',req:{surfaceTempC:18,deepTempC:4,salinityPsu:34.5,maxDepthM:2000,mixedLayerDepthM:120,thermoclineThicknessM:300,samples:41}},
  {name:'shallow-clamps',req:{surfaceTempC:12,deepTempC:10,salinityPsu:33,maxDepthM:5,mixedLayerDepthM:50,thermoclineThicknessM:500,samples:3}},
  {name:'out-of-range-all',req:{surfaceTempC:35,deepTempC:-5,salinityPsu:45,maxDepthM:9000,samples:900}},
  {name:'deep-warmer-than-surface',req:{surfaceTempC:5,deepTempC:12,salinityPsu:20,maxDepthM:1000,samples:16.7}},
 ];
 const columns=reqs.map(({name,req})=>{const p=buildWaterColumn(req);return {name,req,expected:{depthM:Array.from(p.depthM),temperatureC:Array.from(p.temperatureC),soundSpeedMps:Array.from(p.soundSpeedMps),mixedLayerDepthM:p.mixedLayerDepthM,thermoclineBaseM:p.thermoclineBaseM,salinityPsu:p.salinityPsu,outOfRange:p.outOfRange}};});
 write('propagation.json',{mackenzie,mackenzieNaN:oorNaN,thermo,cavitation:cav,cavitationDefaults:cavDefaults,transmissionLoss:tl,transmissionLossDefaults:tlDefaults,waterColumns:columns});
}

// ---------- 1e. Striation curves (striationCurves.ts) ----------
{
 const tS=[0,60,120.5,240,299.75,300,301,450,600,900,1e308,NaN];
 const P:any[]=[
  {name:'abs-default-c',p:{rCPA:2000,speed:5,tCPA:300,zs:80,zr:60}},
  {name:'abs-c1490',p:{rCPA:1200,speed:7.5,tCPA:450,zs:35,zr:120,c:1490}},
  {name:'abs-zero-range-speed',p:{rCPA:0,speed:0,tCPA:0,zs:50,zr:50}},
  {name:'abs-overflow-nan',p:{rCPA:5e30,speed:1,tCPA:0,zs:1e-10,zr:1e-10}},
  {name:'rel',p:{basis:'none',depthRatio:25,speedOverRange:.0025,tCPA:300,zr:60}},
  {name:'rel-c1510-static',p:{basis:'none',depthRatio:4,speedOverRange:0,tCPA:-10,zr:15,c:1510}},
  {name:'bad-zs0',p:{rCPA:2000,speed:5,tCPA:300,zs:0,zr:60}},
  {name:'bad-zr-neg',p:{rCPA:2000,speed:5,tCPA:300,zs:80,zr:-1}},
  {name:'bad-c0',p:{rCPA:2000,speed:5,tCPA:300,zs:80,zr:60,c:0}},
  {name:'bad-speed-neg',p:{rCPA:2000,speed:-1,tCPA:300,zs:80,zr:60}},
  {name:'bad-rel-basis',p:{basis:'meters',depthRatio:25,speedOverRange:.0025,tCPA:300,zr:60}},
  {name:'bad-rel-ratio0',p:{basis:'none',depthRatio:0,speedOverRange:.0025,tCPA:300,zr:60}},
  {name:'bad-rel-sor-neg',p:{basis:'none',depthRatio:25,speedOverRange:-1e-3,tCPA:300,zr:60}},
  {name:'null-params',p:null},
 ];
 const cases=P.flatMap(({name,p})=>[0,1,4,7].map(nMax=>{const out=new Float32Array(nMax*tS.length);striationCurves(p,nMax,tS,out);return {name,params:p,nMax,out:Array.from(out,num)};}));
 const throwsCase=(nMax:number,outLen:number)=>{try{striationCurves({rCPA:1,speed:1,tCPA:0,zs:1,zr:1},nMax,tS,new Float32Array(outLen));return false;}catch(e){return e instanceof RangeError;}};
 const throwCases=[[-1,100],[3,35],[3,36],[0,0]].map(([nMax,outLen])=>({nMax,outLen,throws:throwsCase(nMax,outLen)}));
 write('striation.json',{tS:tS.map(num),cases,throws:throwCases});
}

// ---------- 1f. Lloyd pass qualifier (lloydPass.ts) ----------
{
 const truthOut=(t:ReturnType<typeof lloydPassQualifier>)=>({symmetricPass:t.symmetricPass,reasons:[...t.reasons],zsM:t.zsM,zrM:t.zrM,rangeM:t.rangeM,nullSpacingHz:num(t.nullSpacingHz),pathDifferenceM:num(t.pathDifferenceM)});
 const D=Math.PI/180,TAU=2*Math.PI;
 const pairs:[string,LloydPassSample,LloydPassSample][]=[
  ['identical',{depthM:80,courseRad:1,speedMps:5},{depthM:80,courseRad:1,speedMps:5}],
  ['depth-at-eps',{depthM:80,courseRad:1,speedMps:5},{depthM:80.05,courseRad:1,speedMps:5}],
  ['depth-over-eps',{depthM:80,courseRad:1,speedMps:5},{depthM:80.0501,courseRad:1,speedMps:5}],
  ['course-wrap-small',{depthM:80,courseRad:TAU-.2*D,speedMps:5},{depthM:80,courseRad:.2*D,speedMps:5}],
  ['course-wrap-large',{depthM:80,courseRad:TAU-.3*D,speedMps:5},{depthM:80,courseRad:.3*D,speedMps:5}],
  ['course-pi',{depthM:80,courseRad:0,speedMps:5},{depthM:80,courseRad:Math.PI,speedMps:5}],
  ['course-negative',{depthM:80,courseRad:-3*TAU+.1,speedMps:5},{depthM:80,courseRad:.1+.4*D,speedMps:5}],
  ['speed-over',{depthM:80,courseRad:1,speedMps:5},{depthM:80,courseRad:1,speedMps:4.9}],
  ['all-three',{depthM:80,courseRad:1,speedMps:5},{depthM:60,courseRad:2,speedMps:8}],
 ];
 const geoms=[[80,60,2000,undefined],[35,120,500,1490],[-5,60,-10,undefined],[0,0,0,undefined],[80,60,1e6,1520]];
 const qualifier=pairs.flatMap(([name,a,b])=>geoms.map(([zs,zr,r,c])=>({name,start:a,now:b,zsM:zs,zrM:zr,rangeM:r,c:c??null,expected:truthOut(lloydPassQualifier(a,b,zs!,zr!,r!,c))})));
 // Tracker sequences: reasons accumulate in first-seen order and never clear.
 const rng=mulberry32(4242);
 const seqs=Array.from({length:12},(_,k)=>{
  const start={depthM:20+rng()*200,courseRad:(rng()-.5)*4*Math.PI,speedMps:rng()*10};
  const obs=Array.from({length:6+k},()=>({depthM:start.depthM+(rng()-.5)*(k%3===0?.08:.3),courseRad:start.courseRad+(rng()-.5)*(k%4===0?.01:.05)+(k%5===0?TAU:0),speedMps:start.speedMps+(rng()-.5)*(k%2?.06:.2)}));
  const t=new LloydPassTracker(start);const reasonsAfter=obs.map(o=>{t.observe(o);return [...t.asymmetryReasons];});
  const zs=start.depthM,zr=10+rng()*150,r=rng()*20000;
  return {start,observations:obs,reasonsAfter,zsM:zs,zrM:zr,rangeM:r,expected:truthOut(t.truth(zs,zr,r))};
 });
 write('lloydPass.json',{qualifier,sequences:seqs});
}

// ---------- 2. Starter cuts: real engine path ----------
const CUTS=[
 {id:'cut-cinderlilt-cav',rows:[0,1,120,480,960,1199]},
 {id:'cut-brindleflux-snork',rows:[0,200,600,1100]},
 {id:'cut-morrowcoil-hydp-masked',rows:[0,359,361,370,900]},
];
for(const cut of CUTS){
 const s=renderCut(cut.id) as any;const g=s.engine.generators[0]??null;
 // The cut LOFAR stream may be a band-cached generator; register every generator lazily.
 const buf=new Float32Array(2048);const rows=new Set(cut.rows),out:Snapshot[]=[];
 const reg=(gen:any)=>{if(!want.has(gen))want.set(gen,{rows,out});};
 // Discover instances: first write registers whichever generator serves the stream.
 const seen=new Set<any>();const probe=LofarGenerator.prototype.generate;
 LofarGenerator.prototype.generate=function(this:any,o?:Float32Array,f?:number){if(!seen.has(this)){seen.add(this);if(this.bins===2048&&this.fmax===2000)reg(this);}return probe.call(this,o,f);};
 const max=Math.max(...cut.rows);let gen:any=null;
 for(let i=0;i<=max;i++){if(s.writeLofarRow(buf)<0)break;}
 LofarGenerator.prototype.generate=probe;
 for(const x of seen)if(want.get(x)?.out===out)gen=x;
 if(!gen)throw new Error(`no generator for ${cut.id}`);
 const seed=s.engine.scenario.seed as number;
 if(gen.baseSeed!==deriveSeed(seed,`buoy:${gen.buoy.id}`))throw new Error('seed mismatch');
 void g;
 write(`cut-${cut.id.replace(/^cut-/,'')}.json`,{...header(gen,seed,cut.id,'cut',`Starter cut ${cut.id} via CutSession (DIFAR, 2048 bins, 0-2000 Hz).`),rows:out});
 want.delete(gen);
}

// ---------- 3. Synthetic cases ----------
const env0:Environment={seaState:0,shipping:'light',soundSpeed:1500,spreading:'spherical',transition:1000};
const buoy=(type:'difar'|'passive-omni',depth=60):Buoy=>({id:'buoy-1',type,x:0,y:0,depth,course:0,speed:0,rfChannel:1,deployedAt:0,life:7200});
const line=(hz:number,power:number,width:'discrete'|'diffuse'='discrete',sigmaBins?:number):TonalLine=>({family:width==='diffuse'?'blade':'gear',hz,power,width,...(sigmaBins?{sigmaBins}:{})});
function contact(id:string,o:Partial<Contact>&{params:Contact['params']}):Contact{return {id,x:-3000,y:400,depth:80,course:Math.PI/2,speed:knotsToMps(8),motion:[{at:0,course:Math.PI/2,speed:knotsToMps(8),depth:80}],...o} as Contact;}
const base={label:'Fictional',shaftHz:2,blades:5,tonalHz:90,levelDb:125,modulation:.3};
function synth(name:string,note:string,b:Buoy,contacts:Contact[],bins:number,fmax:number,seed:number,env:Environment,f0:number,rows:number[],dt=1,wc?:ReturnType<typeof buildWaterColumn>,mutate?:(t:number,cs:Contact[])=>void){
 const gen=new LofarGenerator(b,contacts,bins,fmax,seed,env,f0);if(wc)gen.setWaterColumn(wc);
 const out:Snapshot[]=[];want.set(gen,{rows:new Set(rows),out});
 const max=Math.max(...rows);
 for(let i=0;i<=max;i++){gen.generate();for(const c of contacts)advance(c,dt);mutate?.(i*dt,contacts);}
 want.delete(gen);write(`synth-${name}.json`,{...header(gen,seed,name,'synthetic',note),rows:out});return gen;
}
synth('single-tonal','One discrete tonal, absolute tonalRefDb, omni, sea state 0 (hot path).',buoy('passive-omni'),
 [contact('fictional-a',{params:{...base,tonals:[line(120,1)],tonalRefDb:130}})],1024,500,1001,env0,0,[0,1,2,50,300]);
synth('tonal-harmonics','Default sourceLines (shaft, blade-diffuse, motor harmonics), relative powers, DIFAR, sea state 2.',buoy('difar'),
 [contact('fictional-b',{params:{...base}})],1024,500,2002,{...env0,seaState:2,shipping:'moderate'},0,[0,10,200,400],1);
synth('broadband-only','No tonals; cavitation + flow noise, hybrid spreading, sea state 4, heavy shipping.',buoy('passive-omni',100),
 [contact('fictional-c',{speed:knotsToMps(18),params:{...base,tonals:[],cavitationPower:.02,flowNoiseDb:60,flowRadiatedFraction:.3}})],512,1000,3003,{...env0,seaState:4,shipping:'heavy',spreading:'hybrid',transition:2000},0,[0,5,100]);
{
 const wc=buildWaterColumn({surfaceTempC:22,deepTempC:3,salinityPsu:35,maxDepthM:4500,samples:64});
 synth('cz-swath-band','f0=100 Hz band, CZ enabled at ~60 km, SWATH + snort/wave-slap broadband, DIFAR.',buoy('difar',90),
  [contact('fictional-d',{x:-60500,y:2000,depth:80,params:{...base,tonals:[line(140,1),line(280,.4),line(333,.2,'diffuse',3)],tonalRefDb:150,
   speedGated:[{name:'SW1',kind:'SWATH',loHz:180,hiHz:260,active:true,gain:.8}],
   stateBroadband:{snort:{active:true,level:.7,loHz:40,hiHz:420},waveSlap:{active:true,level:.5,loHz:20,hiHz:280}} as any}})],
  800,600,4004,{...env0,seaState:1,propagation:{czEnabled:true}},100,[0,30,90],1,wc);
}
function many(n:number){const cs:Contact[]=[];for(let i=0;i<n;i++){const tonals=Array.from({length:12},(_,k)=>line(30+i*7.3+k*(41+i),10**(-k*.15),k%4===3?'diffuse':'discrete',k%4===3?2+(k%3):undefined));
 cs.push(contact(`fictional-m${i}`,{x:(i%8-4)*2500+300,y:(Math.floor(i/8)-2)*3100-200,depth:20+9*i,course:i*.61,speed:knotsToMps(3+i%11),params:{...base,tonals,tonalRefDb:120+i%9,cavitationPower:i%5===0?.01:0,draughtSurfacedM:5+i%4}}));}return cs;}
const manyEnv:Environment={...env0,seaState:3,shipping:'moderate',shippingDensity:.5,soundSpeed:1505};
synth('many-32','32 contacts x 12 lines (discrete+diffuse), DIFAR, 2048 bins 0-2000 Hz, sea state 3.',buoy('difar'),many(32),2048,2000,5005,manyEnv,0,[0,60,240]);

// ---------- 5. RES / FULLBAND (res.ts, resGram.ts ResLofarGenerator) ----------
// Fixture boundary: every ResLofarGenerator call the engine makes (construct/configure/prepareFullAxis/
// selectTile/render…) in global order, the StateHistory frames the generator actually loads
// (delta-encoded), and each rendered row (full Float32 rows for the first few per generator, else
// FNV-1a hash of row+bearing bits plus every 64th bin). Swift replays the log against a shared scratch.
{
 // 5a. res.ts scalars.
 const levels=[1,2,3,4,5,6,7,8,9] as const;
 const params=levels.map(r=>resParams(r));
 const bands=levels.flatMap(r=>[undefined,0,16,250,999.9,1500,5000].flatMap(v=>[500,2000].map(fmax=>({res:r,vernierHz:v??null,fmax,band:resBand(r,v,fmax)}))));
 const tiles=[1,2,5,7].flatMap(r=>[[2000,4096],[2000,1000],[500,4096],[1000,512]].flatMap(([fmax,tb])=>{const n=tileCountFor(fmax!,resParams(r).fBin,tb);return Array.from({length:n},(_,i)=>({res:r,fmax,tileBins:tb,tileIndex:i,band:tileBand(r,i,fmax!,tb)}));}));
 const tileIdx=[[0,.0625,4096,8],[255.99,.0625,4096,8],[256,.0625,4096,8],[1e6,.0625,4096,8],[1999,.5,4096,undefined],[33.3,2,512,undefined]].map(([hz,fb,tb,tc])=>({hz,fBin:fb,tileBins:tb,tileCount:tc??null,value:tileIndexForHz(hz!,fb!,tb,tc)}));
 const prio=[[0,1],[0,8],[3,8],[7,8],[9,8],[-2,4],[2,3]].map(([v,n])=>({visible:v,count:n,order:priorityTileOrder(v!,n!)}));
 const gp=[[1,.5],[1,2.5],[2,5],[2.5,6.25],[4.4,11],[10,25],[64,160],[64,10],[.5,.1]].map(([a,x])=>({a,x,value:gammaP(a!,x!)}));
 const bias=[2,4,4.81,8,30,100].map(e=>({edof:e,value:tpswBias(e)}));
 const gam=[1,2,2.4,8,30].map(sh=>{const r=mulberry32(777+Math.round(sh*10));return {shape:sh,seed:777+Math.round(sh*10),values:Array.from({length:64},()=>gammaUnit(r,sh))};});
 write('res.json',{params,bands,tiles,tileIndexForHz:tileIdx,priorityTileOrder:prio,gammaP:gp,tpswBias:bias,gammaUnit:gam,hannOverlap:[...HANN_OVERLAP_AMPLITUDE],welch:[1,2,4,8,16].map(k=>({k,edof:welchEdof(k),rowCorrelation:welchRowCorrelation(k)}))});
}
function resSession(name:string,note:string,seed:number,setup:()=>{engine:any;drive:()=>void;dispose:()=>void},fullRowsPerGen=2){
 setTileAccumBudget(Math.floor(3.2*1024*1024));
 const P=ResLofarGenerator.prototype as any,orig:Record<string,any>={};
 const gens=new Map<any,number>(),events:any[]=[],frames=new Map<number,{t:number;data:Float64Array;buoys:Map<string,number[]>}>();let depth=0,histUid=-1;const fullCount=new Map<number,number>();
 const statics=(g:any)=>({buoy:{id:g.buoy.id,type:g.buoy.type,x:g.buoy.x,y:g.buoy.y,depth:g.buoy.depth,course:g.buoy.course,speed:g.buoy.speed},fmax:g.fmax,capacity:g.capacity,baseSeed:g.baseSeed,bearingSeed:g.bearingSeed,environment:{...g.environment},
  contacts:g.contacts.map((c:any)=>({id:c.contact.id,gain:c.gain,lines:c.frequencies.length,sigmaHz:Array.from(c.sigmaHz),swaths:c.swaths.length,draughtSurfacedM:c.contact.params.draughtSurfacedM??null,absTonals:c.contact.params.tonalRefDb!==undefined}))});
 const idOf=(g:any)=>{let i=gens.get(g);if(i===undefined){i=gens.size;gens.set(g,i);events.push({gen:i,op:'new',...statics(g)});}return i;};
 const wrap=(name:string,rec:(g:any,args:any[])=>any|null)=>{orig[name]=P[name];P[name]=function(this:any,...args:any[]){const top=depth===0;if(top){const e=rec(this,args);if(e)events.push(e);}depth++;try{return orig[name].apply(this,args);}finally{depth--;}};};
 wrap('configure',(g,a)=>{const fresh=!gens.has(g);const i=idOf(g);return fresh?{gen:i,op:'configure',settings:{...a[0]}}:{gen:i,op:'configure',settings:{...a[0]}};});
 wrap('prepareFullAxis',(g,a)=>({gen:idOf(g),op:'prepareFullAxis',tileCount:a[0]}));
 wrap('selectTile',(g,a)=>({gen:idOf(g),op:'selectTile',tileIndex:a[0],tileBins:a[1]??4096}));
 wrap('setHistory',(g,a)=>{if(a[0])histUid=a[0].uid;return {gen:idOf(g),op:'setHistory',on:!!a[0]};});
 wrap('setEnvironment',(g,a)=>({gen:idOf(g),op:'setEnvironment',environment:{...a[0]}}));
 wrap('setWaterColumn',(g,a)=>({gen:idOf(g),op:'setWaterColumn',profile:a[0]?{depthM:Array.from(a[0].depthM),soundSpeedMps:Array.from(a[0].soundSpeedMps)}:null}));
 wrap('dispose',(g)=>({gen:idOf(g),op:'dispose'}));
 // Frame capture (not an event).
 orig.loadFrame=P.loadFrame;P.loadFrame=function(this:any,sl:number){const h=this.history,t=h.t[sl],k=Math.round(t/RES_FRAME_S);let fr=frames.get(k);const d=h.data.subarray(sl*h.stride,(sl+1)*h.stride);
  if(!fr){fr={t,data:Float64Array.from(d),buoys:new Map()};frames.set(k,fr);}else{for(let i=0;i<d.length;i++)if(!Object.is(d[i],fr.data[i]))throw new Error(`frame ${k} mutated`);}
  const bk=this.buoy.id as string,br=Array.from(this.buoyRing.subarray(sl*5,sl*5+5));const ob=fr.buoys.get(bk);if(ob){if(ob.some((v,i)=>!Object.is(v,br[i])))throw new Error('buoy frame mutated');}else fr.buoys.set(bk,br);
  return orig.loadFrame.call(this,sl);};
 let live:any=null;orig.loadLive=P.loadLive;P.loadLive=function(this:any){orig.loadLive.call(this);const bt=this.bt;live={buoy:[bt.x,bt.y,bt.depth,bt.course,bt.speed],contacts:this.contacts.map((it:any)=>({act:it.act,trk:[it.trk.x,it.trk.y,it.trk.depth,it.trk.course,it.trk.speed],srcDb:it.srcDb,flowDb:num(it.flowDb),flowFrac:it.flowFrac,cav:it.cav,freq:Array.from(it.frequencies,num),pow:Array.from(it.powers),swG:Array.from(it.swG),swLo:Array.from(it.swLo),swHi:Array.from(it.swHi)}))};};
 let accumRes:any='none',histCalls=0;
 orig.integrateAccum=P.integrateAccum;P.integrateAccum=function(this:any,t:number){const r=orig.integrateAccum.call(this,t);accumRes=r===null?'null':r;return r;};
 orig.integrateHistory=P.integrateHistory;P.integrateHistory=function(this:any,t:number,fast?:boolean){histCalls++;return orig.integrateHistory.call(this,t,fast);};
 orig.render=P.render;P.render=function(this:any,rowKey:number,out:Float32Array,offset:number,perTile:boolean,tEnd?:number){
  const i=idOf(this),h=this.history;live=null;accumRes='none';histCalls=0;const fb0=this.snapshotFallbacks;
  const r=orig.render.call(this,rowKey,out,offset,perTile,tEnd);
  const W=this.bins,row=out.subarray(offset,offset+W),brg=this.bearingRow.subarray(0,W);
  const nFull=fullCount.get(i)??0,full=nFull<fullRowsPerGen;if(full)fullCount.set(i,nFull+1);
  const samp=(a:Float32Array)=>Array.from({length:Math.ceil(W/64)},(_,k)=>num(a[k*64]!));
  events.push({gen:i,op:'render',rowKey,perTile,tEnd:tEnd??null,tileIndex:this.tileIndex,bins:W,f0:this.band.f0,liveBins:this.band.liveBins,
   hist:h?{last:h.last,count:h.count}:null,integrated:this.lastIntegrated,fallback:this.snapshotFallbacks-fb0,accum:accumRes,historyCalls:histCalls,live,
   hash:fnvRow(row,brg),row:full?b64(Float32Array.from(row)):null,bearing:full&&this.difar?b64(Float32Array.from(brg)):null,sample:full?null:samp(row),bearingSample:full||!this.difar?null:samp(brg)});
  return r;};
 let sess:any;try{sess=setup();sess.drive();}finally{for(const k of Object.keys(orig))P[k]=orig[k];}
 sess.dispose();
 // Delta-encode frames in ascending k (first frame full; later frames list changed indices only; NaN → null).
 const ks=[...frames.keys()].sort((a,b)=>a-b);let prev:Float64Array|null=null;
 const fr=ks.map(k=>{const f=frames.get(k)!;let full:string|null=null;
  let idx:string|null=null,val:string|null=null;
  if(!prev)full=b64(f.data);else{const ii:number[]=[],vv:number[]=[];for(let i=0;i<f.data.length;i++)if(!Object.is(f.data[i],prev[i])){ii.push(i);vv.push(f.data[i]!);}idx=b64(Int32Array.from(ii));val=b64(Float64Array.from(vv));}
  prev=f.data;return {k,t:f.t,full,idx,val,buoys:[...f.buoys].map(([b,v])=>({buoy:b,v}))};});
 const renders=events.filter(e=>e.op==='render');
 if(renders.some(e=>e.fallback>0&&e.hist))throw new Error(`${name}: snapshot fallback in a history session`);
 write(`res-${name}.json`,{name,note,seed:sess.engine?sess.engine.scenario.seed:seed,historyUid:histUid,generators:gens.size,events,frames:fr});
 console.log(`res-${name}: ${gens.size} generators, ${renders.length} renders (${renders.filter(e=>e.row).length} full rows), ${fr.length} frames`);
}
const b64=(a:Float32Array|Float64Array|Int32Array)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('base64');
function fnvRow(a:Float32Array,b:Float32Array):number{const u=new Uint32Array(1),f=new Float32Array(u.buffer);let h=0x811c9dc5;
 for(const arr of [a,b])for(let i=0;i<arr.length;i++){f[0]=arr[i]!;let v=Number.isNaN(arr[i]!)?0x7fc00000:u[0]!;for(let s=0;s<4;s++){h^=(v&255);h=Math.imul(h,16777619)>>>0;v>>>=8;}}return h>>>0;}
// 5b. Starter cut: all 8 canonical RES vernier streams (ELF/VLF/LF/MF × NB/BB → RES2/4/5/7) + FULLBAND RES2 NB.
resSession('cut-cinderlilt','Starter cut cut-cinderlilt-cav via CutSession: 8 RES vernier streams (RES2/4/5/7 NB+BB) + FULLBAND RES2 NB (8 tiles, tile-0 budgeted accum, rest span history).',0,()=>{
 const c=renderCut('cut-cinderlilt-cav') as any,e=c.engine;const ids=SIM_STREAM_SET.map((id:any)=>c.openStream(id)).filter((x:any):x is number=>typeof x==='number'&&x!==c.demonStreamId);
 ids.push(e.subscribe({channel:1,kind:'lofar',res:2,filter:'NB',fullAxis:true,visibleTileIndex:1}).streamId);
 const buf=new Float32Array(4096);
 return {engine:e,drive:()=>{while(e.time<9-1e-9){if(c.writeLofarRow(buf)<0)break;for(const id of ids)while(e.rowsReady(id)>0)e.writeRow(id,buf);}},dispose:()=>c.dispose()};
},1);
// 5c. Second cut: LF/MF NB+BB vernier + FULLBAND RES5 BB (1 tile, q=3 DIFAR accum).
resSession('cut-brindleflux','Starter cut cut-brindleflux-snork: LF/MF RES vernier NB+BB + FULLBAND RES5 BB (single tile, DIFAR q=3 accum).',0,()=>{
 const c=renderCut('cut-brindleflux-snork') as any,e=c.engine;const ids=(['lofar/LF/NB','lofar/LF/BB','lofar/MF/NB','lofar/MF/BB'] as any[]).map(id=>c.openStream(id)).filter((x:any)=>typeof x==='number');
 ids.push(e.subscribe({channel:1,kind:'lofar',res:5,filter:'BB',fullAxis:true}).streamId);
 const buf=new Float32Array(4096);
 return {engine:e,drive:()=>{while(e.time<6.5-1e-9){if(c.writeLofarRow(buf)<0)break;for(const id of ids)while(e.rowsReady(id)>0)e.writeRow(id,buf);}},dispose:()=>c.dispose()};
});
// 5d. Synthetic 32 contacts (same contact set as synth-many-32): RES5 NB vernier, RES5 BB FULLBAND, RES2 NB FULLBAND (8 tiles).
function manyEngine(seed:number){const s=cpaScenario();s.seed=seed;s.fmax=2000;s.environment={...manyEnv};s.contacts=many(32);return new AcousticEngine(s,seed) as any;}
resSession('many-32','32 contacts x 12 lines, DIFAR, fmax 2000: RES5 NB vernier @600 Hz, RES5 BB FULLBAND, RES3 NB FULLBAND (4 tiles: tile 0 budgeted accum, tiles 1-3 span history).',5005,()=>{
 const e=manyEngine(5005);const ids=[e.subscribe({channel:1,kind:'lofar',res:5,filter:'NB',vernierHz:600}).streamId,e.subscribe({channel:1,kind:'lofar',res:5,filter:'BB',fullAxis:true}).streamId,e.subscribe({channel:1,kind:'lofar',res:3,filter:'NB',fullAxis:true,visibleTileIndex:0}).streamId];
 const buf=new Float32Array(4096);
 return {engine:e,drive:()=>{for(let t=0;t<7;t+=RES_FRAME_S){e.advance(RES_FRAME_S);for(const id of ids)while(e.rowsReady(id)>0)e.writeRow(id,buf);}},dispose:()=>{}};
},1);
// 5e. Direct generator without history (explicit snapshot fallback, live state): vernier RES3 and FULLBAND tiles RES6.
resSession('direct-snapshot','No StateHistory: generate() RES3 NB (AR(1) K=1) + renderTile RES4 BB tiles 0..1 (K=2 gamma) — explicit snapshot fallback path from live contact state.',777,()=>{
 const cs=many(4),env={...manyEnv,seaState:0};
 const g=new ResLofarGenerator({id:'buoy-9',type:'difar',x:100,y:-50,depth:55,course:0,speed:0,rfChannel:9,deployedAt:0,life:7200} as any,cs,2000,777,env,{res:3,filter:'NB',vernierHz:150});
 const t=new ResLofarGenerator({id:'buoy-8',type:'passive-omni',x:0,y:0,depth:30,course:0,speed:0,rfChannel:8,deployedAt:0,life:7200} as any,cs,2000,777,{...env,seaState:2},{res:4,filter:'BB'},4096);
 return {engine:null,drive:()=>{for(let r=0;r<3;r++){g.generate();t.renderTile(0,r);t.renderTile(1,r);for(const c of cs)advance(c,1);}},dispose:()=>{g.dispose();t.dispose();}};
},3);
// ---------- 6. V8 libm goldens (fdlibm sin/cos/atan2/log10/tanh/exp/log; pow; toFixed) ----------
{const r=mulberry32(99),N=4000,xs:number[]=[];for(let i=0;i<N;i++){const u=r();xs.push(i%4===0?(u-.5)*14:i%4===1?(u-.5)*1e3:i%4===2?u*7:(u-.5)*.02);}
 const pos=xs.map(x=>Math.abs(x)+1e-9),b=(a:number[])=>Buffer.from(Float64Array.from(a).buffer).toString('base64');
 const jm={note:'V8 Math.* bit patterns (base64 f64) for the fdlibm ports in FdlibmMath.swift',xs:b(xs),pos:b(pos),sin:b(xs.map(Math.sin)),cos:b(xs.map(Math.cos)),tanh:b(xs.map(Math.tanh)),log10:b(pos.map(Math.log10)),
  atan2:b(xs.map((x,i)=>Math.atan2(x,xs[(i+7)%N]))),exp:b(xs.map(x=>Math.exp(x/50))),log:b(pos.map(Math.log)),pow10:b(xs.map(x=>10**(x/10))),powa:b(pos.map((p,i)=>p**(xs[(i+1)%N]/50))),
  fix3:b(xs.map(x=>Number(x.toFixed(3)))),fix2:b(xs.map(x=>Number(x.toFixed(2)))),fixTies:b([0.0625,0.125,0.375,1.0625,2.5,0.5,1.5,-0.0625,1.005,0.045].map(x=>Number(x.toFixed(x===2.5||x===0.5||x===1.5?0:x===1.005||x===0.045?2:3))))};write('jsmath.json',jm);
 goldenLibm.jsmath={n:N,seed:99,...Object.fromEntries(Object.entries(jm).filter(([k])=>k!=='note').map(([k,v])=>[k,fnvBytes(new Uint8Array(Buffer.from(v as string,'base64')))]))};}

// ---------- 7. End-to-end seeded runs (scenario stepping + source model + history + all streams) ----------
// Library resources: catalog (effective params per class x variant, so Swift needs no override merging)
// and the starter/scenario cut seeds. Fixtures: per-step contact-state hash, full states at steps 1, 2, every 1200
// steps, per-row hashes for every stream and a few full rows.
const RES_OUT=join(OUT,'../Sources/DatumAcoustics/Resources');mkdirSync(RES_OUT,{recursive:true});
{const classes=catalog.classes.map(k=>({id:k.id,name:k.name,plant:k.plant,aip:!!k.aip,drivetrainCode:k.drivetrainCode,quietingTier:k.quietingTier,snorkelDepthM:k.snorkelDepthM,
  hulls:k.hulls.map(h=>({id:h.id,number:h.number})),params:Object.fromEntries([['',effectiveParams(k)],...k.variants.map(v=>[v.id,effectiveParams(k,v.id)])])}));
 writeFileSync(join(RES_OUT,'catalog.json'),JSON.stringify({note:'Fictional catalog (generated by acoustics/scripts/exportSwiftFixtures.ts; do not edit). params[variantId] = effectiveParams(class, variant); "" = no variant.',classes}));
 writeFileSync(join(RES_OUT,'cuts.json'),JSON.stringify({note:'Fictional cut seeds (generated; do not edit).',starter:STARTER_CUTS,scenario:SCENARIO_CUTS}));}
const E2E=join(GEN,'e2e');mkdirSync(E2E,{recursive:true});
function fnv32(h:number,dv:DataView,n:number){for(let i=0;i<n;i++){h^=dv.getUint8(i);h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
const hb=new DataView(new ArrayBuffer(8));
function hashF64(h:number,x:number){hb.setFloat64(0,Number.isNaN(x)?NaN:x,true);return fnv32(h,hb,8);}
const opt=(x:number|undefined)=>x===undefined?NaN:x;
/** Canonical contact-state vector (mirrored by Swift SimContact.stateVector). */
function stateVec(c:any):number[]{const p=c.params,v=[c.active===false?0:1,c.x,c.y,c.depth,c.course,c.speed,p.levelDb,opt(p.tonalRefDb),opt(p.cavitationPower),opt(p.flowNoiseDb),opt(p.flowRadiatedFraction),p.shaftHz,p.blades,p.tonalHz,p.modulation,opt(p.inceptionKn),opt(p.plantRpmScale)];
 const lines=c.lines??[];v.push(lines.length);for(const l of lines)v.push(l.hz,opt(l.frequencyHz),l.power,opt(l.sigmaBins),l.width==='diffuse'?1:0,l.stability==='unstable'?1:0,opt(l.harmonic));
 const sw=contactSwaths(c);v.push(sw.length);for(const w of sw)v.push(w.gain,w.loHz,w.hiHz);
 const sb=p.stateBroadband;if(sb)v.push(1,sb.snort.active?1:0,sb.snort.level,sb.waveSlap.active?1:0,sb.waveSlap.level);else v.push(0);
 const t=p.propulsion;if(t){v.push(t.shafts.length);for(const sh of t.shafts)v.push(sh.rpm,sh.coupled?1:0);v.push(t.engines.length);for(const e of t.engines)v.push(e.erpm,e.running?1:0);}else v.push(-1);
 return v;}
function stateHash(eng:any):number{let h=0x811c9dc5;for(const c of eng.allContacts)for(const x of stateVec(c))h=hashF64(h,x);for(const b of eng.scenario.buoys)for(const x of [b.x,b.y,b.depth])h=hashF64(h,x);return h;}
const f32b=(a:Float32Array)=>Buffer.from(Float32Array.from(a).buffer).toString('base64');
function rowHash(a:Float32Array){const dv=new DataView(a.buffer,a.byteOffset,a.byteLength);let h=0x811c9dc5;for(let i=0;i<a.length;i++){const u=Number.isNaN(a[i])?0x7fc00000:dv.getUint32(i*4,true);h^=u;h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
type StreamSpec={kind:'lofar';channel:number}|{kind:'res';channel:number;res:number;filter:'NB'|'BB';vernierHz?:number;fullAxis?:boolean;visibleTileIndex?:number}|{kind:'demon';buoyId:number;band:[number,number]};
// Golden manifest (committed): every per-step state hash and every row hash, stored as their low 16 bits
// (u16 LE in golden/e2e-hashes.bin) plus a full-strength FNV-1a 32 chain over the 32-bit hashes, checkpointed
// every CHAIN entries, so drift is localised to the step and any mismatch is caught within CHAIN entries.
const CHAIN=256,goldenE2E:any[]=[],golden16:number[]=[];
function packHashes(hs:number[]){const offset=golden16.length;const chain:number[]=[];let h=0x811c9dc5;const b4=new Uint8Array(4);
 for(let i=0;i<hs.length;i++){golden16.push(hs[i]&0xffff);b4[0]=hs[i]&255;b4[1]=(hs[i]>>>8)&255;b4[2]=(hs[i]>>>16)&255;b4[3]=hs[i]>>>24;h=fnvBytes(b4,h);if((i+1)%CHAIN===0||i===hs.length-1)chain.push(h);}
 return {offset,count:hs.length,chain};}
/** Sampled row checksum: full 32-bit hash, f64 sum of finite bins, NaN count. */
function rowSample(i:number,a:Float32Array,hash:number){let sum=0,nan=0;for(let k=0;k<a.length;k++){if(Number.isNaN(a[k]))nan++;else sum+=a[k];}return {i,hash,sum,nan};}
function e2eRun(name:string,note:string,eng:any,specs:StreamSpec[],ids:number[],steps:number,dt:number,after:(()=>void)|null,src:Record<string,unknown>){
 const streams=specs.map((sp,k)=>({spec:sp,id:ids[k],bins:eng.configs().find((c:any)=>c.streamId===ids[k])?.bins??512,hashes:[] as number[],rows:[] as {i:number;t:number;row:string}[],samples:[] as unknown[],buf:null as any}));
 for(const st of streams)st.buf=new Float32Array(st.bins);
 const frameHash:number[]=[],full:{step:number;t:number;contacts:(number|null)[][]}[]=[];
 const t0=performance.now();
 for(let k=1;k<=steps;k++){eng.advance(dt);after?.();frameHash.push(stateHash(eng));
  if(k<=2||k%1200===0||k===steps)full.push({step:k,t:eng.time,contacts:eng.allContacts.map((c:any)=>stateVec(c).map((x:number)=>Number.isNaN(x)?null:x))});
  for(const st of streams){while(eng.rowsReady(st.id)>0){const i=eng.writeRow(st.id,st.buf,0);if(i<0)break;const n=st.hashes.length;st.hashes.push(rowHash(st.buf));if(n<2||n%1000===999){st.rows.push({i:n,t:eng.time,row:f32b(st.buf)});st.samples.push(rowSample(n,st.buf,st.hashes[n]));}}}}
 const ms=performance.now()-t0;
 write(`e2e/${name}.json`,{name,note,...src,dt,steps,contacts:eng.allContacts.length,frameHash,full,streams:streams.map(s=>({spec:s.spec,bins:s.bins,hashes:s.hashes,rows:s.rows})),tsMs:ms});
 goldenE2E.push({name,...src,dt,steps,contacts:eng.allContacts.length,frames:packHashes(frameHash),
  streams:streams.map(s=>({spec:s.spec,bins:s.bins,rows:packHashes(s.hashes),samples:s.samples}))});
 return ms;
}
/** Fresh module-global RES scratch per run (Swift: one ResScratch per engine). */
const resetResScratch=()=>setTileAccumBudget(Math.floor(3.2*1024*1024));
function cutRun(cut:any,specs:StreamSpec[],name:string){
 resetResScratch();const s=new CutSession(cut) as any,eng=s.engine;const ids=[s.lofar.streamId,s.demonStreamId];
 for(const sp of specs.slice(2)){if(sp.kind!=='res')throw new Error('cut extra streams are RES');ids.push(eng.subscribe({channel:sp.channel,kind:'lofar',res:sp.res,filter:sp.filter,...(sp.vernierHz!==undefined?{vernierHz:sp.vernierHz}:{}),...(sp.fullAxis?{fullAxis:true}:{}),...(sp.visibleTileIndex!==undefined?{visibleTileIndex:sp.visibleTileIndex}:{})}).streamId);}
 const after=s.needsRuntimeFidelity?()=>applyRuntimeFidelity(s.contact.params,cut,eng.time,s.rampBases,s.engineHarmonicBases,s.looks):null;
 return e2eRun(name,`CutSession ${cut.id} (${cut.durationS}s): LOFAR 0-2000/2048, DEMON 1-4 kHz, ${specs.length-2} RES`,eng,specs,ids,Math.round(cut.durationS/.25),.25,after,{cutId:cut.id});
}
const cutSpecs=(extra:boolean):StreamSpec[]=>[{kind:'lofar',channel:1},{kind:'demon',buoyId:1,band:[1000,4000]},{kind:'res',channel:1,res:resForBand('LF'),filter:'NB',vernierHz:vernierHzForBand('LF')},...(extra?[{kind:'res' as const,channel:1,res:resForBand('MF'),filter:'BB' as const,vernierHz:vernierHzForBand('MF')}]:[])];
const e2eTimes:Record<string,number>={};
for(const cut of STARTER_CUTS)e2eTimes[cut.id]=cutRun(cut,cutSpecs(true),`cut-${cut.id}`);
for(const cut of SCENARIO_CUTS)e2eTimes[cut.id]=cutRun(cut,cutSpecs(false),`cut-${cut.id}`);
// 32 synthetic contacts (+ the engine's 18-ship surface pool, inactive at traffic 0), 4 buoys, every stream kind.
function manyScenario(){const s=cpaScenario();s.seed=5005;s.fmax=2000;s.environment={...manyEnv};s.contacts=many(32);
 s.buoys=[s.buoys[0],{...s.buoys[0],id:'buoy-2',rfChannel:2,x:4000,y:-2500,depth:90,type:'passive-omni'},{...s.buoys[0],id:'buoy-3',rfChannel:3,x:-6000,y:5000,depth:150},{...s.buoys[0],id:'buoy-4',rfChannel:4,x:9000,y:9000,depth:30,deployedAt:20,life:200}];return s;}
{resetResScratch();const scen=manyScenario(),eng=new AcousticEngine(structuredClone(scen),5005) as any;
 const specs:StreamSpec[]=[{kind:'lofar',channel:1},{kind:'lofar',channel:2},{kind:'lofar',channel:3},{kind:'lofar',channel:4},{kind:'demon',buoyId:1,band:[1000,4000]},{kind:'demon',buoyId:3,band:[500,2500]},
  {kind:'res',channel:1,res:5,filter:'NB',vernierHz:600},{kind:'res',channel:1,res:5,filter:'BB',fullAxis:true},{kind:'res',channel:2,res:3,filter:'NB',fullAxis:true,visibleTileIndex:2},{kind:'res',channel:3,res:2,filter:'NB',vernierHz:300},{kind:'res',channel:4,res:8,filter:'BB'}];
 const ids=specs.map(sp=>sp.kind==='lofar'?eng.subscribe({channel:sp.channel,kind:'lofar'}).streamId:sp.kind==='demon'?eng.subscribe({kind:'demon',buoyId:sp.buoyId,band:sp.band}):eng.subscribe({channel:sp.channel,kind:'lofar',res:sp.res,filter:sp.filter,...(sp.vernierHz!==undefined?{vernierHz:sp.vernierHz}:{}),...(sp.fullAxis?{fullAxis:true}:{}),...(sp.visibleTileIndex!==undefined?{visibleTileIndex:sp.visibleTileIndex}:{})}).streamId);
 e2eTimes['many-32']=e2eRun('many-32','32 synthetic contacts + 18 inactive pool ships, 4 buoys (one deploys at 20 s, dies at 220 s), LOFAR x4, DEMON x2, RES verniers + FULLBAND',eng,specs,ids,1200,.25,null,{scenario:scen,seed:5005});}
console.log('e2e TS ms:',JSON.stringify(e2eTimes));
writeFileSync(join(GEN,'e2e-times.json'),JSON.stringify(e2eTimes));
writeFileSync(join(GOLD,'e2e.json'),JSON.stringify({note:'End-to-end golden manifest (generated by acoustics/scripts/exportSwiftFixtures.ts; do not edit). Hashes: golden/e2e-hashes.bin (u16 LE low halves at offset..offset+count) + chain (FNV-1a 32 over the u32 LE hashes, checkpoint every chainEvery entries and at the end). Full fixtures: Fixtures/generated/e2e/.',chainEvery:CHAIN,runs:goldenE2E}));
writeFileSync(join(GOLD,'e2e-hashes.bin'),Buffer.from(Uint16Array.from(golden16).buffer));
writeFileSync(join(GOLD,'libm.json'),JSON.stringify(goldenLibm));

if(process.argv.includes('--bench')){
 // Same work as the Swift replay of res-many-32 (7 s session, identical calls), warmed up; plus a 60 s steady state.
 for(const dur of [7,60])for(let rep=0;rep<6;rep++){const e=manyEngine(5005);const P=ResLofarGenerator.prototype as any,o=P.render,acc=new Map<string,{n:number;ms:number}>();
  P.render=function(this:any,...a:any[]){const t0=performance.now();const r=o.apply(this,a);const k=`RES${this.settings.res}${this.settings.filter}${this.fullAxisTiles>0?'-tile':''}`;const b=acc.get(k)??{n:0,ms:0};b.n++;b.ms+=performance.now()-t0;acc.set(k,b);return r;};
  const ids=[e.subscribe({channel:1,kind:'lofar',res:5,filter:'NB',vernierHz:600}).streamId,e.subscribe({channel:1,kind:'lofar',res:5,filter:'BB',fullAxis:true}).streamId,e.subscribe({channel:1,kind:'lofar',res:3,filter:'NB',fullAxis:true,visibleTileIndex:0}).streamId];const buf=new Float32Array(4096);
  for(let t=0;t<dur;t+=RES_FRAME_S){e.advance(RES_FRAME_S);for(const id of ids)while(e.rowsReady(id)>0)e.writeRow(id,buf);}P.render=o;
  if(rep===5)for(const [k,b] of [...acc].sort())console.log(`TS RES many-32 ${dur}s ${k}: ${(b.ms/b.n).toFixed(3)} ms/render (${b.n} renders, node ${process.version})`);}
}

// ---------- 4. Optional TS timing for the Swift comparison ----------
if(process.argv.includes('--bench')){
 const gen=new LofarGenerator(buoy('difar'),many(32),2048,2000,5005,manyEnv,0);
 for(let i=0;i<200;i++)gen.generate();
 const N=2000,t0=performance.now();for(let i=0;i<N;i++)gen.generate();const ms=(performance.now()-t0)/N;
 console.log(`TS many-32 row synthesis: ${ms.toFixed(4)} ms/row (${N} rows, node ${process.version})`);
}
// ---------- 7. Scenario generator goldens (Swift generateScenario port) ----------
console.log('scenario-gen',JSON.stringify(exportScenarioGen(OUT)));

for(const dir of [OUT,GOLD,GEN,join(GEN,'e2e')]){let total=0;for(const f of readdirSync(dir)){const st=statSync(join(dir,f));if(!st.isFile())continue;total+=st.size;if(dir!==join(GEN,'e2e'))console.log(`${f}\t${(st.size/1024).toFixed(1)} KiB`);}
 console.log(`total ${(total/1024/1024).toFixed(2)} MiB in ${dir}`);}
