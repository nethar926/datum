import {describe,it,expect} from 'vitest';
import {
  AcousticEngine,ResLofarGenerator,cpaScenario,fictionalSignature,mulberry32,
  TILE_BINS,axisBinCount,tileCountFor,tileBand,tileIndexForHz,priorityTileOrder,resParams,
} from '../src/index.js';
import type {Contact,Environment} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';
import type {ResLevel} from '../src/protocol.js';
import type {TonalLine} from '../src/sourceModel.js';

const env=():Environment=>({...cpaScenario().environment});
const buoy=(type:Buoy['type']='difar'):Buoy=>({id:'buoy-1',rfChannel:1,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type});
const line=(hz:number,power=1):TonalLine=>({family:'motor',hz,power,width:'discrete',stability:'stable'});
function contact(id:string,bearingDeg:number,rangeM:number,tonals:TonalLine[]):Contact{
 const r=bearingDeg*Math.PI/180;
 return {id,category:'subsurface',x:rangeM*Math.sin(r),y:rangeM*Math.cos(r),depth:60,course:0,speed:0,motion:[{at:0,course:0,speed:0,depth:60}],params:{...fictionalSignature,levelDb:150,modulation:0,cavitationPower:0,tonals}};
}

describe('FULLBAND tile geometry',()=>{
 it('tile count, f0 = tileIndex·tileBins·fBin, last tile truncated',()=>{
  for(const r of [1,3,5,9] as ResLevel[]){
   const fBin=resParams(r).fBin;
   for(const fmax of [500,2000]){
    const axis=axisBinCount(fmax,fBin),count=tileCountFor(fmax,fBin);
    expect(count).toBe(Math.ceil(axis/TILE_BINS));
    expect(TILE_BINS).toBe(4096);
    let covered=0;
    for(let i=0;i<count;i++){
     const t=tileBand(r,i,fmax);
     expect(t.tileBins).toBe(TILE_BINS);
     expect(t.fBin).toBe(fBin);
     expect(t.f0).toBe(i*TILE_BINS*fBin);
     expect(t.tileIndex).toBe(i);
     expect(t.tileCount).toBe(count);
     expect(t.liveBins).toBeGreaterThan(0);
     expect(t.liveBins).toBeLessThanOrEqual(TILE_BINS);
     if(i<count-1){expect(t.liveBins).toBe(TILE_BINS);expect(t.bandLimited).toBe(false);}
     else{expect(t.liveBins).toBe(axis-i*TILE_BINS);expect(t.bandLimited).toBe(t.liveBins<TILE_BINS);}
     covered+=t.liveBins;
    }
    expect(covered).toBe(axis);
    expect(()=>tileBand(r,count,fmax)).toThrow(/tileIndex/);
   }
  }
 });
 it('tileIndexForHz maps vernier centre into the containing tile',()=>{
  const fBin=resParams(1).fBin,fmax=500,count=tileCountFor(fmax,fBin);
  expect(count).toBeGreaterThan(1);
  expect(tileIndexForHz(0,fBin,TILE_BINS,count)).toBe(0);
  expect(tileIndexForHz(TILE_BINS*fBin-1e-6,fBin,TILE_BINS,count)).toBe(0);
  expect(tileIndexForHz(TILE_BINS*fBin,fBin,TILE_BINS,count)).toBe(1);
  expect(tileIndexForHz(fmax,fBin,TILE_BINS,count)).toBe(count-1);
 });
 it('priorityTileOrder: visible, then ±1 neighbours, then remaining ascending',()=>{
  expect(priorityTileOrder(0,5)).toEqual([0,1,2,3,4]);
  expect(priorityTileOrder(2,5)).toEqual([2,1,3,0,4]);
  expect(priorityTileOrder(4,5)).toEqual([4,3,0,1,2]);
  expect(priorityTileOrder(0,1)).toEqual([0]);
  expect(priorityTileOrder(7,3)).toEqual([2,1,0]); // clamped
 });
});

describe('FULLBAND renderer reuses ResGram physics',()=>{
 it('deterministic seeded tile rows; tonal lands in the right tile',()=>{
  const fmax=500,r=5 as ResLevel,fBin=resParams(r).fBin,f=120,l=line(f,1e6);
  const g1=new ResLofarGenerator(buoy('passive-omni'),[contact('t',0,400,[l])],fmax,7,env(),{res:r},TILE_BINS);
  const g2=new ResLofarGenerator(buoy('passive-omni'),[contact('t',0,400,[l])],fmax,7,env(),{res:r},TILE_BINS);
  const ti=tileIndexForHz(f,fBin),t=tileBand(r,ti,fmax);
  g1.prepareFullAxis(t.tileCount);g2.prepareFullAxis(t.tileCount);
  const a=new Float32Array(TILE_BINS),b=new Float32Array(TILE_BINS);
  g1.renderTile(ti,0,a);g2.renderTile(ti,0,b);
  expect([...a]).toEqual([...b]);
  const bin=Math.round((f-t.f0)/fBin);
  expect(bin).toBeGreaterThanOrEqual(0);expect(bin).toBeLessThan(t.liveBins);
  // Peak near the tonal bin on the NB dB row (noise present; check expected via a second quiet pass).
  const quiet=new ResLofarGenerator(buoy('passive-omni'),[contact('t',0,400,[line(f,0)])],fmax,7,env(),{res:r},TILE_BINS);
  quiet.prepareFullAxis(t.tileCount);const base=new Float64Array(TILE_BINS);
  quiet.renderTile(ti,0);base.set(quiet.expected.subarray(0,t.liveBins));
  g1.renderTile(ti,1);let peak=0;for(let i=0;i<t.liveBins;i++)if(g1.expected[i]-base[i]>(g1.expected[peak]-base[peak]))peak=i;
  expect(Math.abs(peak-bin)).toBeLessThanOrEqual(1);
  expect([...a.subarray(t.liveBins)].every(Number.isNaN)).toBe(true);
 });
 it('vernier 1024 path still matches capacity-default generator',()=>{
  const l=line(150,5),c=[contact('a',45,700,[l])];
  const a=new ResLofarGenerator(buoy('difar'),c,500,9,env(),{res:3,vernierHz:120});
  const b=new ResLofarGenerator(buoy('difar'),c,500,9,env(),{res:3,vernierHz:120},TILE_BINS);
  // TILE_BINS-capacity gen after configure is still a 1024 vernier window
  b.configure({res:3,filter:'NB',vernierHz:120});
  for(let n=0;n<3;n++){a.generate();b.generate();expect([...a.row]).toEqual([...b.row.subarray(0,1024)]);expect(a.bins).toBe(1024);expect(b.bins).toBe(1024);}
 });
});

describe('FULLBAND engine contract: visible+neighbours + backfill',()=>{
 it('subscribe fullAxis emits tiled gramConfig; writeRow drains priority order',()=>{
  const e=new AcousticEngine(cpaScenario()),fmax=e.scenario.fmax,r=5 as ResLevel;
  const c=e.subscribe({channel:1,res:r,fullAxis:true,visibleTileIndex:0});
  const count=tileCountFor(fmax,resParams(r).fBin);
  expect(c).toMatchObject({fullAxis:true,tileBins:TILE_BINS,tileCount:count,visibleTileIndex:0,bins:TILE_BINS,f0:0,res:r,fBin:resParams(r).fBin});
  expect(c.fcHz).toBeUndefined();
  e.advance(c.rowPhaseS!+1/c.rowRateHz);
  expect(e.rowsReady(c.streamId)).toBe(count);
  const out=new Float32Array(TILE_BINS),order:number[]=[];
  while(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,out);order.push(e.lastFullAxisTile(c.streamId)!.tileIndex);}
  expect(order).toEqual(priorityTileOrder(0,count));
  expect(e.lastFullAxisTile(c.streamId)).toMatchObject({tileBins:TILE_BINS,fBin:resParams(r).fBin});
 });
 it('visible tile mid-axis: hot tiles first, then backfill; vernierHz maps to tile',()=>{
  const s=cpaScenario();s.fmax=2000;s.fMax=2000; // widen axis so RES5 has multiple tiles
  // cpaScenario may freeze fmax — use setGram after subscribe if needed
  const e=new AcousticEngine(s),r=1 as ResLevel; // RES1: many tiles on 500 Hz already
  const fBin=resParams(r).fBin,count=tileCountFor(e.scenario.fmax,fBin);
  expect(count).toBeGreaterThan(2);
  const visible=Math.min(2,count-1);
  const c=e.subscribe({channel:1,res:r,fullAxis:true,visibleTileIndex:visible});
  expect(c.tileCount).toBe(count);expect(c.visibleTileIndex).toBe(visible);
  e.advance(1/c.rowRateHz);
  const out=new Float32Array(TILE_BINS),got:number[]=[];
  for(let i=0;i<3&&e.rowsReady(c.streamId)>0;i++){e.writeRow(c.streamId,out);got.push(e.lastFullAxisTile(c.streamId)!.tileIndex);}
  expect(got).toEqual(priorityTileOrder(visible,count).slice(0,3));
  // Remaining are backfill
  const rest:number[]=[];while(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,out);rest.push(e.lastFullAxisTile(c.streamId)!.tileIndex);}
  expect([...got,...rest]).toEqual(priorityTileOrder(visible,count));
  // vernierHz → visible tile
  const hz=(visible+0.25)*TILE_BINS*fBin;
  const c2=e.setGram(c.streamId,{fullAxis:true,vernierHz:hz});
  expect(c2.visibleTileIndex).toBe(tileIndexForHz(hz,fBin,TILE_BINS,count));
 });
 it('existing RES vernier 1024 subscribe unchanged (no fullAxis)',()=>{
  const e=new AcousticEngine(cpaScenario()),c=e.subscribe({channel:1,res:4,vernierHz:200});
  expect(c.fullAxis).toBeUndefined();expect(c.bins).toBe(1024);expect(c.fcHz).toBe(200);
  const out=new Float32Array(1024);e.advance(2);expect(e.writeRow(c.streamId,out)).toBe(0);expect([...out].some(Number.isFinite)).toBe(true);
 });
 it('no second whitener: FULLBAND uses the same NB TPSW path as vernier',()=>{
  // Smoke: NB dbFloor/dbCeil identical; filter field NB.
  const e=new AcousticEngine(cpaScenario());
  const v=e.subscribe({channel:1,res:5,filter:'NB'});
  const f=e.subscribe({channel:1,res:5,filter:'NB',fullAxis:true});
  expect(f.dbFloor).toBe(v.dbFloor);expect(f.dbCeil).toBe(v.dbCeil);expect(f.filter).toBe('NB');
 });
});

describe('FULLBAND setViewWindow + filled',()=>{
 it('setViewWindow maps centre to visibleTileIndex, stamps viewFLo/FHi, does not reset row clock',()=>{
  const e=new AcousticEngine(cpaScenario()),r=1 as ResLevel;
  const c=e.subscribe({channel:1,res:r,fullAxis:true,visibleTileIndex:0});
  const fBin=c.fBin,tileHz=TILE_BINS*fBin;
  e.advance(1/c.rowRateHz);
  const readyBefore=e.rowsReady(c.streamId);
  expect(readyBefore).toBeGreaterThan(0);
  const out=new Float32Array(TILE_BINS);e.writeRow(c.streamId,out);
  const afterOne=e.rowsReady(c.streamId);
  const fLo=tileHz*1.2,fHi=tileHz*1.8; // centre → tile 1
  const cfg=e.setViewWindow(c.streamId,{fLo,fHi});
  expect(cfg).toMatchObject({fullAxis:true,viewFLo:fLo,viewFHi:fHi,visibleTileIndex:1});
  // Row clock untouched: pending backlog unchanged by the pan itself
  expect(e.rowsReady(c.streamId)).toBe(afterOne);
  expect(()=>e.setViewWindow(c.streamId,{fLo:10,fHi:5})).toThrow(/view window/);
  const vernier=e.subscribe({channel:1,res:5,vernierHz:100});
  expect(()=>e.setViewWindow(vernier.streamId,{fLo:0,fHi:50})).toThrow(/FULLBAND/);
 });
 it('rendered tiles report filled:true; FE treats missing tiles as unfilled/dark',()=>{
  const e=new AcousticEngine(cpaScenario()),c=e.subscribe({channel:1,res:5,fullAxis:true});
  e.advance(1/c.rowRateHz);
  const out=new Float32Array(TILE_BINS);e.writeRow(c.streamId,out);
  expect(e.lastFullAxisTile(c.streamId)).toMatchObject({filled:true,tileBins:TILE_BINS});
 });
});
