import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,FULLBAND_MAX_PREPARED_TILES} from '../src/index.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';

/** Supported field size: 32 buoys (docs/data-contract.md "Target 50+ contacts, 32 buoys"; validator hard cap 128). */
export const SUPPORTED_BUOYS=32;
function scen(nBuoys:number){const s=cpaScenario();s.fmax=2000;s.seed=303;
 s.contacts=[{id:'m',category:'subsurface',x:-1500,y:600,depth:60,course:Math.PI/2,speed:4,motion:[{at:0,course:Math.PI/2,speed:4,depth:60}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:.05,tonals:[{family:'motor',hz:40,power:1,width:'discrete',stability:'stable'}]}}];
 s.buoys=Array.from({length:nBuoys},(_,i)=>({...s.buoys[0]!,id:`buoy-${i+1}`,rfChannel:i+1,x:(i%8)*400,y:Math.floor(i/8)*500}));return s;}
const panTo=(e:any,c:any,v:number)=>{const df=c.fBin,tb=c.tileBins;e.setViewWindow(c.streamId,{fLo:v*tb*df+1,fHi:v*tb*df+tb*df/2});};
/** Run N buoys × (FULLBAND panned every 3 s + all 8 band streams); returns per-sample totals. */
export function panRun(nBuoys:number,seconds:number,res=2){
 const e=new AcousticEngine(scen(nBuoys),303) as any,out=new Float32Array(4096);
 const fulls=e.scenario.buoys.map((b:any)=>e.subscribe({channel:b.rfChannel,kind:'lofar',res,filter:'NB',fullAxis:true,visibleTileIndex:0}));
 const bands=e.scenario.buoys.flatMap((b:any)=>LOFAR_BAND_PRESETS.flatMap(p=>(['NB','BB'] as const).map(f=>e.subscribe({channel:b.rfChannel,kind:'lofar',res:resForBand(p.id),filter:f,vernierHz:vernierHzForBand(p.id)}))));
 const samples:{t:number;tiles:number;bytes:number;maxPerStream:number}[]=[];let fallbacks=0;
 const stats=()=>{let tiles=0,bytes=0,maxPer=0;for(const s of e.subscriptions.values())if(s.res){const h=s.res.historyStats();tiles+=h.tiles;bytes+=h.bytes;maxPer=Math.max(maxPer,h.tiles);fallbacks=Math.max(fallbacks,s.res.snapshotFallbacks);}return {tiles,bytes,maxPerStream:maxPer};};
 for(let k=1;k<=seconds*4;k++){e.advance(.25);const t=k*.25;
  if(t%3===0)for(const [i,c] of fulls.entries())panTo(e,c,(Math.floor(t/3)+i)%c.tileCount);
  for(const c of [...fulls,...bands])while(e.rowsReady(c.streamId)>0)e.writeRow(c.streamId,out);
  if(t%30===0)samples.push({t,...stats()});}
 return {samples,fallbacks,tileCount:fulls[0].tileCount,streams:fulls.length+bands.length};
}
describe('FULLBAND prepared-tile cap (LRU, one constant)',()=>{
 it('re-preparing an evicted tile: unfilled while warming, then bit-identical to never evicting',()=>{
  const mk=()=>{const e=new AcousticEngine(scen(1),303) as any;const c=e.subscribe({channel:1,kind:'lofar',res:2,filter:'NB',fullAxis:true,visibleTileIndex:0});return {e,c,sub:e.subscriptions.get(c.streamId)};};
  const A=mk(),B=mk(),out=new Float32Array(4096),rowsA=new Map<number,Float32Array>(),rowsB=new Map<number,{d:Float32Array;filled:boolean}>();
  expect(A.c.tileCount).toBeGreaterThan(FULLBAND_MAX_PREPARED_TILES);
  for(let k=1;k<=480;k++){const t=k*.25;A.e.advance(.25);B.e.advance(.25);
   if(t===20)panTo(B.e,B.c,6);if(t===50)panTo(B.e,B.c,0);
   if(t===30)expect(B.sub.res.historyStats().tiles).toBe(FULLBAND_MAX_PREPARED_TILES);
   for(const [X,store] of [[A,'a'],[B,'b']] as const)while(X.e.rowsReady(X.c.streamId)>0){const job=X.sub.fullAxis.queue[0];X.e.writeRow(X.c.streamId,out);if(job.tileIndex!==0)continue;const lt=X.e.lastFullAxisTile(X.c.streamId);
    if(store==='a'){expect(lt.filled).toBe(true);rowsA.set(job.rowKey,out.slice());}else rowsB.set(job.rowKey,{d:out.slice(),filled:lt.filled});}}
  // tile 0 was evicted (panned to 6 → prepared {6,5,7}); after return it warms for one span (16 s)
  let warm=0,same=0;for(const [k,b] of rowsB){const tEnd=(k+1)*4;if(tEnd<20){expect(b.filled).toBe(true);continue;}
   if(tEnd>50&&tEnd<50+16){expect(b.filled,`warming row ${k}`).toBe(false);warm++;}
   if(tEnd>=50+16+.25){expect(b.filled).toBe(true);expect(Buffer.from(b.d.buffer).equals(Buffer.from(rowsA.get(k)!.buffer)),`row ${k}`).toBe(true);same++;}}
  expect(warm).toBeGreaterThan(0);expect(same).toBeGreaterThan(10);expect(B.sub.res.snapshotFallbacks).toBe(0);
 });
 it(`${SUPPORTED_BUOYS} buoys, all 8 band streams + panned FULLBAND: tile count and total history bytes plateau`,()=>{
  const r=panRun(SUPPORTED_BUOYS,180);const first=r.samples[0]!;
  for(const s of r.samples){expect(s.tiles).toBe(first.tiles);expect(s.bytes).toBe(first.bytes);expect(s.maxPerStream).toBeLessThanOrEqual(FULLBAND_MAX_PREPARED_TILES);}
  expect(first.tiles).toBe(SUPPORTED_BUOYS*FULLBAND_MAX_PREPARED_TILES);expect(r.fallbacks).toBe(0);
 },300000);
});
