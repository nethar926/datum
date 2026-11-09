import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,resParams,RES_FRAME_S} from '../src/index.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';
import type {LofarBandPresetId} from '../src/protocol.js';
import type {TonalLine} from '../src/sourceModel.js';

/** Controlled edge: one stationary contact, no other sources, fixed seed. Swath 20–45 Hz and an SRC
 * tonal at 40 Hz (inside every band) are switched with sharp on/off steps at known simT. Rows are
 * measured from the rendered generator (noise-free expected spectrum of each emitted row, plus the
 * noisy NB row for a sanity check). Each run shifts the edge by one 0.25 s frame across the row
 * period so the combined samples map the response densely. */
const BANDS=LOFAR_BAND_PRESETS.map(p=>p.id);
const SWATH:[number,number]=[20,45],SRC_HZ=40;
type Kind='swath'|'src';
export interface RunOpts{fullAxis?:boolean;pan?:boolean}
export function run(kind:Kind,tOn:number,tOff:number,tEndRun:number,opts:RunOpts={}){
 const s=cpaScenario();s.fmax=opts.fullAxis?300:2000;s.seed=777;s.environment={...s.environment,shipping:'light',seaState:0};
 const line:TonalLine={family:'motor',hz:SRC_HZ,power:0,width:'discrete',stability:'stable'};
 const sw={name:'EDGE',kind:'SWATH' as const,loHz:SWATH[0],hiHz:SWATH[1],active:false,gain:0};
 s.contacts=[{id:'edge',category:'subsurface',x:0,y:1500,depth:60,course:0,speed:0,motion:[{at:0,course:0,speed:0,depth:60}],
  params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:0,tonals:[line],speedGated:[],eventSwaths:[sw]}}];
 const e=new AcousticEngine(s,777) as any;
 const subs=BANDS.map(id=>{const c=opts.fullAxis?e.subscribe({channel:1,kind:'lofar',res:resForBand(id),filter:'NB',fullAxis:true,visibleTileIndex:0}):e.subscribe({channel:1,kind:'lofar',res:resForBand(id),filter:'NB',vernierHz:vernierHzForBand(id)});return {id,c,sub:e.subscriptions.get(c.streamId)};});
 const out=new Float32Array(4096),rows:Record<string,{t:number;v:number}[]>={};for(const b of BANDS)rows[b]=[];
 const set=(on:boolean)=>{if(kind==='swath'){sw.active=on;sw.gain=on?1:0;}else line.power=on?1:0;};
 const ctact=e.scenario.contacts.find((c:any)=>c.id==='edge')??s.contacts[0];
 // the tonal object the generator reads is the contact's lines entry
 for(let t=0;t<tEndRun-1e-9;){
  const next=t+RES_FRAME_S;const on=next>tOn+1e-9&&next<=tOff+1e-9; // state during (t,next]
  set(on);for(const l of ctact.lines??[])if(l.hz===SRC_HZ&&kind==='src')l.power=on?1:0;
  if(kind==='swath')for(const w of ctact.params.eventSwaths??[]){w.active=on;w.gain=on?1:0;}
  e.advance(RES_FRAME_S);t=next;
  // Pan: sweep the visible window across tiles so the source tile is sometimes hot, sometimes backfill.
  if(opts.pan&&Math.abs(t%3)<1e-9)for(const x of subs){const tc=x.c.tileCount??1;if(tc>1){const v=Math.floor(t/3)%tc,df=x.c.fBin,tb=x.c.tileBins!;e.setViewWindow(x.c.streamId,{fLo:v*tb*df+1,fHi:v*tb*df+tb*df/2});}}
  for(const x of subs)while(e.rowsReady(x.c.streamId)>0){
   let tEnd:number;
   if(opts.fullAxis){const job=x.sub.fullAxis.queue[0];e.writeRow(x.c.streamId,out);if(job.tileIndex!==0)continue;tEnd=x.sub.start+(job.rowKey+1)/x.c.rowRateHz;}
   else{const k=x.sub.read;e.writeRow(x.c.streamId,out);tEnd=x.sub.start+(k+1)/x.c.rowRateHz;}
   const g=x.sub.res,f0=g.f0,df=g.fBin;let lo:number,hi:number;
   if(kind==='swath'){lo=Math.ceil((SWATH[0]-f0)/df)+2;hi=Math.floor((SWATH[1]-f0)/df)-2;}else{const b=Math.round((SRC_HZ-f0)/df);lo=b-2;hi=b+2;}
   let v=0;for(let i=lo;i<=hi;i++)v+=g.expected[i];rows[x.id].push({t:tEnd,v});rows[x.id].sort((a,b)=>a.t-b.t);}
 }
 return rows;
}
/** Analytic Welch weighting CDF (independent of renderer code): K Hann² segments, hop T/4. */
function welchFrac(id:LofarBandPresetId,tau:number){const p=resParams(resForBand(id)),T=p.integrationS,K=p.averages,hop=p.hopS,span=T+(K-1)*hop,N=4000;let a=0,tot=0;
 for(let n=0;n<N;n++){const u=(n+.5)/N*span;/* u = time before tEnd */let w=0;for(let m=0;m<K;m++){const x=(span-u-(span-T-m*hop))/T;/* segment m covers [m·hop, m·hop+T] before end */const y=(u-m*hop)/T;if(y>0&&y<1){const s=Math.sin(Math.PI*y);w+=s**4;}}tot+=w;if(u<tau)a+=w;}return a/tot;}
function crossings(samples:{tau:number;f:number}[]){samples.sort((a,b)=>a.tau-b.tau);const at=(lvl:number)=>{for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];if(a.f<lvl&&b.f>=lvl)return a.tau+(lvl-a.f)/(b.f-a.f||1)*(b.tau-a.tau);}return NaN;};return {t10:at(.1),t50:at(.5),t90:at(.9)};}
export function measureEdges(kind:Kind,opts:RunOpts={}){
 const res:Record<string,{rise:{t10:number;t50:number;t90:number};fall:{t10:number;t50:number;t90:number};span:number}>={};
 const per:Record<string,{rise:{tau:number;f:number}[];fall:{tau:number;f:number}[]}>={};for(const b of BANDS)per[b]={rise:[],fall:[]};
 for(let d=0;d<16;d++){const tOn=40+d*RES_FRAME_S,tOff=tOn+60;const rows=run(kind,tOn,tOff,tOff+40,opts);
  for(const b of BANDS){const r=rows[b],base=r.filter(x=>x.t<tOn-1).at(-1)!.v,top=r.filter(x=>x.t<tOff-1).at(-1)!.v;
   for(const x of r){const f=(x.v-base)/(top-base);if(x.t>tOn-20&&x.t<tOn+25)per[b].rise.push({tau:x.t-tOn,f});if(x.t>tOff-20&&x.t<tOff+25)per[b].fall.push({tau:x.t-tOff,f:1-f});}}}
 for(const b of BANDS){const p=resParams(resForBand(b));res[b]={rise:crossings(per[b].rise),fall:crossings(per[b].fall),span:p.integrationS+(p.averages-1)*p.hopS};}
 return res;
}
const theory=(id:LofarBandPresetId)=>{const p=resParams(resForBand(id)),span=p.integrationS+(p.averages-1)*p.hopS;const inv=(l:number)=>{let lo=0,hi=span;for(let i=0;i<40;i++){const m=(lo+hi)/2;if(welchFrac(id,m)<l)lo=m;else hi=m;}return lo;};return {t10:inv(.1),t50:inv(.5),t90:inv(.9),span};};

describe('band edge response = analysis window only (no offset)',()=>{
 for(const kind of ['swath','src'] as Kind[])it(`${kind}: rise/fall per band match Welch-weighted window; 50% at span/2 after the true edge`,()=>{
  const m=measureEdges(kind);
  for(const b of BANDS){const th=theory(b),r=m[b]!;
   for(const e of [r.rise,r.fall]){
    expect(Math.abs(e.t50-th.t50),`${kind} ${b} t50`).toBeLessThan(.2);
    expect(Math.abs(e.t50-th.span/2),`${kind} ${b} centre`).toBeLessThan(.2);
    expect(Math.abs((e.t90-e.t10)-(th.t90-th.t10)),`${kind} ${b} 10–90`).toBeLessThan(.25);
    expect(e.t10,`${kind} ${b} no response before edge`).toBeGreaterThan(-.01);
    expect(e.t90,`${kind} ${b} complete within span`).toBeLessThan(th.span+.01);
   }}
  // identical edge timing apart from the window: (t50 − span/2) agrees across bands
  const resid=BANDS.map(b=>m[b]!.rise.t50-m[b]!.span/2);expect(Math.max(...resid)-Math.min(...resid)).toBeLessThan(.25);
 },60000);
 it('simT convention: a row is stamped at the END of its analysis span (step at t0 reaches 50% at t0+span/2)',()=>{
  const m=measureEdges('src');for(const b of BANDS){const sp=m[b]!.span;expect(m[b]!.rise.t50).toBeCloseTo(sp/2,0);}
  expect(BANDS.map(b=>m[b]!.span)).toEqual([16,5,3.5,2.375]);
 },60000);
 it('integration is real: a 1 s tonal blip is diluted ~ by span in ELF but near-full in MF',()=>{
  const r=run('src',50,51,80);const peak=(b:string)=>{const x=r[b]!;const base=x[0]!.v;return Math.max(...x.map(y=>y.v-base));};
  const full=run('src',10,70,80);const top=(b:string)=>{const x=full[b]!;return x.filter(y=>y.t>40&&y.t<60).at(-1)!.v-x[0]!.v;};
  const elf=peak('ELF')/top('ELF'),mf=peak('MF')/top('MF');
  expect(elf).toBeLessThan(.2);expect(mf).toBeGreaterThan(.4);expect(mf).toBeGreaterThan(3*elf);
 },60000);
});
