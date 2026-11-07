import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand} from '../src/index.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';

/** Supported field size: 32 buoys (docs/data-contract.md "Target 50+ contacts, 32 buoys"; validator hard cap 128). */
export const SUPPORTED_BUOYS=32;
function scen(nBuoys:number){const s=cpaScenario();s.fmax=2000;s.seed=303;
 s.contacts=[{id:'m',category:'subsurface',x:-1500,y:600,depth:60,course:Math.PI/2,speed:4,motion:[{at:0,course:Math.PI/2,speed:4,depth:60}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,tonals:[{family:'motor',hz:40,power:1,width:'discrete',stability:'stable'}]}}];
 s.buoys=Array.from({length:nBuoys},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:(i%8)*400,y:Math.floor(i/8)*500}));return s;}
const panTo=(e:any,c:any,v:number)=>{const df=c.fBin,tb=c.tileBins;e.setViewWindow(c.streamId,{fLo:v*tb*df+1,fHi:v*tb*df+tb*df/2});};
/** N buoys × (FULLBAND panned every 3 s + all 8 band streams). */
export function panRun(nBuoys:number,seconds:number,res=5){
 const e=new AcousticEngine(scen(nBuoys),303) as any,out=new Float32Array(4096);
 const fulls=e.scenario.buoys.map((b:any)=>e.subscribe({channel:b.rfChannel,kind:'lofar',res,filter:'NB',fullAxis:true,visibleTileIndex:0}));
 const bands=e.scenario.buoys.flatMap((b:any)=>LOFAR_BAND_PRESETS.flatMap(p=>(['NB','BB'] as const).map(f=>e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(p.id),filter:f,vernierHz:vernierHzForBand(p.id)}))));
 const samples:{t:number;history:number;scratch:number;streams:number;total:number}[]=[];let fallbacks=0,unfilled=0;
 for(let k=1;k<=seconds*4;k++){e.advance(.25);const t=k*.25;
  if(t%3===0)for(const [i,c] of fulls.entries())panTo(e,c,(Math.floor(t/3)+i)%c.tileCount);
  for(const c of [...fulls,...bands])while(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,out);if(c.fullAxis&&e.lastFullAxisTile(c.streamId)?.filled===false)unfilled++;}
  if(t%30===0){const r=e.retainedBytes();samples.push({t,history:r.history,scratch:r.scratch,streams:r.streams,total:r.total});}}
 for(const s of e.subscriptions.values())if(s.res)fallbacks+=s.res.snapshotFallbacks;
 return {samples,fallbacks,unfilled,tileCount:fulls[0].tileCount,streams:fulls.length+bands.length,perStream:e.retainedBytes().perStream};
}
describe('no FULLBAND tile cap needed: tiles render from the shared state history',()=>{
 it('panning away and back: every tile row is filled immediately and bit-identical to a never-panned run (no eviction, no warm-up)',()=>{
  const mk=()=>{const e=new AcousticEngine(scen(1),303) as any;const c=e.subscribe({channel:1,kind:'lofar',res:2,filter:'NB',fullAxis:true,visibleTileIndex:0});return {e,c,sub:e.subscriptions.get(c.streamId)};};
  const A=mk(),B=mk(),out=new Float32Array(4096),rows:[Map<string,Float32Array>,Map<string,Float32Array>]=[new Map(),new Map()];
  expect(A.c.tileCount).toBeGreaterThan(3);
  for(let k=1;k<=480;k++){const t=k*.25;A.e.advance(.25);B.e.advance(.25);if(t%5===0)panTo(B.e,B.c,(t/5)%B.c.tileCount);
   [A,B].forEach((X,xi)=>{while(X.e.rowsReady(X.c.streamId)>0){const job=X.sub.fullAxis.queue[0];X.e.writeRow(X.c.streamId,out);expect(X.e.lastFullAxisTile(X.c.streamId).filled).toBe(true);rows[xi]!.set(`${job.tileIndex}:${job.rowKey}`,out.slice());}});}
  let same=0;for(const [k,b] of rows[1]){const a=rows[0].get(k);if(!a)continue;expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer)),k).toBe(true);same++;}
  expect(same).toBeGreaterThan(200);expect(A.sub.res.snapshotFallbacks+B.sub.res.snapshotFallbacks).toBe(0);
 });
 it(`${SUPPORTED_BUOYS} buoys, all 8 band streams + panned FULLBAND: acoustics retained bytes plateau and stay ≤ 50 MB`,()=>{
  const r=panRun(SUPPORTED_BUOYS,120,2);expect(r.tileCount).toBe(8);const first=r.samples[0]!;
  for(const s of r.samples)expect(s.total).toBe(first.total);
  expect(first.total).toBeLessThan(50*1024*1024);expect(r.fallbacks).toBe(0);expect(r.unfilled).toBe(0);
 },300000);
});
