import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,RES_FRAME_S} from '../src/index.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';

/** Startup prefill: t<t0 is back-extrapolated (kinematics at t0 rates); events contribute zero. */
const T0=40,BANDS=LOFAR_BAND_PRESETS.map(p=>p.id);
function scen(){const s=cpaScenario();s.fmax=2000;s.seed=55;(s as any).surfacePool=[];s.environment={...s.environment,seaState:0};
 s.contacts=[{id:'p',category:'subsurface',x:300,y:1800,depth:60,course:0,speed:0,motion:[{at:0,course:0,speed:0,depth:60}],
  params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:0,tonals:[
   {family:'motor',hz:30,power:1,width:'discrete',stability:'stable'},                       // steady plant line
   {family:'motor',hz:44,power:0,width:'discrete',stability:'stable',lineFamily:'HYDP'}]}}];  // burst, onset = T0
 return s;}
/** subscribeAt: when the first RES stream opens (history start). Burst on from T0. */
function run(subscribeAt:number,kin?:(c:any,t:number)=>void,burst=true){
 const e=new AcousticEngine(scen(),55) as any,c=e.scenario.contacts.find((x:any)=>x.id==='p');let subs:any[]=[];
 const open=()=>{subs=BANDS.map(id=>{const g=e.subscribe({channel:1,kind:'lofar',res:resForBand(id),filter:'NB',vernierHz:vernierHzForBand(id)});return {id,g,sub:e.subscriptions.get(g.streamId)};});};
 if(subscribeAt===0)open();const out=new Float32Array(4096),rows:Record<string,Map<number,Float64Array>>={};for(const b of BANDS)rows[b]=new Map();
 for(let k=1;k<=(T0+30)/RES_FRAME_S;k++){const t=k*RES_FRAME_S;kin?.(c,t-RES_FRAME_S);c.lines[1].power=burst&&t>T0+1e-9?1:0;e.advance(RES_FRAME_S);if(Math.abs(t-subscribeAt)<1e-9)open();
  for(const x of subs)while(e.rowsReady(x.g.streamId)>0){const kk=x.sub.read;e.writeRow(x.g.streamId,out);const tEnd=x.sub.start+(kk+1)/x.g.rowRateHz;rows[x.id]!.set(tEnd,Float64Array.from(x.sub.res.expected.subarray(0,x.sub.res.liveBins)));}}
 return {rows,e};
}
const near=(a:Float64Array,b:Float64Array)=>{let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]!-b[i]!)/Math.max(a[i]!,b[i]!));return m;};
describe('startup prefill (no invented pre-start activity)',()=>{
 it('a burst/HYDP active at t0 shows no energy before its true onset in the early rows of every band',()=>{
  // A: history starts at T0 (burst already on). C: history ran from 0 with the burst truly off until T0.
  // Burst energy = rows(with burst) − rows(burst never on), summed ±4 bins round 44 Hz (robust to the
  // ±0.004 Hz pre-t0 line wander, which is unknown before t0 and carried at its t0 value).
  const A=run(T0),C=run(0),A0=run(T0,undefined,false),C0=run(0,undefined,false);let n=0,worst=0;
  for(const b of BANDS){const g=[...A.e.subscriptions.values()].find((x:any)=>x.res&&x.config.res===resForBand(b)).res,k=Math.round((44-g.f0)/g.fBin);
   for(const [tEnd,ra] of A.rows[b]!){const rc=C.rows[b]!.get(tEnd),ra0=A0.rows[b]!.get(tEnd),rc0=C0.rows[b]!.get(tEnd);if(!rc||!ra0||!rc0||tEnd-T0>16)continue;
    let ea=0,ec=0,full=0;for(let i=k-4;i<=k+4;i++){ea+=ra[i]!-ra0[i]!;ec+=rc[i]!-rc0[i]!;}
    const last=[...A.rows[b]!.entries()].at(-1)![1],last0=[...A0.rows[b]!.entries()].at(-1)![1];for(let i=k-4;i<=k+4;i++)full+=last[i]!-last0[i]!;
    worst=Math.max(worst,Math.abs(ea-ec)/full);n++;}}
  expect(n).toBeGreaterThan(10);expect(worst).toBeLessThan(1e-3);
 });
 it('frozen prefill would have differed (sanity: early ELF row sees only the post-onset fraction)',()=>{
  const A=run(T0);const first=[...A.rows.ELF!.entries()].sort((x,y)=>x[0]-y[0])[0]!;expect(first[0]-T0).toBeLessThan(16);
  const late=[...A.rows.ELF!.entries()].sort((x,y)=>x[0]-y[0]).at(-1)!;const g=A.e.subscriptions.values().next().value.res,b=Math.round((44-g.f0)/g.fBin);
  expect(first[1][b]!).toBeLessThan(.95*late[1][b]!);
 });
 it('mid-turn + mid-acceleration start matches back-extrapolation of the true track',()=>{
  const kin=(c:any,t:number)=>{c.course=.02*t;c.speed=Math.min(8,1+.05*t);c.motion=[{at:0,course:c.course,speed:c.speed,depth:60}];};
  const A=run(T0,kin),C=run(0,kin);let worst=0,n=0;
  for(const b of BANDS)for(const [tEnd,ra] of A.rows[b]!){const rc=C.rows[b]!.get(tEnd);if(!rc)continue;
   // compare total band power (dB) — prefill track is an extrapolation, not exact
   let pa=0,pc=0;for(let i=0;i<ra.length;i++){pa+=ra[i]!;pc+=rc[i]!;}worst=Math.max(worst,Math.abs(10*Math.log10(pa/pc)));n++;}
  expect(n).toBeGreaterThan(20);expect(worst).toBeLessThan(.05);
  const h=A.e.history;expect(h.count).toBeGreaterThan(100);
 });
 it('deterministic: identical runs give identical prefilled rows',()=>{
  const a=run(T0),b=run(T0);for(const k of BANDS)for(const [t,r] of a.rows[k]!)expect(Buffer.from(r.buffer).equals(Buffer.from(b.rows[k]!.get(t)!.buffer))).toBe(true);
 });
});
