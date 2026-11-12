import {describe,it,expect} from 'vitest';
import {ResLofarGenerator,resParams,resBand,welchEdof,welchRowCorrelation,tpswBias,HANN_75_AMPLITUDE_CORRELATION,HANN_75_POWER_CORRELATION,hannAmplitude,TPSW,AcousticEngine,WorkerRuntime,cpaScenario,fictionalSignature,mulberry32,dbToPower,powerToDb} from '../src/index.js';
import type {Contact,Environment} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';
import type {ResLevel,Command,GramConfig,GramRows,WorkerRequest,WorkerResponse} from '../src/protocol.js';
import type {TonalLine} from '../src/sourceModel.js';

const RES=[1,2,3,4,5,6,7,8,9] as ResLevel[];
const env=():Environment=>({...cpaScenario().environment});
const buoy=(type:Buoy['type']='difar'):Buoy=>({id:'buoy-1',rfChannel:1,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type});
const line=(hz:number,power=1):TonalLine=>({family:'motor',hz,power,width:'discrete',stability:'stable'});
function contact(id:string,bearingDeg:number,rangeM:number,tonals:TonalLine[],extra:Partial<Contact['params']>={}):Contact{
 const r=bearingDeg*Math.PI/180;
 return {id,category:'subsurface',x:rangeM*Math.sin(r),y:rangeM*Math.cos(r),depth:60,course:0,speed:0,motion:[{at:0,course:0,speed:0,depth:60}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:0,tonals,...extra}};
}
/** Noise-free tonal-only deposit: expected(with) − expected(without), so ambient/broadband cancel exactly. */
function tonalOnly(g:ResLofarGenerator,l:TonalLine,power:number):Float64Array{l.power=0;g.generate();const base=Float64Array.from(g.expected);l.power=power;g.generate();const out=new Float64Array(g.bins);for(let i=0;i<g.liveBins;i++)out[i]=g.expected[i]-base[i];return out;}
const argmax=(a:ArrayLike<number>,lo=0,hi=a.length-1)=>{let m=lo;for(let i=lo;i<=hi;i++)if(a[i]>a[m])m=i;return m;};
/** Parabolic peak interpolation on dB (same estimator for analytic and reference spectra). */
function interp(a:ArrayLike<number>,k:number):number{const l=10*Math.log10(a[k-1]),c=10*Math.log10(a[k]),r=10*Math.log10(a[k+1]);return k+.5*(l-r)/(l-2*c+r);}
const snap=(f:number,df:number)=>Math.round(f/df)*df;

/** TEST-ONLY time-domain reference zoom-FFT: real tone at 16384 Hz → complex mix to fc → Blackman-
 * windowed-sinc lowpass (cutoff 0.45·Fd) evaluated at the fractional decimated instants (rate
 * Fd=1.25B, decimation 16384/Fd) → 1280-pt periodic Hann → DFT bins (identical to FFT output) for
 * the kept bins near the tone. Returns the interpolated peak as a display bin index (512 = fc). */
function referenceZoomPeak(res:ResLevel,tone:number,fc:number):number{
 const p=resParams(res),fs=16384,Fd=p.basebandRateHz,D=fs/Fd,N=1280,half=Math.ceil(8*D),nIn=Math.ceil(N*D)+2*half+2,fcut=.45*Fd;
 const xr=new Float64Array(nIn),xi=new Float64Array(nIn);
 for(let n=0;n<nIn;n++){const a=Math.cos(2*Math.PI*tone*n/fs),ph=2*Math.PI*fc*n/fs;xr[n]=a*Math.cos(ph);xi[n]=-a*Math.sin(ph);}
 const yr=new Float64Array(N),yi=new Float64Array(N);
 for(let m=0;m<N;m++){const t=half+m*D;let sr=0,si=0;for(let n=Math.ceil(t-half);n<=Math.floor(t+half);n++){const tau=n-t,u=2*fcut*tau/fs,sinc=Math.abs(u)<1e-12?1:Math.sin(Math.PI*u)/(Math.PI*u),z=tau/(2*half)+.5,bw=.42-.5*Math.cos(2*Math.PI*z)+.08*Math.cos(4*Math.PI*z),h=sinc*bw;sr+=xr[n]*h;si+=xi[n]*h;}yr[m]=sr;yi[m]=si;}
 const offset=Math.round((tone-fc)/p.fBin),pw=new Float64Array(9);
 for(let j=0;j<9;j++){const o=offset-4+j;let re=0,im=0;for(let m=0;m<N;m++){const w=.5-.5*Math.cos(2*Math.PI*m/N),a=-2*Math.PI*o*m/N;re+=w*(yr[m]*Math.cos(a)-yi[m]*Math.sin(a));im+=w*(yr[m]*Math.sin(a)+yi[m]*Math.cos(a));}pw[j]=re*re+im*im;}
 const k=argmax(pw,1,7);return 512+offset-4+interp(pw,k);
}

describe('RES 1–9 table, Hann/Welch statistics',()=>{
 it('Δf, band, integration, row period, averages, decimation and EDOF per RES',()=>{
  const period=[8,4,2,2,2,2,2,2,2],K=[1,1,1,2,4,8,16,32,64];
  for(const r of RES){const p=resParams(r);expect(p.fBin).toBe(.03125*2**(r-1));expect(p.bandHz).toBe(1024*p.fBin);expect(p.integrationS).toBe(1/p.fBin);expect(p.rowPeriodS).toBe(period[r-1]);expect(p.rowRateHz).toBe(1/period[r-1]);expect(p.averages).toBe(K[r-1]);expect(p.decimation).toBeCloseTo(16384/(1.25*p.bandHz),12);expect(p.enbwHz).toBe(1.5*p.fBin);expect(p.edof).toBeCloseTo(welchEdof(K[r-1]),12);}
  expect(resParams(1).bandHz).toBe(32);expect(resParams(9).fBin).toBe(8);expect(resParams(9).bandHz).toBe(8192);expect(resParams(9).integrationS).toBe(.125);
  // Harris (1978): Hann overlap correlation 65.9 % at 75 %, 16.7 % at 50 %; power correlation = c².
  expect(HANN_75_AMPLITUDE_CORRELATION).toBeCloseTo(.659,3);expect(HANN_75_POWER_CORRELATION).toBeCloseTo(.4345,3);
  expect(welchEdof(1)).toBe(2);expect(welchEdof(2)).toBeCloseTo(2.788,3);expect(welchEdof(4)).toBeCloseTo(4.763,3);expect(welchEdof(64)).toBeCloseTo(67.04,2);
  expect(welchRowCorrelation(1)).toBeCloseTo(.4345,3);expect(welchRowCorrelation(4)).toBeLessThan(.08);
  // Hann scallop 1.42 dB, ENBW 1.5 bins for any fractional placement.
  expect(-20*Math.log10(hannAmplitude(.5))).toBeCloseTo(1.42,2);for(const x of [0,.25,.5,.8]){let s=0;for(let k=-20;k<=20;k++)s+=hannAmplitude(k-x)**2;expect(s).toBeCloseTo(1.5,2);}
  expect(tpswBias(2)).toBeCloseTo(1-2.5*Math.exp(-2.5),10);
 });
 it('EDOF: noise variance matches 2/ν at every RES',()=>{
  for(const r of RES){const g=new ResLofarGenerator(buoy('passive-omni'),[],6000,11,env(),{res:r});let n=0,s=0,s2=0;
   for(let row=0;row<24;row++){g.generate();for(let i=0;i<g.liveBins;i+=1){const m=g.power[i]/g.expected[i];n++;s+=m;s2+=m*m;}}
   const mean=s/n,variance=s2/n-mean*mean,want=2/resParams(r).edof;expect(Math.abs(mean-1)).toBeLessThan(.03);expect(Math.abs(variance/want-1)).toBeLessThan(.1);}
 });
 it('row-to-row noise correlation: present (ρ≈0.4345) at RES1–3 where K=1 (75 % overlapped single FFTs), ~0 at RES5+',()=>{
  // NOTE: RES1–2 (and RES3, since P=T/4=2 s there too) rows are CORRELATED by design: AR(1) on the
  // complex bin amplitude with Harris c=0.659 gives power correlation c²=0.4345 between rows.
  // K≥2 rows are drawn independently (residual Welch row correlation, e.g. 0.17 at RES4, is neglected).
  const corr=(r:ResLevel)=>{const g=new ResLofarGenerator(buoy('passive-omni'),[],6000,5,env(),{res:r}),prev=new Float64Array(1024);let sx=0,sy=0,sxx=0,syy=0,sxy=0,n=0;g.generate();for(let i=0;i<1024;i++)prev[i]=g.power[i]/g.expected[i];
   for(let row=0;row<30;row++){g.generate();for(let i=0;i<g.liveBins;i++){const y=g.power[i]/g.expected[i],x=prev[i];sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;n++;prev[i]=y;}}
   return (sxy/n-sx*sy/n/n)/Math.sqrt((sxx/n-(sx/n)**2)*(syy/n-(sy/n)**2));};
  for(const r of [1,2,3] as ResLevel[])expect(Math.abs(corr(r)-HANN_75_POWER_CORRELATION)).toBeLessThan(.04);
  for(const r of [5,7,9] as ResLevel[])expect(Math.abs(corr(r))).toBeLessThan(.03);
 });
});

describe('RES tonal placement and zoom-FFT agreement',()=>{
 it('known tonal peaks within ½ bin at every RES, full band and random vernier centres',()=>{
  const rng=mulberry32(2024),fmax=6000;
  for(const r of RES){const df=resParams(r).fBin;
   for(let trial=0;trial<4;trial++){
    const vernier=trial===0?undefined:snap(rng()*fmax,df),band=resBand(r,vernier,fmax),hiHz=Math.min(band.f0+1019*df,fmax-3*df),f=band.f0+4*df+rng()*(hiHz-band.f0-4*df);
    const l=line(f),g=new ResLofarGenerator(buoy('passive-omni'),[contact('t',30,300,[l])],fmax,1,env(),{res:r,filter:'NB',vernierHz:vernier}),d=tonalOnly(g,l,1e6),k=argmax(d,0,g.liveBins-1);
    expect(Math.abs(g.f0+k*df-f)).toBeLessThanOrEqual(df/2+1e-9);expect(d[k]).toBeGreaterThan(0);
   }}
 });
 it('analytic peak agrees with a real time-domain reference zoom-FFT within 0.1 bin at every RES',()=>{
  const rng=mulberry32(77),fmax=8192;
  for(const r of RES){const p=resParams(r),vernier=r===9?undefined:snap(p.bandHz*(.6+rng()*2),p.fBin),band=resBand(r,vernier,fmax),tone=band.fcHz+(rng()-.5)*.4*p.bandHz;
   const l=line(tone),g=new ResLofarGenerator(buoy('passive-omni'),[contact('t',0,300,[l])],fmax,3,env(),{res:r,vernierHz:vernier}),d=tonalOnly(g,l,1e6),k=argmax(d,1,g.liveBins-2),analytic=interp(d,k),reference=referenceZoomPeak(r,tone,band.fcHz);
   expect(band.bandLimited).toBe(false);expect(Math.abs(analytic-reference)).toBeLessThan(.1);expect(Math.abs(analytic-(tone-band.f0)/p.fBin)).toBeLessThan(.1);
  }
 },60_000);
 it('vernier fc lands exactly on bin 512, including bands slid at 0 Hz and at fmax',()=>{
  const s=cpaScenario(),e=new AcousticEngine(s),rng=mulberry32(9),fmax=s.fmax;
  for(const r of [1,2,3,4] as ResLevel[]){const df=resParams(r).fBin;
   for(const want of [snap(100+rng()*300,df),snap(1,df),snap(fmax-.5,df)]){
    const c=e.subscribe({channel:1,res:r,vernierHz:want});expect(c.f0+512*c.fBin).toBe(c.fcHz);
    if(want-512*df>=0&&want+511*df<=fmax){expect(c.fcHz).toBe(want);expect(c.f0).toBe(want-512*df);}
    else if(want-512*df<0){expect(c.f0).toBe(0);expect(c.fcHz).toBe(512*df);}
    else{expect(c.f0+1023*df).toBeCloseTo(fmax,9);expect(c.liveBins).toBe(1024);}
    const l=line(c.fcHz!),g=new ResLofarGenerator(buoy('passive-omni'),[contact('t',0,300,[l])],fmax,1,env(),{res:r,vernierHz:want});expect(argmax(tonalOnly(g,l,1e6))).toBe(512);e.unsubscribe(c.streamId);
   }}
 });
 it('Doppler on a moving contact lands within ½ bin of the closed form at RES1–4',()=>{
  const c=1500,f=300;
  for(const r of [1,2,3,4] as ResLevel[]){const df=resParams(r).fBin;
   for(const t of [-200,-60,0,90,250]){
    const l=line(f),k=contact('m',0,0,[l]);k.course=Math.PI/2;k.speed=8;k.x=8*t;k.y=900;k.depth=60;
    const R=Math.hypot(k.x,k.y,k.depth-40),toward=-(8*k.x)/R,closed=f*c/(c-toward);
    const g=new ResLofarGenerator(buoy('passive-omni'),[k],500,1,env(),{res:r,vernierHz:snap(closed,df)}),d=tonalOnly(g,l,1e6),bin=argmax(d);
    expect(Math.abs(g.f0+bin*df-closed)).toBeLessThanOrEqual(df/2+1e-9);if(t!==0)expect(Math.abs(closed-f)).toBeGreaterThan(df);
   }}
 });
 it('swept HYDP-style transient: fitted curve matches truth at RES5–7',()=>{
  const truth=(t:number)=>180+.6*t+.006*t*t;
  for(const r of [5,6,7] as ResLevel[]){const p=resParams(r),l=line(180,30),g=new ResLofarGenerator(buoy('passive-omni'),[contact('h',0,800,[l])],500,21,env(),{res:r,filter:'NB',vernierHz:snap(240,p.fBin)});
   const ts:number[]=[],fs:number[]=[];
   for(let n=0;n<31;n++){const t=n*p.rowPeriodS;l.frequencyHz=truth(t);g.generate();const lo=Math.max(1,Math.floor((truth(t)-g.f0)/p.fBin)-6),k=argmax(g.row,lo,Math.min(g.liveBins-2,lo+12)),lin=[g.row[k-1],g.row[k],g.row[k+1]].map(v=>dbToPower(v));ts.push(t);fs.push(g.f0+(k-1+interp(lin,1))*p.fBin);}
   // least-squares quadratic fit
   const A=[[0,0,0],[0,0,0],[0,0,0]],b=[0,0,0];for(let i=0;i<ts.length;i++){const v=[1,ts[i],ts[i]**2];for(let a=0;a<3;a++){b[a]+=v[a]*fs[i];for(let c=0;c<3;c++)A[a][c]+=v[a]*v[c];}}
   for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){const m=A[j][i]/A[i][i];for(let c=0;c<3;c++)A[j][c]-=m*A[i][c];b[j]-=m*b[i];}
   const x=[0,0,0];for(let i=2;i>=0;i--){let s=b[i];for(let c=i+1;c<3;c++)s-=A[i][c]*x[c];x[i]=s/A[i][i];}
   for(const t of ts)expect(Math.abs(x[0]+x[1]*t+x[2]*t*t-truth(t))).toBeLessThan(.25*p.fBin);
  }
 });
});

describe('RES band limit, NB and BB filters',()=>{
 it('RES9 (and any band wider than fmax) clamps: NaN power and bearing above fmax, bandLimited',()=>{
  const e=new AcousticEngine(cpaScenario()),c9=e.subscribe({channel:1,res:9}),c5=e.subscribe({channel:1,res:5,filter:'BB'}),out=new Float32Array(1024),brg=new Float32Array(1024);
  expect(c9).toMatchObject({res:9,bins:1024,f0:0,fBin:8,bandHz:8192,bandLimited:true,liveBins:63});expect(c5).toMatchObject({bandLimited:true,liveBins:1001,fBin:.5});
  e.advance(2);for(const c of [c9,c5]){expect(e.writeRow(c.streamId,out)).toBe(0);e.writeBearingRow(c.streamId,brg);const L=c.liveBins!;
   expect([...out.subarray(0,L)].every(Number.isFinite)).toBe(true);expect([...out.subarray(L)].every(Number.isNaN)).toBe(true);expect([...brg.subarray(0,L)].every(Number.isFinite)).toBe(true);expect([...brg.subarray(L)].every(Number.isNaN)).toBe(true);}
  expect((c9.liveBins!-1)*c9.fBin).toBeLessThanOrEqual(500);expect(c9.liveBins!*c9.fBin).toBeGreaterThan(500);
  const v=e.subscribe({channel:1,res:9,vernierHz:300});expect(v).toMatchObject({f0:0,bandLimited:true,fcHz:4096});
  expect(e.subscribe({channel:1,res:4,vernierHz:250}).bandLimited).toBe(false);
 });
 it('NB (TPSW) flattens a sloping ambient to ±1 dB',()=>{
  const e0={...env(),seaState:4,shipping:'heavy' as const},g=new ResLofarGenerator(buoy('passive-omni'),[],500,8,e0,{res:4,filter:'NB',vernierHz:200}),L=g.liveBins,mean=new Float64Array(L),rows=300;
  for(let n=0;n<rows;n++){g.generate();for(let i=0;i<L;i++)mean[i]+=dbToPower(g.row[i])/rows;}
  const slope=powerToDb(g.ambientBin[0]/g.ambientBin[L-1]);expect(slope).toBeGreaterThan(3);
  for(let i=0;i<L;i++)expect(Math.abs(powerToDb(mean[i]))).toBeLessThan(1);
  expect(TPSW).toEqual({halfWindowBins:32,halfGapBins:3,clipFactor:2.5});
 });
 it('NB: a line 10 dB over background reads ~10 dB',()=>{
  for(const r of [3,5] as ResLevel[]){const df=resParams(r).fBin,f=snap(205,df),l=line(f),k=contact('n',0,2000,[l]),g=new ResLofarGenerator(buoy('passive-omni'),[k],500,4,env(),{res:r,filter:'NB',vernierHz:200}),bin=Math.round((f-g.f0)/df);
   const unit=tonalOnly(g,l,1)[bin];l.power=0;g.generate();const bg=g.expected[bin];l.power=9*bg/unit;g.generate();expect(powerToDb(g.expected[bin]/bg)).toBeCloseTo(10,6);
   let m=0;const rows=400;for(let n=0;n<rows;n++){g.generate();m+=dbToPower(g.row[bin])/rows;}expect(Math.abs(powerToDb(m)-10)).toBeLessThan(.7);}
 });
 it('BB: absolute ENBW-corrected level dB re 1 µPa²/Hz, tracks a +6 dB source level step within 0.5 dB',()=>{
  const k=contact('b',0,400,[],{levelDb:160,cavitationPower:.3}),g=new ResLofarGenerator(buoy('passive-omni'),[k],6000,6,env(),{res:6,filter:'BB'}),lo=200,hi=900;
  const level=(rows:number)=>{let s=0,psd=0;for(let n=0;n<rows;n++){g.generate();for(let i=lo;i<hi;i++){s+=dbToPower(g.row[i]);psd+=g.expected[i]/g.params.enbwHz;}}return [powerToDb(s/(rows*(hi-lo))),powerToDb(psd/(rows*(hi-lo)))];};
  const [before,psdBefore]=level(30);expect(Math.abs(before-psdBefore)).toBeLessThan(.5);
  k.params.levelDb+=6;const [after]=level(1),[afterMany]=level(30);
  expect(Math.abs(after-before-6)).toBeLessThan(.5);expect(Math.abs(afterMany-before-6)).toBeLessThan(.5);
  const c=new AcousticEngine(cpaScenario()).subscribe({channel:1,filter:'BB'});expect(c).toMatchObject({res:5,filter:'BB',dbFloor:40,dbCeil:110});
 });
 it('BB DIFAR: broadband-only contact gives a steady bearing (east/north summed over the 1/24-octave window)',()=>{
  const k=contact('b',60,600,[],{levelDb:150,cavitationPower:.3}),g=new ResLofarGenerator(buoy('difar'),[k],6000,12,env(),{res:5,filter:'BB'}),nb=new ResLofarGenerator(buoy('difar'),[k],6000,12,env(),{res:5,filter:'NB'});
  const means:number[]=[],spread=(a:number[])=>{let sx=0,sy=0;for(const d of a){sx+=Math.sin(d*Math.PI/180);sy+=Math.cos(d*Math.PI/180);}const R=Math.hypot(sx,sy)/a.length;return [(Math.atan2(sx,sy)*180/Math.PI+360)%360,Math.sqrt(-2*Math.log(R))*180/Math.PI];};
  let nbSpread=0;
  for(let n=0;n<20;n++){g.generate();nb.generate();const a:number[]=[],b:number[]=[];for(let i=200;i<900;i++){a.push(g.bearingRow[i]);b.push(nb.bearingRow[i]);}const [m,s]=spread(a);expect(s).toBeLessThan(3);means.push(m);nbSpread+=spread(b)[1]/20;}
  for(const m of means)expect(Math.abs(((m-60+540)%360)-180)).toBeLessThan(1);expect(nbSpread).toBeGreaterThan(spread(means)[1]);
 });
});

describe('RES contract, determinism and allocation',()=>{
 function setup(){const messages:WorkerResponse[]=[];const runtime=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));const send=(m:Command)=>runtime.command({...m,v:1,simT:runtime.simT} as WorkerRequest);send({type:'init',seed:42,scenarioId:'cpa-pass'});return {runtime,messages,send};}
 const batches=(m:WorkerResponse[])=>m.filter((x):x is GramRows=>x.type==='gramRows');
 const release=(s:ReturnType<typeof setup>,b:GramRows)=>{const buffers=[b.streamIds.buffer,b.rowIndex.buffer,b.data.buffer,b.bearingDeg!.buffer] as ArrayBuffer[];s.send({type:'release',buffers:structuredClone(buffers,{transfer:buffers})});};
 it('subscribe res/filter/vernier echoes the full gramConfig; legacy subscribe is unchanged',()=>{
  const e=new AcousticEngine(cpaScenario()),c=e.subscribe({channel:1,res:3,vernierHz:120});
  expect(c).toEqual({v:1,type:'gramConfig',simT:0,streamId:c.streamId,kind:'lofar',channel:1,bins:1024,f0:120-64,fBin:.125,rowRateHz:.5,dbFloor:0,dbCeil:30,res:3,filter:'NB',bandHz:128,fcHz:120,enbwHz:.1875,bandLimited:false,liveBins:1024,rowPhaseS:2,integrationMode:'sti',integrationSpanS:8});
  expect(e.subscribe({channel:1,filter:'NB'})).toMatchObject({res:5,f0:0,fBin:.5});expect(e.subscribe({channel:1,res:1})).toMatchObject({rowRateHz:.125,fBin:.03125});expect('fcHz' in e.subscribe({channel:1,res:2})).toBe(false);
  const legacy=e.subscribe({channel:1});expect(legacy).toMatchObject({rowRateHz:4,dbFloor:40,dbCeil:110,fBin:500/1023});expect(legacy.res).toBeUndefined();
  for(const bad of [{res:0},{res:10},{res:2.5},{filter:'XX'},{vernierHz:-1},{res:3,band:[0,100]},{res:3,bins:512}])expect(()=>e.subscribe({channel:1,...bad} as never)).toThrow();
 });
 it('engine setGram changes res/filter/vernier on an existing stream and restarts on the P grid',()=>{
  const e=new AcousticEngine(cpaScenario()),out=new Float32Array(1024);e.advance(3);
  let c=e.setGram(1,{res:2});expect(c).toMatchObject({streamId:1,res:2,filter:'NB',rowRateHz:.25,f0:0});expect(e.gramSettings(1)).toEqual({res:2,filter:'NB'});
  expect(e.writeRow(1,out)).toBe(-1);e.advance(1);expect(e.rowsReady(1)).toBe(1);expect(e.writeRow(1,out)).toBe(0);
  c=e.setGram(1,{filter:'BB',vernierHz:200});expect(c).toMatchObject({res:2,filter:'BB',fcHz:200,f0:200-32,dbFloor:40,dbCeil:110});
  c=e.setGram(1,{vernierHz:null});expect(c.fcHz).toBeUndefined();expect(c.f0).toBe(0);expect(c.filter).toBe('BB');
  const d=e.subscribe({kind:'demon',buoyId:1});expect(()=>e.setGram(d,{res:3})).toThrow(/LOFAR/);expect(()=>e.setGram(999,{res:3})).toThrow(/streamId/);expect(()=>e.setGram(1,{res:12 as never})).toThrow(/res/);
 });
 it('worker: RES rows packed per row period, setGram re-emits gramConfig, release/rowIndex consistent',()=>{
  const s=setup();s.send({type:'subscribe',channel:1,res:1});s.send({type:'subscribe',channel:1,res:5,filter:'BB'});
  const configs=s.messages.filter((m):m is GramConfig=>m.type==='gramConfig'),r1=configs.find(c=>c.res===1)!,r5=configs.find(c=>c.res===5)!;expect(r1.rowRateHz).toBe(.125);
  s.send({type:'subscribe',channel:1,res:1});expect(s.messages.at(-1)).toMatchObject({type:'gramConfig',streamId:r1.streamId});
  for(let i=0;i<64;i++){s.runtime.tick(.25);for(const b of batches(s.messages.splice(0)))release(s,b);s.messages.length=0;}
  const seen=new Map<number,number[]>(),times=new Map<number,number[]>();
  for(let i=0;i<64;i++){s.runtime.tick(.25);for(const b of batches(s.messages)){for(let j=0;j<b.streamIds.length;j++){const id=b.streamIds[j];(seen.get(id)??seen.set(id,[]).get(id)!).push(b.rowIndex[j]);(times.get(id)??times.set(id,[]).get(id)!).push(b.simT);}release(s,b);}s.messages.length=0;}
  expect(times.get(r1.streamId)).toEqual([24,32]);expect(seen.get(r1.streamId)).toEqual([2,3]);expect(times.get(r5.streamId)).toEqual([18,20,22,24,26,28,30,32]);expect(times.get(1)!.length).toBe(64);
  s.send({type:'setGram',streamId:1,res:2,vernierHz:100});const c=s.messages.at(-1) as GramConfig;expect(c).toMatchObject({type:'gramConfig',streamId:1,res:2,fcHz:100,rowRateHz:.25});
  for(let i=0;i<32;i++){s.runtime.tick(.25);for(const b of batches(s.messages.splice(0)))if(![...b.streamIds].includes(1))release(s,b);else s.messages.push(b);}const b1=batches(s.messages).filter(b=>[...b.streamIds].includes(1));expect(b1.map(b=>b.simT)).toEqual([36,40]);expect(b1[0].data.length).toBe(1024*b1[0].streamIds.length);
  s.send({type:'setGram',streamId:4242,res:3});expect(s.messages.at(-1)?.type).toBe('error');
 });
 it('determinism: same seed → identical RES rows/bearings across settings; worker seek replays RES rows',()=>{
  const bytes=(a:Float32Array)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
  const mk=(seed:number)=>new ResLofarGenerator(buoy('difar'),[contact('a',45,700,[line(150,5)],{cavitationPower:.1})],500,seed,env(),{res:2});
  const a=mk(9),b=mk(9),c=mk(10);
  for(const st of [{res:2,filter:'NB'},{res:5,filter:'BB',vernierHz:150},{res:7,filter:'NB'}] as const){a.configure(st);b.configure(st);c.configure(st);for(let n=0;n<4;n++){a.generate();b.generate();c.generate();expect(bytes(a.row).equals(bytes(b.row))).toBe(true);expect(bytes(a.bearingRow).equals(bytes(b.bearingRow))).toBe(true);expect(bytes(a.row).equals(bytes(c.row))).toBe(false);}}
  const x=setup(),y=setup();x.send({type:'setGram',streamId:1,res:3,filter:'BB'});for(let i=0;i<16;i++)x.runtime.tick(.25);const want=batches(x.messages).at(-1)!;
  y.send({type:'setGram',streamId:1,res:3,filter:'BB'});y.runtime.command({v:1,type:'seek',simT:2});for(let i=0;i<8;i++)y.runtime.tick(.25);const got=batches(y.messages).at(-1)!;
  expect(got.simT).toBe(want.simT);expect(got.rowIndex[0]).toBe(want.rowIndex[0]);expect(got.data).toEqual(want.data);
 });
 it('row phases spread RES rows evenly: rows per 0.25 s step ≤ ceil(N·dt/P)+1 (counted, not timed)',()=>{
  const many=(n:number)=>{const s=cpaScenario();s.buoys=Array.from({length:n},(_,i)=>({...s.buoys[0],id:`buoy-${i+1}`,rfChannel:i+1,x:(i%8)*400,y:Math.floor(i/8)*500}));return s;};
  for(const n of [32,7]){for(const r of [1,2,3,5,9] as ResLevel[]){
   const e=new AcousticEngine(many(n)),P=resParams(r).rowPeriodS,ids=e.scenario.buoys.map(b=>e.subscribe({channel:b.rfChannel,res:r}));
   for(const [i,c] of ids.entries()){
    const stagger=Math.floor(i*(P/.25)/n)*.25,start=Math.floor((0-stagger)/P+1e-9)*P+stagger;
    expect(c.rowPhaseS).toBe(start+P);expect(((c.rowPhaseS!%P)+P)%P).toBe(stagger);
   }
   const bound=Math.ceil(n*.25/P)+1,out=new Float32Array(1024),seen=new Map<number,number[]>();let max=0,total=0;
   for(let step=1;step<=Math.round(4*P)*3;step++){e.advance(.25);let rows=0;for(const c of ids)while(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,out);rows++;(seen.get(c.streamId)??seen.set(c.streamId,[]).get(c.streamId)!).push(e.time);}max=Math.max(max,rows);total+=rows;}
   expect(max).toBeLessThanOrEqual(bound);expect(total).toBe(3*n);
   for(const c of ids){const t=seen.get(c.streamId)!;expect(t).toHaveLength(3);for(const x of t)expect(Math.abs(((x-c.rowPhaseS!)/P)-Math.round((x-c.rowPhaseS!)/P))).toBeLessThan(1e-9);}
  }}
  // Phase is by buoy index (scenario order), so subscribe order does not change it; setGram re-phases on the new P.
  const e=new AcousticEngine(many(8)),late=e.subscribe({channel:8,res:5}),early=e.subscribe({channel:1,res:5});expect(late.rowPhaseS).toBe(1.75);expect(early.rowPhaseS).toBe(2);
  e.advance(3);const g=e.setGram(late.streamId,{res:1});expect(g.rowPhaseS).toBe(7);expect(e.rowsReady(late.streamId)).toBe(0);e.advance(3.75);expect(e.rowsReady(late.streamId)).toBe(0);e.advance(.25);expect(e.rowsReady(late.streamId)).toBe(1);
 });
 it('worker packs phased RES rows: per-tick rows bounded, every stream on its own grid, phased rows deterministic',()=>{
  const s=setup();for(let i=2;i<=8;i++)s.send({type:'dropBuoy',id:i,channel:i,kind:'difar',x:i*300,y:0,hydrophoneDepthM:40});
  for(let ch=1;ch<=8;ch++)s.send({type:'subscribe',channel:ch,res:5});
  const cfg=s.messages.filter((m):m is GramConfig=>m.type==='gramConfig'&&m.res===5);expect(cfg.map(c=>c.rowPhaseS)).toEqual([2,.25,.5,.75,1,1.25,1.5,1.75]);
  let max=0;const times=new Map<number,number[]>();
  for(let k=0;k<32;k++){s.runtime.tick(.25);let rows=0;for(const b of batches(s.messages)){for(let j=0;j<b.streamIds.length;j++){const id=b.streamIds[j];const c=cfg.find(c=>c.streamId===id);if(!c)continue;rows++;(times.get(id)??times.set(id,[]).get(id)!).push(b.simT);}release(s,b);}s.messages.length=0;max=Math.max(max,rows);}
  expect(max).toBeLessThanOrEqual(Math.ceil(8*.25/2)+1);
  for(const c of cfg)expect(times.get(c.streamId)).toEqual([0,1,2,3].map(k=>c.rowPhaseS!+2*k).filter(t=>t<=8));
  // The phase only moves *when* a stream's generator runs; its row sequence (seeded per row, AR(1)
  // state carried row to row at K=1) is unchanged, so phased rows are deterministic and identical
  // to an unphased generator with the same settings.
  const many=()=>{const m=cpaScenario();m.buoys=Array.from({length:4},(_,i)=>({...m.buoys[0],id:`buoy-${i+1}`,rfChannel:i+1}));return m;};
  const rowsOf=()=>{const e=new AcousticEngine(many()),c=e.subscribe({channel:4,res:1}),out:number[][]=[],row=new Float32Array(1024);expect(c.rowPhaseS).toBe(6);for(let k=0;k<4*30;k++){e.advance(.25);if(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,row);out.push([e.time,...row.subarray(0,64)]);}}return out;};
  const a=rowsOf(),b2=rowsOf();expect(a.map(r=>r[0])).toEqual([6,14,22,30]);expect(a).toEqual(b2);
 });
 it('no per-frame allocation: reused outputs and zero typed-array constructions in the hot path',()=>{
  const e=new AcousticEngine(cpaScenario()),ids=[e.subscribe({channel:1,res:1}).streamId,e.subscribe({channel:1,res:5,filter:'BB'}).streamId,e.subscribe({channel:1,res:9,vernierHz:200}).streamId],out=new Float32Array(1024*3),brg=new Float32Array(1024*3);
  const g=new ResLofarGenerator(buoy('difar'),[contact('a',45,700,[line(150,5),{...line(90,2),width:'diffuse',sigmaBins:3}],{cavitationPower:.1})],500,1,env(),{res:4});const row=g.row;
  const kinds=['Float32Array','Float64Array','Int32Array','Uint32Array','Int16Array','Uint8Array'] as const,saved=kinds.map(k=>globalThis[k]);let count=0;
  try{kinds.forEach((k,i)=>{(globalThis as Record<string,unknown>)[k]=new Proxy(saved[i] as object,{construct(t,args,nt){count++;return Reflect.construct(t as never,args,nt);}});});
   for(let n=0;n<40;n++){e.advance(.25);for(let j=0;j<ids.length;j++)if(e.rowsReady(ids[j])>0){e.writeRow(ids[j],out,j*1024);e.writeBearingRow(ids[j],brg,j*1024);}expect(g.generate()).toBe(row);}
  }finally{kinds.forEach((k,i)=>{(globalThis as Record<string,unknown>)[k]=saved[i];});}
  expect(count).toBe(0);expect(new Float64Array(1)).toBeInstanceOf(Float64Array);
 });
});
