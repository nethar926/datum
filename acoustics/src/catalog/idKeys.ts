import type {SubmarineClass,OperatingMode} from './schema.js';
import type {LineFamily} from '../sourceModel.js';
import {shaftDrivetrain,type SpeedWindowSpec} from './drivetrain.js';
export type Range=[number,number];
export interface IdKeys {
 gridHz:50|60;linesVisiblePerMode:Record<OperatingMode,LineFamily[]>;
 harmonicFamilies:{lineFamily:LineFamily;fundamentalHz:Range;orders:Range}[];
 ratios:{brToPsr:Range;msrToMotorShaft?:Range;msrToPsr?:Range;gear:Range;efrToCsr?:Range};
 bladeRateHz:Range;demonFundamentalHz:Range;tpk:Range;tpkMinKts?:number;
 cavitationOnsetKts:{depthM:0|100|300;speedKts:Range}[];
 engine?:{stroke:Range;cylinders:Range;erpm:Range};gearing:{kind:string;ratio:Range}[];
 turbineRateHz?:Range;/** Turbine vane-pass (VANE) fundamental = rotor Hz × vaneCount; nuclear classes only. */vaneRateHz?:Range;vaneCount?:Range;reductionRatio?:Range;gearMeshHz?:Range[];turboGenHz?:Range[];hydp?:{nominalHz:Range;pairSpacingHz:Range;durationS:Range};edas?:{name:string;cfrMultiple:Range}[];
 era:number;quietingTier:string;snorkVsBattery:string[];giveaways:string[];
 /** Lead: geared diesel that auto-declutches onto its propulsion motor when PSR×R:R leaves the engine band. */declutchToMotor?:boolean;
 speedWindows:{name:string;kind:'SWATH'|'SRC';speedKts:Range;loHz:number;hiHz:number}[];
}
const MODES:OperatingMode[]=['SURF','SNORK','D/E','BATT','AIP','NUC'];
/** Class-only teaching envelopes, not hull signatures. Conservative ±2% line-wander band
 * spans the invented 0.2%-sigma oscillator jitter, plus the full installed shaft mismatch.
 * No Doppler/range/environment effects are claimed; observational frequencies require correction. */
export function buildIdKeys(c:Omit<SubmarineClass,'idKeys'>):IdKeys {
 const p=c.machinery,mechanical='engines' in p,engines=mechanical?p.engines:[],m=c.shaftMismatchPct[1]/100,pad=1.02,psr=c.maxPsrpm/60*(1+m),br=psr*c.params.blades,maxErpm=engines.length?Math.max(...engines.map(e=>e.erpm.obsMax))*(1+m):0,csr=maxErpm/60,efr=engines.length?Math.max(...engines.map(e=>e.cylinders*(e.stroke===2?1:.5))):0;
 const motorRatio=p.motor?.drivetrain.ratio??1,slots=c.motorSlots??0,gears=[shaftDrivetrain(p),...(p.motor?[p.motor.drivetrain]:[])];let mesh=0;
 for(const d of gears){let input=psr*d.ratio;for(const s of d.stages){mesh=Math.max(mesh,input*s.pinionTeeth);input/=s.bullTeeth/s.pinionTeeth;}}
 const auxiliaries=c.aux.map(a=>a.fHz);for(const v of c.variants)for(const a of v.overrides.aux??[])auxiliaries.push(a.rate*(a.basis==='electrical'?c.params.electricalHz:1));
 const aux=Math.max(42,...auxiliaries),coolant='reactorSets' in p?Math.max(...p.reactorSets.map(r=>r.coolantPumpHz)):0,tg='reactorSets' in p?Math.max(...p.reactorSets.map(r=>r.turboGenerator.rpm/60)):0;
 const maxima:Partial<Record<LineFamily,number>>={PSR:psr,BR:br,GRID:Math.max(c.params.electricalHz,42),SRC:Math.max(...c.params.srcHzPerKn)*c.maxSpeedKts.submerged,AUX:aux+5}; // +5 Hz headroom for DC AUX absolute wander
 if(p.motor&&slots)maxima.MSR=p.motor.maxRpm/60*slots*(1+m);if(mesh)maxima.MESH=mesh;
 if(engines.length){maxima.CSR=csr;maxima.CFR=Math.max(...engines.map(e=>e.erpm.obsMax/60/(e.stroke===4?2:1)))*(1+m);maxima.EFR=csr*efr;if(c.edas.length)maxima.EDA=Math.max(...engines.map(e=>e.erpm.obsMax/60/(e.stroke===4?2:1)))*(1+m)*Math.max(...c.edas.map(e=>e.cfrMultiple));}
 if('mainTurbines' in p){maxima.TURBINE=p.mainTurbines.maxRpm/60*(1+m);maxima.VANE=maxima.TURBINE*p.mainTurbines.vaneCount;maxima.COOLANT=coolant;maxima.TG=tg;}
 for(const w of c.speedWindows??[])if(w.kind==='SRC')maxima.SRC=Math.max(maxima.SRC??0,w.hzPerKnot===undefined?w.hz:w.hzPerKnot*c.maxSpeedKts.submerged);
 const visible={} as Record<OperatingMode,LineFamily[]>;
 for(const mode of MODES){if((mechanical&&mode==='NUC')||(!mechanical&&!['NUC','AIP'].includes(mode))||(mode==='AIP'&&!c.aip)){visible[mode]=[];continue;}
  const list:LineFamily[]=['PSR','BR','GRID','SRC','AUX'],running=mechanical&&['SURF','SNORK','D/E'].includes(mode);if(running)list.push('CSR','CFR','EFR',...(c.edas.length?['EDA' as const]:[]));
  if(p.motor&&slots&&(!running||p.kind==='dieselElectric'||mode==='D/E'))list.push('MSR');if(shaftDrivetrain(p,mode).stages.length)list.push('MESH');if(!mechanical&&mode==='NUC')list.push('TURBINE','VANE','COOLANT','TG');visible[mode]=list;
 }
 const nuclear='mainTurbines' in p?{turbineRateHz:[p.kind==='nuclearElectric'?p.mainTurbines.maxRpm/60*.98:0,p.mainTurbines.maxRpm/60*(1+m)*pad] as Range,vaneRateHz:[p.kind==='nuclearElectric'?p.mainTurbines.maxRpm/60*.98*p.mainTurbines.vaneCount:0,p.mainTurbines.maxRpm/60*(1+m)*pad*p.mainTurbines.vaneCount] as Range,vaneCount:[p.mainTurbines.vaneCount,p.mainTurbines.vaneCount] as Range,reductionRatio:[p.mainTurbines.drivetrain.ratio,p.mainTurbines.drivetrain.ratio] as Range,gearMeshHz:p.mainTurbines.drivetrain.stages.map((g,i)=>{let hz=p.mainTurbines.maxRpm/60*(1+m);for(let k=0;k<i;k++)hz/=p.mainTurbines.drivetrain.stages[k].bullTeeth/p.mainTurbines.drivetrain.stages[k].pinionTeeth;return [0,hz*g.pinionTeeth*pad] as Range;}),turboGenHz:p.reactorSets.map(r=>[r.turboGenerator.rpm/60*.98,r.turboGenerator.rpm/60*pad] as Range)}:{};
 const ratio=(v:number):Range=>[v*.98,v*1.02];
 return {...nuclear,...(c.hydp?{hydp:{nominalHz:ratio(c.hydp.nominalHz),pairSpacingHz:ratio(c.hydp.pairSpacingHz),durationS:[c.hydp.durationS,c.hydp.durationS] as Range}}:{}),...(c.edas.length?{edas:c.edas.map(e=>({name:e.name,cfrMultiple:ratio(e.cfrMultiple)}))}:{}),...(c.declutchToMotor?{declutchToMotor:true}:{}),gridHz:c.params.electricalHz,linesVisiblePerMode:visible,harmonicFamilies:(Object.entries(maxima) as [LineFamily,number][]).map(([lineFamily,max])=>({lineFamily,fundamentalHz:[0,max*(lineFamily==='EDA'||lineFamily==='CSR'||lineFamily==='CFR'||lineFamily==='EFR'||lineFamily==='AUX'?pad*1.08:pad)],orders:[1,(lineFamily==='CSR'||lineFamily==='CFR'||lineFamily==='EFR'?6:lineFamily==='EDA'?3:3)]})),ratios:{brToPsr:ratio(c.params.blades),gear:[Math.min(...gears.map(g=>g.ratio)),Math.max(...gears.map(g=>g.ratio))],...(p.motor&&slots?{msrToMotorShaft:ratio(slots),msrToPsr:ratio(slots*motorRatio)}:{}),...(engines.length?{efrToCsr:[Math.min(...engines.map(e=>e.cylinders*(e.stroke===2?1:.5)))*.98,efr*1.02]}:{})},bladeRateHz:[0,br*pad],demonFundamentalHz:[0,br*pad],tpk:[c.tpk*(1-m)*.98,c.tpk*(1+m)*pad],...(c.tpkMinKts?{tpkMinKts:c.tpkMinKts}:{}),cavitationOnsetKts:([0,100,300] as const).map(depthM=>({depthM,speedKts:ratio(c.params.cavitation.surfaceInceptionKn*Math.sqrt(1+depthM*c.params.cavitation.depthCoefficient))})),...(engines.length?{engine:{stroke:[Math.min(...engines.map(e=>e.stroke)),Math.max(...engines.map(e=>e.stroke))] as Range,cylinders:[Math.min(...engines.map(e=>e.cylinders)),Math.max(...engines.map(e=>e.cylinders))] as Range,erpm:[0,maxErpm*pad] as Range}}:{}),gearing:gears.map(d=>({kind:d.kind,ratio:[d.ratio,d.ratio]})),era:c.era,quietingTier:c.quietingTier,snorkVsBattery:mechanical?['SNORK/SURF: CSR, CFR, EFR and engine-driven EDA','BATT: engines stop; motor slot lines and electrical inverter remain']:['Normal reactor/TG/coolant lines remain; backup AIP requires reactorOffline'],giveaways:[`${c.shafts} shaft${c.shafts>1?'s; harmonic doublets':' '}`,`${c.params.blades} blade orders per shaft order`,c.drivetrainLabel,`${c.era} / ${c.quietingTier}`,...(c.aip?['Rare backup AIP']:[]),...(c.emergencyPropulsor?['Emergency propulsor normally off']:[])],speedWindows:(c.speedWindows??[]).map((w:SpeedWindowSpec)=>{const speedKts=[...w.speedKts] as Range;return w.kind==='SRC'?{name:w.name,kind:w.kind,speedKts,loHz:(w.hzPerKnot===undefined?w.hz:w.hzPerKnot*w.speedKts[0])*.98,hiHz:(w.hzPerKnot===undefined?w.hz:w.hzPerKnot*w.speedKts[1])*pad}:{name:w.name,kind:w.kind,speedKts,loHz:w.loHz,hiHz:w.hiHz};})};
}
