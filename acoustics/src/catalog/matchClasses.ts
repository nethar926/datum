import {buildCompendium} from './compendium.js';
import type {IdKeys,Range} from './idKeys.js';
import type {OperatingMode} from './schema.js';
import type {LineFamily} from '../sourceModel.js';
/** Source-frame observations only; correct receiver Doppler first. No truth or hull lookup. */
export interface ClassObservations {
 gridHz?:number;mode?:OperatingMode;lineFamilies?:readonly LineFamily[];
 familyFundamentalsHz?:Partial<Record<LineFamily,number>>;
 brToPsr?:number;msrToMotorShaft?:number;msrToPsr?:number;gearRatio?:number;efrToCsr?:number;tpk?:number;
 turbineRateHz?:number;reductionRatio?:number;gearMeshHz?:number;turboGenHz?:number;hydpHz?:number;
 edaCfrMultiples?:readonly number[];
 /** Observed SRC lines / SWATH bands (source-frame Hz); optional estimated speed in knots. */
 speedWindows?:readonly {kind:'SWATH'|'SRC';hz?:number;loHz?:number;hiHz?:number;speedKts?:number}[];
}
export interface ClassMatch {id:string;score:number;matched:string[];ruledOutBy:string[]}
const inside=(v:number,r:Range|undefined):boolean=>!!r&&Number.isFinite(v)&&v>=r[0]&&v<=r[1];
/** One-knot edge fade: speeds within 1 kt of the design window still count. */
const speedOk=(speed:number|undefined,r:Range):boolean=>speed===undefined||(Number.isFinite(speed)&&speed>=r[0]-1&&speed<=r[1]+1);
const overlapFrac=(lo:number,hi:number,wLo:number,wHi:number):number=>{const width=hi-lo;if(!(width>0)||!Number.isFinite(lo)||!Number.isFinite(hi))return 0;return Math.max(0,Math.min(hi,wHi)-Math.max(lo,wLo))/width;}
/** Pure ranged-key comparison. Score is the fraction of supplied constraints that agree,
 * not a probability; ruledOutBy records contradictions. Empty observations score zero.
 * Optional source is deliberately restricted to the exported class-only catalog view. */
export function matchClasses(observations:ClassObservations,source:readonly {id:string;idKeys:IdKeys}[]=buildCompendium().classes):ClassMatch[] {
 return source.map(({id,idKeys:k})=>{
  const matched:string[]=[],ruledOutBy:string[]=[],check=(name:string,ok:boolean)=>{(ok?matched:ruledOutBy).push(name);};
  const ranged=(name:string,value:number|undefined,r:Range|undefined)=>{if(value!==undefined)check(name,inside(value,r));};
  if(observations.gridHz!==undefined)check('gridHz',observations.gridHz===k.gridHz);
  const mode=observations.mode,visible=mode===undefined?k.harmonicFamilies.map(f=>f.lineFamily):k.linesVisiblePerMode[mode]??[];
  if(mode!==undefined)check('mode',visible.length>0);
  for(const f of observations.lineFamilies??[])check(`lineFamily:${f}`,visible.includes(f));
  for(const [family,hz] of Object.entries(observations.familyFundamentalsHz??{})){
   const r=k.harmonicFamilies.find(f=>f.lineFamily===family);check(`fundamental:${family}`,visible.includes(family as LineFamily)&&inside(hz,r?.fundamentalHz));
  }
  ranged('brToPsr',observations.brToPsr,k.ratios.brToPsr);ranged('msrToMotorShaft',observations.msrToMotorShaft,k.ratios.msrToMotorShaft);ranged('msrToPsr',observations.msrToPsr,k.ratios.msrToPsr);
  ranged('gearRatio',observations.gearRatio,k.ratios.gear);ranged('efrToCsr',observations.efrToCsr,k.ratios.efrToCsr);ranged('tpk',observations.tpk,k.tpk);
  ranged('turbineRateHz',observations.turbineRateHz,k.turbineRateHz);ranged('reductionRatio',observations.reductionRatio,k.reductionRatio);ranged('hydpHz',observations.hydpHz,k.hydp?.nominalHz);
  if(observations.gearMeshHz!==undefined)check('gearMeshHz',!!k.gearMeshHz?.some(r=>inside(observations.gearMeshHz!,r)));
  if(observations.turboGenHz!==undefined)check('turboGenHz',!!k.turboGenHz?.some(r=>inside(observations.turboGenHz!,r)));
  for(const v of observations.edaCfrMultiples??[])check(`edaCfrMultiple:${v}`,!!k.edas?.some(e=>inside(v,e.cfrMultiple)));
  for(const obs of observations.speedWindows??[]){
   const windows=k.speedWindows.filter(w=>w.kind===obs.kind);
   if(!windows.length){check(obs.kind,false);continue;}
   if(obs.kind==='SRC')check('SRC',windows.some(w=>inside(obs.hz!,[w.loHz,w.hiHz])&&speedOk(obs.speedKts,w.speedKts)));
   else check('SWATH',windows.some(w=>overlapFrac(obs.loHz!,obs.hiHz!,w.loHz,w.hiHz)>=.5&&speedOk(obs.speedKts,w.speedKts)));
  }
  const count=matched.length+ruledOutBy.length;return {id,score:count?matched.length/count:0,matched,ruledOutBy};
 }).sort((a,b)=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0));
}
