/** Deterministic machinery census and source-ablation diagnostic. No level changes.
 * Expected-power ablation separates a family from ambient/overlapping lines;
 * live RES NB samples include its native TPSW and stochastic row model.
 * Snapshot diagnostic only: not browser, retained-history, or pan/seek clearance. */
import {AcousticEngine,generateScenario,presetToParams,LofarGenerator,ResLofarGenerator,SplitWindowNormalizer} from '../src/index.js';
const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
const census:any[]=[];const examples:any[]=[];
for(const difficulty of ['easy','regular','difficult'] as const){
 let contacts=0,on=0,off=0,withVlfEda=0;let chosen:number|undefined;
 for(let seed=0;seed<24;seed++){
  const e=new AcousticEngine(generateScenario(presetToParams(difficulty,seed)));
  for(const c of e.scenario.contacts.filter(c=>c.category!=='surface')){
   contacts++;if(c.params.propulsion?.engines.some(x=>x.running))on++;else off++;
   if(c.params.tonals?.some(l=>l.lineFamily==='EDA'&&l.power>0&&l.hz>0&&l.hz<=200)){withVlfEda++;chosen??=seed;}
  }
 }
 census.push({difficulty,contacts,runningDiesel:on,other:off,withVlfEda});
 if(chosen===undefined)continue;
 const e=new AcousticEngine(generateScenario(presetToParams(difficulty,chosen)));e.advance(150);const s=e.scenario;
 const target=s.contacts.flatMap(c=>(c.lines??[]).filter(l=>l.lineFamily==='EDA'&&l.power>0&&l.hz>1&&l.hz<199)).sort((a,b)=>b.power-a.power)[0];
 if(!target)continue;
 const family=(mute:boolean)=>{const cs=structuredClone(s.contacts);if(mute)for(const c of cs)for(const l of [...c.lines??[],...c.params.tonals??[]])if(l.lineFamily==='EDA')l.power=0;return cs;};
 const band=(mute:boolean)=>{const g=new LofarGenerator(s.buoys[0],family(mute),1024,200,s.seed,s.environment);g.setWaterColumn(s.waterColumn);g.generate();const raw=Float32Array.from((g as unknown as {power:Float64Array}).power,x=>10*Math.log10(x));const norm=new Float32Array(1024);new SplitWindowNormalizer(1024,24,3).apply(raw,0,norm,0);return {raw,norm};};
 const bOn=band(false),bOff=band(true);let b=1;for(let i=1;i<1024;i++)if(bOn.raw[i]-bOff.raw[i]>bOn.raw[b]-bOff.raw[b])b=i;
 const res=(mute:boolean,r:2|5)=>{const g=new ResLofarGenerator(s.buoys[0],family(mute),s.fmax,s.seed,s.environment,{res:r,filter:'NB',vernierHz:b*200/1023});g.setWaterColumn(s.waterColumn);g.generate();const expected=Float64Array.from(g.expected);const rows:Float32Array[]=[];for(let n=0;n<64;n++){g.generate();rows.push(Float32Array.from(g.row));}return {expected,rows,f0:g.f0,df:g.fBin,L:g.liveBins};};
 const rs=[];for(const r of [2,5] as const){const a=res(false,r),z=res(true,r);let k=0,delta=-Infinity;for(let i=0;i<a.L;i++){if(a.f0+i*a.df<0||a.f0+i*a.df>200)continue;const d=10*Math.log10(a.expected[i]/z.expected[i]);if(d>delta){delta=d;k=i;}}
  rs.push({res:r,hz:a.f0+k*a.df,rawEdaContributionDb:delta,nativeNbOnMedianDb:median(a.rows.map(x=>x[k])),nativeNbOffMedianDb:median(z.rows.map(x=>x[k]))});
 }
 examples.push({difficulty,seed:chosen,simT:150,band:{hz:b*200/1023,rawEdaContributionDb:bOn.raw[b]-bOff.raw[b],normalizedOnDb:bOn.norm[b],normalizedOffDb:bOff.norm[b]},res:rs});
}
console.log(JSON.stringify({census,examples},null,2));
