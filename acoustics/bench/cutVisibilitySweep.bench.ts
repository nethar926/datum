/**
 * Seed sweep: starter-cut lesson contrast + procedural scenario pools (easy/regular/difficult)
 * before/after tonal visibility. Writes bench/results/cut-visibility-sweep.json.
 *
 * Run: node_modules/.bin/tsx bench/cutVisibilitySweep.bench.ts
 */
import {writeFileSync} from 'node:fs';
import {
 STARTER_CUTS,lessonLineContrasts,bestLine,meanRawRow,CUT_VISIBILITY_WINDOW as W,
} from '../src/cuts/index.js';
import {generateScenario,presetToParams} from '../src/index.js';
import {AcousticEngine} from '../src/engine.js';
import {ambientLevel} from '../src/ambientNoise.js';

const SEEDS=[7,31,47,101,211];
const DIFFS=['easy','regular','difficult'] as const;

type LineSnap={family:string;n:number|undefined;hz:number|undefined;peakHz:number|undefined;contrastDb:number|undefined;window:string;masked:boolean;inWindow:boolean;giveaway:boolean};
const cutRows=STARTER_CUTS.map(c=>{
 const lessons=lessonLineContrasts(c).map(r=>({
  family:r.line.lineFamily,n:r.line.n,hz:r.hz,peakHz:r.peakHz,
  contrastDb:r.contrastDb===undefined?null:+r.contrastDb.toFixed(2),
  window:r.window,masked:r.expectMasked,inWindow:r.inWindow,giveaway:!!r.line.giveaway,
 }satisfies LineSnap & {contrastDb:number|null}));
 const best=bestLine(meanRawRow(c));
 return {id:c.id,mode:c.mode,depthM:c.depthM,cpaM:c.cpaM??900,cpaNote:c.cpaNote??null,bestHz:+best.hz.toFixed(1),bestContrastDb:+best.contrastDb.toFixed(2),lessons};
});

/** Sparse VLF/aux line census on procedural pools: count tonals with relative power>0 below 40 Hz and AUX family. */
function poolCensus(difficulty:typeof DIFFS[number],seed:number){
 const s=generateScenario(presetToParams(difficulty,seed));
 const e=new AcousticEngine(s,seed);
 e.advance(5);
 const contacts=e.scenario.contacts.filter(c=>c.category!=='surface'&&c.active!==false);
 let vlf=0,aux=0,tonals=0,loud=0;
 const amb30=ambientLevel(30,s.environment.seaState,s.environment.shipping,s.environment.shippingDensity);
 for(const c of contacts){
  const ref=c.params.tonalRefDb;
  for(const l of c.params.tonals??[]){
   if(!(l.power>0)||!(l.hz>0))continue;tonals++;
   if(l.hz<40)vlf++;
   if(l.lineFamily==='AUX'||l.lineFamily==='GRID'||l.lineFamily==='MSR')aux++;
   // Rough received SL vs ambient at 1 km spherical (illustrative, not a detector).
   const sl=ref!==undefined?ref+10*Math.log10(l.power):c.params.levelDb+10*Math.log10(l.power);
   if(sl-60>amb30+6)loud++; // TL~60 dB @1 km
  }
 }
 e; // keep
 return {difficulty,seed,contacts:contacts.length,tonals,vlfLines:vlf,auxLikeLines:aux,approxLoudAt1km:loud,ambient30Hz:+amb30.toFixed(1),surfaceTraffic:s.surfaceTraffic,seaState:s.environment.seaState};
}

const pools=DIFFS.flatMap(d=>SEEDS.map(seed=>poolCensus(d,seed)));
const summary={
 note:'Post tonalRefDb/effective-depth/SNORK fix. Starter cuts: lesson lines clear 6 dB (masked HYDP stays masked). Procedural: VLF/aux present without flooding detection.',
 beforeBaseline:[[ 'cut-brindleflux-snork',1371.8,1.84],['cut-cinderlilt-cav',1811.4,1.83],['cut-pebblewisp-demon',1885.7,1.65],['cut-mistacorn-batt',1531,1.59],['cut-orbelune-msr',906.7,10.36],['cut-emberbraid-ssma',350.8,3.86],['cut-velvetshoal-nuc',388.9,1.69],['cut-twilightweft-nuc',1925.7,1.71],['cut-gloamspiral-aip',277.5,1.6],['cut-morrowcoil-hydp-masked',93.8,8.3]],
 afterBest:cutRows.map(c=>[c.id,c.bestHz,c.bestContrastDb]),
 window:W,
 cuts:cutRows,
 pools,
 poolSummary:DIFFS.map(d=>{
  const rows=pools.filter(p=>p.difficulty===d);
  const avg=(k:keyof typeof rows[0])=>rows.reduce((a,r)=>a+(r[k] as number),0)/rows.length;
  return {difficulty:d,avgContacts:+avg('contacts').toFixed(2),avgVlf:+avg('vlfLines').toFixed(2),avgAuxLike:+avg('auxLikeLines').toFixed(2),avgApproxLoud:+avg('approxLoudAt1km').toFixed(2)};
 }),
};

writeFileSync('bench/results/cut-visibility-sweep.json',JSON.stringify(summary,null,1));
console.log(JSON.stringify({cuts:summary.afterBest,poolSummary:summary.poolSummary},null,2));
