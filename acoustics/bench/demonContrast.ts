/**
 * Seeded DEMON propulsion-line contrast harness (shared by bench + tests).
 *
 * Contrast (on the 30 s row-averaged display) = display value at a propulsion line (max within ±1 bin) minus the median display
 * value over ±25 bins (~±4.9 Hz) excluding ±2 bins around the line. Display = the FE pipeline
 * (clamp → background normalize → clip to [floorDb, displayCeil]).
 * False line = local max of the row-averaged display with contrast > 6 dB that is not within ±2 bins of any active
 * contact's modelled propulsion comb (shaft×1,2; BR×1..4) and not in the DC bins (<3).
 * All classes fictional; physics public (Urick / Kinsler envelope-modulation framing).
 */
import {renderCut} from '../src/cuts/index.js';
import {AcousticEngine} from '../src/engine.js';
import {loadScenario,type ScenarioInput,type Contact} from '../src/scenario.js';
import {knotsToMps} from '../src/units.js';

export const DEMON_BINS=512,DEMON_FBIN=100/511;
export type DisplayFn=(src:Float32Array,dst:Float32Array)=>void;
export interface CaseSpec {id:string;kind:'cut'|'live';note:string;/** Physically expected to show propulsion (cavitating & not masked). */expectLines:boolean;make:(band?:[number,number])=>{engine:AcousticEngine;streamId:number;pull:(out:Float32Array)=>boolean;target:Contact}}
export interface LineStat {hz:number;contrastDb:number|null}
export interface CaseResult {id:string;note:string;expectLines:boolean;shaftHz:number;blades:number;modulation:number;cavitationPower:number;shaft:LineStat;br:LineStat;br2:LineStat;br3:LineStat;/** Persistent >6 dB peaks off every contact comb (row-averaged display). */falseLines:number;/** Persistent peaks on another contact's comb (real traffic propulsion). */trafficLines:number;/** Fraction of 0–100 Hz bins lit >6 dB on the averaged display (smear/occupancy). */litFraction:number}

/** 30 s of 4 Hz rows: ~6 independent 5.1 s DEMON windows, i.e. what persists as a line on the waterfall. */
const CUT_SAMPLE_FRACTION=.4,ROWS=120;
/** DEMON starter set: main DEMON lesson (cut-cinderlilt-cav) first, then the five legacy starters. */
export const DEMON_CUT_IDS=['cut-cinderlilt-cav','cut-brindleflux-snork','cut-emberbraid-ssma','cut-gloamspiral-aip','cut-orbelune-msr','cut-mistacorn-batt'] as const;

function cutCase(id:string,note:string,expectLines:boolean):CaseSpec{
 return {id,kind:'cut',note,expectLines,make:(band)=>{
  const s=renderCut(id);s.seekTo(s.cut.durationS*CUT_SAMPLE_FRACTION);
  let streamId=s.demonStreamId;
  if(band){streamId=s.engine.subscribe({kind:'demon',buoyId:1,band});}
  const target=s.engine.scenario.contacts.find(c=>c.category!=='surface')!;
  const lofar=new Float32Array(s.lofar.bins);
  const pull=(out:Float32Array)=>{for(let k=0;k<40;k++){if(s.engine.rowsReady(streamId)>0){s.engine.writeRow(streamId,out,0);return true;}if(s.writeLofarRow(lofar)<0)return false;}return false;};
  // drain stale default-stream rows so both band variants see the same instants
  return {engine:s.engine,streamId,pull,target};
 }};
}

/** Live SIM: catalog diesel (fictional Brindleflux) on a straight CPA leg past one DIFAR buoy. */
function liveCase(id:string,note:string,expectLines:boolean,o:{speedKn:number;depthM:number;mode:string;traffic:number;sea:number;cpaM:number;seed:number;classId?:string}):CaseSpec{
 return {id,kind:'live',note,expectLines,make:(band)=>{
  const v=knotsToMps(o.speedKn),course=Math.PI/2,tCpa=120;
  const scen:ScenarioInput={v:1,seed:o.seed,mode:'aviation',bins:1024,fmax:500,time:0,surfaceTraffic:o.traffic,
   ownship:{x:0,y:0,depth:0,course:0,speed:80},
   environment:{seaState:o.sea,shipping:o.traffic<.1?'light':'moderate',shippingDensity:o.traffic,soundSpeed:1500,spreading:'hybrid',transition:1000},
   contacts:[{id:'live-diesel',category:'subsurface',classificationTarget:true,behaviour:'transit',catalogRef:{classId:o.classId??'blue-brindleflux',variantId:'base'},operatingMode:o.mode,
    x:-tCpa*v,y:-o.cpaM,depth:o.depthM,course,speed:v,motion:[{at:0,course,speed:v,depth:o.depthM}]} as never],
   buoys:[{id:'buoy-1',type:'difar',x:0,y:0,depth:60,course:0,speed:0,rfChannel:1,deployedAt:0,life:7200} as never],
  } as ScenarioInput;
  const engine=new AcousticEngine(loadScenario(scen),o.seed);
  const streamId=engine.subscribe(band?{kind:'demon',buoyId:1,band}:{kind:'demon',buoyId:1});
  engine.advance(tCpa*.8);engine.skipToLatest(streamId);
  const target=engine.scenario.contacts.find(c=>c.category!=='surface')!;
  const pull=(out:Float32Array)=>{for(let k=0;k<8;k++){if(engine.rowsReady(streamId)>0){engine.writeRow(streamId,out,0);return true;}engine.advance(.25);}return false;};
  return {engine,streamId,pull,target};
 }};
}

export const DEMON_CASES:CaseSpec[]=[
 cutCase('cut-cinderlilt-cav','MAIN DEMON LESSON: SURF 14 kn @0 m, 75 % past inception; rich traffic',true),
 cutCase('cut-brindleflux-snork','SNORK 12 kn @12 m, barely past inception; moderate traffic',true),
 cutCase('cut-emberbraid-ssma','SNORK 14 kn @14 m, barely past inception; moderate traffic',true),
 cutCase('cut-gloamspiral-aip','AIP 4 kn @80 m, non-cavitating',false),
 cutCase('cut-orbelune-msr','BATT 5 kn @80 m, non-cavitating',false),
 cutCase('cut-mistacorn-batt','BATT 3.5 kn @50 m, non-cavitating',false),
 cutCase('cut-brindleflux-cav','(DEMON pack) Brindleflux SURF 13 kn @0 m, 62.5 % past inception; moderate traffic; 900 s',true),
 cutCase('cut-gloamspiral-cav','(DEMON pack) Gloamspiral SURF 13.5 kn @0 m (surfaced cap), 35 % past inception; sparse; 900 s',true),
 cutCase('cut-pebblewisp-demon','(extra) DEMON lesson cut: BATT 2.5 kn @60 m, non-cavitating',false),
 liveCase('live-slow-batt','Brindleflux BATT 5 kn @60 m, quiet sea, no traffic (control)',false,{speedKn:5,depthM:60,mode:'BATT',traffic:0,sea:1,cpaM:1500,seed:9101}),
 liveCase('live-med-snork','Brindleflux SNORK 11.5 kn @10 m (just cavitating), no traffic',true,{speedKn:11.5,depthM:10,mode:'SNORK',traffic:0,sea:2,cpaM:2000,seed:9102}),
 liveCase('live-fast-cav','Brindleflux SURF 13 kn @0 m (under 13.5 kn cap), cavitating, no traffic',true,{speedKn:13,depthM:0,mode:'SURF',traffic:0,sea:2,cpaM:2500,seed:9103}),
 liveCase('live-gloam-surf','Gloamspiral SURF 13.5 kn @0 m (surfaced cap), cavitating, 7 blades (dense low comb), no traffic',true,{speedKn:13.5,depthM:0,mode:'SURF',traffic:0,sea:2,cpaM:2000,seed:9105,classId:'red-gloamspiral'}),
 liveCase('live-fast-traffic','Brindleflux SURF 13 kn @0 m, cavitating, moderate traffic',true,{speedKn:13,depthM:0,mode:'SURF',traffic:.35,sea:3,cpaM:3000,seed:9104}),
];

function shaftsOf(c:Contact):number[]{const s=c.params.propulsion?.shafts;return s?.length?s.map(x=>x.hz):[c.params.shaftHz];}
function combOf(c:Contact):number[]{const out:number[]=[];for(const f of shaftsOf(c)){out.push(f,2*f);for(let m=1;m<=4;m++)out.push(m*f*c.params.blades);}return out;}

function localContrast(d:Float32Array,k:number):number{
 const bg:number[]=[];for(let i=Math.max(0,k-25);i<=Math.min(DEMON_BINS-1,k+25);i++)if(Math.abs(i-k)>2&&d[i]===d[i])bg.push(d[i]);
 if(!bg.length)return NaN;bg.sort((a,b)=>a-b);const med=bg[bg.length>>1];
 let pk=-Infinity;for(let i=Math.max(0,k-1);i<=Math.min(DEMON_BINS-1,k+1);i++)if(d[i]===d[i])pk=Math.max(pk,d[i]);
 return pk-med;
}
function lineAt(avg:Float32Array,hz:number):LineStat{
 if(!(hz>0)||hz>=100-2*DEMON_FBIN)return {hz,contrastDb:null};
 const c=localContrast(avg,Math.round(hz/DEMON_FBIN));return {hz,contrastDb:c===c?c:null};
}

export function measureCase(spec:CaseSpec,display:DisplayFn,band?:[number,number]):CaseResult{
 const {pull,target,engine}=spec.make(band);
 const raw=new Float32Array(DEMON_BINS),rows:Float32Array[]=[];
 for(let r=0;r<ROWS;r++){if(!pull(raw))break;const d=new Float32Array(DEMON_BINS);display(raw,d);rows.push(d);}
 // Persistent lines: peaks of the row-averaged display (what reads as a line on a waterfall).
 const avg=new Float32Array(DEMON_BINS);for(const r of rows)for(let i=0;i<DEMON_BINS;i++)avg[i]+=r[i]/rows.length;
 const tComb=combOf(target).map(f=>Math.round(f/DEMON_FBIN));
 const oComb=engine.scenario.contacts.filter(c=>c!==target&&c.active!==false).flatMap(combOf).map(f=>Math.round(f/DEMON_FBIN));
 let falseN=0,trafficN=0;
 for(let i=3;i<DEMON_BINS-1;i++){
  if(!(avg[i]>avg[i-1]&&avg[i]>=avg[i+1]))continue;if(!(localContrast(avg,i)>6))continue;
  if(tComb.some(k=>Math.abs(k-i)<=2))continue;
  if(oComb.some(k=>Math.abs(k-i)<=2)){trafficN++;continue;}
  falseN++;
 }
 const sh=shaftsOf(target)[0],br=sh*target.params.blades;
 return {id:spec.id,note:spec.note,expectLines:spec.expectLines,shaftHz:sh,blades:target.params.blades,modulation:target.params.modulation,cavitationPower:target.params.cavitationPower??0,
  shaft:lineAt(avg,sh),br:lineAt(avg,br),br2:lineAt(avg,2*br),br3:lineAt(avg,3*br),falseLines:falseN,trafficLines:trafficN,litFraction:avg.filter(v=>v>6).length/DEMON_BINS};
}
