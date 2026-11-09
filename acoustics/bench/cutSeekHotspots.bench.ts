/** Micro-breakdown of one CutSession mid-seek (orbelune + emberbraid + gloam). */
import {performance} from 'node:perf_hooks';
import {AcousticEngine} from '../src/engine.js';
import {scenarioFromCut,CUT_BINS,CUT_FMAX} from '../src/cuts/render.js';
import {STARTER_CUTS,looksOf,applyRuntimeFidelity} from '../src/cuts/index.js';
import {loadScenario} from '../src/scenario.js';
import type {TonalLine} from '../src/sourceModel.js';

const ROW_DT=.25;
const buf=new Float32Array(CUT_BINS);

for(const id of ['cut-orbelune-msr','cut-emberbraid-ssma','cut-gloamspiral-aip','cut-mistacorn-batt']){
 const cut=STARTER_CUTS.find(c=>c.id===id)!;
 const loaded=loadScenario(scenarioFromCut(cut));
 const engine=new AcousticEngine(loaded,cut.seed);
 const lofar=engine.subscribe({channel:1,kind:'lofar',bins:CUT_BINS,band:[0,CUT_FMAX]});
 const demon=engine.subscribe({kind:'demon',buoyId:1,band:[1000,Math.min(4000,CUT_FMAX)]});
 const contact=engine.scenario.contacts.find(c=>c.category!=='surface')??engine.scenario.contacts[0];
 const ramp=new Map<TonalLine,number>(),eng=new Map<TonalLine,number>();
 if(looksOf(cut).has('propulsion-ramp')){
  for(const l of contact.params.tonals??[])if(l.lineFamily==='EDA')ramp.set(l,l.power);
 }
 const mid=cut.durationS*.5;
 let tAdv=0,tFid=0,tWrite=0,tReadyWait=0,rows=0;
 const t0=performance.now();
 while(engine.time<mid){
  let t=performance.now();
  while(engine.rowsReady(lofar.streamId)===0){
   if(engine.time>=cut.durationS)break;
   const dt=Math.min(ROW_DT,cut.durationS-engine.time);
   const a0=performance.now();
   engine.advance(dt);
   tAdv+=performance.now()-a0;
   const f0=performance.now();
   applyRuntimeFidelity(contact.params,cut,engine.time,ramp,eng);
   tFid+=performance.now()-f0;
   tReadyWait+=performance.now()-t;
   t=performance.now();
  }
  const w0=performance.now();
  if(engine.writeRow(lofar.streamId,buf)<0)break;
  // also drain demon if ready (CutSession writeLofarRow doesn't always, but ensureLofar advances both)
  if(engine.rowsReady(demon)>0)engine.writeRow(demon,new Float32Array(512));
  tWrite+=performance.now()-w0;
  rows++;
 }
 const total=performance.now()-t0;
 const gen=engine['generators']?.[0];
 const nt=contact.params.tonals?.length??0;
 console.log(JSON.stringify({id,rows,tonals:nt,totalMs:+total.toFixed(1),advanceMs:+tAdv.toFixed(1),fidelityMs:+tFid.toFixed(1),writeMs:+tWrite.toFixed(1),msPerRow:+(total/rows).toFixed(4),writePerRow:+(tWrite/rows).toFixed(4),advPerRow:+(tAdv/rows).toFixed(4)}));
 engine.unsubscribe(lofar.streamId);engine.unsubscribe(demon);
}
