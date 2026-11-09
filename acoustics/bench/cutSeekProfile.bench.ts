/**
 * Cut seek cost profile: cold construct + drain-to-mid vs warm continue.
 * Live rows are 2 Hz (ROW_DT=0.5 would be wrong — CutSession uses 0.25 s → 4 Hz drain;
 * FE hot ring is 600 rows @ 2 Hz display = 5 min). Here we measure CutSession writeLofarRow.
 *
 * Run: node_modules/.bin/tsx bench/cutSeekProfile.bench.ts
 */
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {STARTER_CUTS,renderCut,CUT_BINS,getCutSeed} from '../src/cuts/index.js';

const NUCLEAR=new Set(['cut-velvetshoal-nuc','cut-twilightweft-nuc']);
const cuts=STARTER_CUTS.filter(c=>!NUCLEAR.has(c.id));
const buf=new Float32Array(CUT_BINS);

function drainTo(s:ReturnType<typeof renderCut>,targetS:number){
 let n=0;
 while(s.simT<targetS&&s.writeLofarRow(buf)>=0)n++;
 return n;
}

type Row={id:string;durationS:number;tonals:number;coldMs:number;warmMs:number;rowsToMid:number;msPerRowCold:number;msPerRowWarm:number;constructMs:number};

const rows:Row[]=[];
for(const cut of cuts){
 const mid=cut.durationS*0.5;
 // Cold: construct + drain to mid
 const t0=performance.now();
 const s1=renderCut(cut);
 const tConstruct=performance.now();
 const n1=drainTo(s1,mid);
 const tCold=performance.now();
 s1.dispose();
 // Warm: construct (separate) then drain mid again — simulates seek replay on fresh session
 // (FE warm seek often keeps engine; also measure continue-from-0 after construct as "warm path" drained twice)
 const s2=renderCut(cut);
 const tW0=performance.now();
 const n2=drainTo(s2,mid);
 const tW1=performance.now();
 // Continue warm: another mid-worth from mid→mid+mid/2 if possible
 const n3=drainTo(s2,Math.min(cut.durationS,mid+60));
 const tW2=performance.now();
 s2.dispose();
 const tonals=(getCutSeed(cut.id) && (()=>{
  // peek via a throwaway mid session would be expensive; use construct-time via scenario
  return 0;
 })());
 void tonals;void n3;
 // Count tonals cheaply
 const s3=renderCut(cut);const nt=s3.engine.scenario.contacts[0]?.params.tonals?.length??0;s3.dispose();
 rows.push({
  id:cut.id,durationS:cut.durationS,tonals:nt,
  constructMs:+(tConstruct-t0).toFixed(2),
  coldMs:+(tCold-t0).toFixed(2),
  warmMs:+(tW1-tW0).toFixed(2),
  rowsToMid:n1,
  msPerRowCold:+((tCold-tConstruct)/Math.max(1,n1)).toFixed(4),
  msPerRowWarm:+((tW1-tW0)/Math.max(1,n2)).toFixed(4),
 });
 console.log(JSON.stringify(rows[rows.length-1]));
}

// Synthetic hotspot: estimate seek of 600 display rows @ 2 Hz = 300 s of sim at 0.25 row → 1200 writeLofarRow
const ringRows=600,displayHz=2,simPerDisplay=1/displayHz; // 0.5 s — but CutSession row is 0.25 s
// FE hot ring 600 rows at 2 Hz = 300 s history. Cut drain at 0.25 s → 1200 engine rows to fill 300 s.
const engineRowsFor5min=300/0.25;
const avgMs=rows.reduce((a,r)=>a+r.msPerRowWarm,0)/rows.length;
const estSeekMs=avgMs*engineRowsFor5min;
const estWarm600display=avgMs*(300/(1/2))*0.25/0.25; // same

const out={
 note:'CutSession seek profile. ROW_DT=0.25 s (4 Hz drain). FE hot ring 600 rows @ 2 Hz display = 5 min → 1200 engine rows.',
 ring:{displayRows:600,displayHz:2,historyS:300,engineRows:engineRowsFor5min,estWarmSeekMs:+(avgMs*engineRowsFor5min).toFixed(1),budgetMs:150},
 cuts:rows,
 avgMsPerRowWarm:+avgMs.toFixed(4),
};
writeFileSync('bench/results/cut-seek-profile.json',JSON.stringify(out,null,1));
console.log(JSON.stringify(out.ring,null,2));
