import {deriveSeed,mulberry32} from '../prng.js';
import {tagLine,type Signature,type TonalFamily,type LineProfile} from '../sourceModel.js';
import {shaftDrivetrain,firingRateHz,edaFrequencyHz,type VesselPlantSpec,type PropulsionTruth,type Plant,drivetrainCode,drivetrainLabel} from './drivetrain.js';
import {normalizeMode,type ModeInput,type OperatingMode} from './schema.js';
interface State {spec:VesselPlantSpec;factors:Float64Array;selected:Uint8Array;truth:PropulsionTruth}
const states=new WeakMap<Signature,State>();
function enginesEnabled(p:Plant,mode:OperatingMode):boolean{return p.kind==='dieselDirect'?(mode==='SNORK'||mode==='SURF'||mode==='D/E'):mode!=='BATT'&&mode!=='AIP';}
const AIP_HZ={stirling:28,fuelcell:42,'closed-cycle':34} as const;
const NO_GATES:readonly import('./drivetrain.js').SpeedGated[]=[];
const NO_SRCS:readonly number[]=[];
const DEFAULT_HARMONICS=[1,2,3] as const;
/** Configuration only: independent contact streams for installed-shaft mismatch and engine selection.
 * Static selection, no duty/ramp/event simulation. No catalog sheet is randomized. */
export function configurePropulsion(s:Signature,seed=0,contactId='catalog',mode:ModeInput='NUC'):PropulsionTruth {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);
 const spec=s.plantSpec;
 if(!spec){const truth:PropulsionTruth={kind:'unspecified',tpk:0,tpkValid:false,propulsor:{shafts:s.shafts??1,blades:s.blades,bladeType:'flat',brHz:s.shaftHz*s.blades},mode:mode as OperatingMode,drivetrainCode:'unspecified',drivetrainLabel:'unspecified',ratio:1,ratioLabel:'1.00:1',engines:[],stages:[],shafts:Array.from({length:s.shafts??1},()=>({rpm:s.shaftHz*60,hz:s.shaftHz,coupled:false}))};s.propulsion=truth;return truth;}
 const p=spec.machinery,d=shaftDrivetrain(p,mode),electrical=s.electricalHz??60,diesel=p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric',engines=diesel?p.engines:[],rng=mulberry32(deriveSeed(seed,`${contactId}:engines`)),selected=new Uint8Array(engines.length),factors=new Float64Array(spec.shafts);let count=0;
 for(let i=0;i<engines.length;i++){selected[i]=p.kind==='dieselDirect'||rng()<.65?1:0;count+=selected[i];}if(engines.length&&!count)selected[Math.floor(rng()*engines.length)]=1;
 factors[0]=1;for(let i=1;i<factors.length;i++){const r=mulberry32(deriveSeed(seed,`${contactId}:shaft:${i}`)),delta=(spec.shaftMismatchPct[0]+r()*(spec.shaftMismatchPct[1]-spec.shaftMismatchPct[0]))/100;factors[i]=1+(r()<.5?-delta:delta);}
 const truth:PropulsionTruth={kind:p.kind,tpk:spec.tpk??0,tpkValid:false,...(spec.tpkMinKts?{tpkMinKts:spec.tpkMinKts}:{}),propulsor:{shafts:spec.shafts,blades:s.blades,bladeType:spec.propeller?.type??'flat',brHz:0},...(spec.emergencyPropulsor?{emergencyPropulsor:{active:false,rpm:0,hz:0,blades:spec.emergencyPropulsor.blades}}:{}),mode:mode as OperatingMode,drivetrainCode:drivetrainCode(p),drivetrainLabel:drivetrainLabel(p),...(spec.aip?{aip:{kind:spec.aip.kind,active:mode==='AIP'}}:{}),ratio:d.ratio,ratioLabel:d.ratioLabel,engines:engines.map(e=>({id:e.id,stroke:e.stroke,cylinders:e.cylinders,erpm:0,running:false,csrHz:0,cfrHz:0,efrHz:0})),stages:d.stages.map(g=>({...g,ratio:g.bullTeeth/g.pinionTeeth,meshHz:0})),shafts:Array.from({length:spec.shafts},()=>({rpm:0,hz:0,coupled:false})),generators:Array.from({length:diesel?(p.kind==='dieselElectric'?engines.length:1):('turbineGenerators' in p?p.turbineGenerators.count:0)},()=>({rpm:0,hz:electrical})),...(p.motor?{motor:{rpm:0,shaftHz:0,slots:spec.motorSlots??0,msrHz:0}}:{})};
 states.set(s,{spec,factors,selected,truth});s.propulsion=truth;return truth;
}
/** Fill the preallocated nested truth in Hz/RPM. D/E generator RPM is independent of speed.
 * A stopped D/E generator leaves the 50/60-Hz inverter bus; direct diesels use service sets. */
export function updatePropulsion(s:Signature,fraction:number,mode:ModeInput):PropulsionTruth {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);
 let state=states.get(s);if(!state){configurePropulsion(s,0,'catalog',mode);state=states.get(s);}if(!state)return s.propulsion!;
 const {spec,truth:t,factors,selected}=state,p=spec.machinery,d=shaftDrivetrain(p,mode),hz=spec.maxPsrpm/60*Math.max(0,Math.min(1,fraction)),electrical=s.electricalHz??60;
 const adjusted=fraction>0&&spec.tpk&&spec.tpkMinKts?Math.max(fraction,spec.tpk*spec.tpkMinKts/spec.maxPsrpm):fraction;
 for(let i=0;i<t.shafts.length;i++){const shaft=t.shafts[i];shaft.rpm=spec.maxPsrpm*Math.max(0,Math.min(1,adjusted))*factors[i];shaft.hz=shaft.rpm/60;shaft.coupled=(p.kind==='dieselDirect'||p.kind==='dieselGR')?enginesEnabled(p,mode)&&mode!=='D/E':p.kind==='nuclearGR'&&mode!=='AIP';}
 if(p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric'){
  const enabled=enginesEnabled(p,mode);for(let i=0;i<t.engines.length;i++){const e=t.engines[i];e.running=enabled&&selected[i]!==0&&(p.kind==='dieselElectric'||mode==='D/E'||hz>0);e.erpm=e.running?(p.kind==='dieselElectric'||mode==='D/E'?p.engines[i].erpm.normal:(p.kind==='dieselDirect'?t.shafts[i%t.shafts.length].rpm:t.shafts[0].rpm*d.ratio)):0;e.csrHz=e.erpm/60;e.cfrHz=e.csrHz/(e.stroke===4?2:1);e.efrHz=firingRateHz(e,e.erpm);}
  for(let i=0;i<t.generators!.length;i++){const g=t.generators![i];g.rpm=p.kind==='dieselElectric'?t.engines[i].erpm:electrical*60/2;g.hz=g.rpm/60*(p.kind==='dieselElectric'?p.generator!.polePairs:2);}
 }else if('turbineGenerators' in p)for(let i=0;i<t.generators!.length;i++){const g=t.generators![i],r=p.reactorSets[i]?.turboGenerator??p.turbineGenerators;g.rpm=r.rpm;g.hz=g.rpm/60*r.polePairs;}
 if(t.motor){t.motor.rpm=(p.kind==='dieselDirect'||p.kind==='dieselGR')&&enginesEnabled(p,mode)&&mode!=='D/E'?0:t.shafts[0].rpm*p.motor!.drivetrain.ratio;t.motor.shaftHz=t.motor.rpm/60;t.motor.msrHz=t.motor.shaftHz*t.motor.slots;}
 if(mode==='AIP'){if(!spec.aip||((p.kind==='nuclearGR'||p.kind==='nuclearElectric')&&!s.reactorOffline))throw new Error('AIP backup requires capability and reactor-off for nuclear');for(const g of t.generators!){g.hz=AIP_HZ[spec.aip.kind];g.rpm=g.hz*60/2;}}
 t.tpkValid=!!spec.tpk&&(!spec.tpkMinKts||fraction*spec.maxPsrpm/spec.tpk+1e-9>=spec.tpkMinKts);t.propulsor.brHz=t.shafts[0].hz*s.blades;if(t.stages.length!==d.stages.length||t.ratio!==d.ratio)throw new Error('Reconfigure static mode before changing drivetrain');t.mode=mode as OperatingMode;if(t.aip)t.aip.active=mode==='AIP';let input=t.shafts[0].hz*d.ratio;for(const g of t.stages){g.meshHz=input*g.pinionTeeth;input/=g.ratio;}return t;
}
function put(s:Signature,i:number,family:TonalFamily,hz:number,power:number,harmonic:number,shaftIndex?:number,engineIndex?:number,profile?:LineProfile,reactorId?:string,operatorFamily?:'COOLANT'|'TG'):void {
 let l=s.tonals![i];if(!l)l=s.tonals![i]={family,hz,power};if(family!=='eda')l.eda=undefined;l.reactorId=reactorId;l.family=family;l.hz=hz;l.power=power;l.harmonic=harmonic;l.shaftIndex=shaftIndex;l.engineIndex=engineIndex;l.engineId=engineIndex===undefined?undefined:s.propulsion!.engines[engineIndex].id;l.lineFamily=operatorFamily??(family==='shaft'?'PSR':family==='blade'?'BR':family==='electrical'?'GRID':family==='src'?'SRC':family==='motor'&&shaftIndex===0?'MSR':family==='crank'?'CSR':family==='cylinder'?'CFR':family==='diesel'?'EFR':family==='eda'?'EDA':family==='gear'?'MESH':family==='turbine'?'TURBINE':family==='pump'||family==='motor'?'AUX':undefined);const engine=engineIndex===undefined?undefined:s.propulsion!.engines[engineIndex];l.fundamentalHz=family==='shaft'?s.propulsion!.shafts[shaftIndex!].hz:family==='blade'?s.propulsion!.shafts[shaftIndex!].hz*s.blades:family==='motor'&&shaftIndex===0?s.propulsion!.motor!.msrHz:family==='crank'?engine!.csrHz:family==='cylinder'?engine!.cfrHz:family==='diesel'?engine!.efrHz:l.lineFamily?hz/harmonic:undefined;tagLine(l,i,profile??s.lineProfiles?.[family]);
}
/** Public rotation orders only (Urick/Ross); relative powers are invented. Fixed topology
 * for a fixed mode: inactive installed engines keep zero-power slots; updates reuse records. */
export function writePlantTonals(s:Signature,mode:ModeInput,electricalHarmonics:readonly number[]=DEFAULT_HARMONICS,srcHzPerKn:readonly number[]=NO_SRCS,speedKn=0):void {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);const spec=s.plantSpec!,p=spec.machinery,t=s.propulsion!;let i=0;
 for(let shaft=0;shaft<t.shafts.length;shaft++){const hz=t.shafts[shaft].hz;for(let h=1;h<=3;h++){put(s,i++,'shaft',hz*h,hz>0?.1/(h*h):0,h,shaft);put(s,i++,'blade',hz*s.blades*h,hz>0?.25/(h*h):0,h,shaft);}}
 for(const h of electricalHarmonics)put(s,i++,'electrical',(mode==='AIP'?AIP_HZ[spec.aip!.kind]:(s.electricalHz??60))*h,.04/(h*h),h);
 if(p.motor){for(let h=1;h<=3;h++)put(s,i++,'motor',(t.motor!.slots?t.motor!.msrHz:t.motor!.shaftHz)*h,t.motor!.rpm>0?.05/(h*h):0,h,t.motor!.slots?0:undefined);}
 if(enginesEnabled(p,mode))for(let e=0;e<t.engines.length;e++){const engine=t.engines[e];for(let h=1;h<=3;h++){put(s,i++,'crank',engine.csrHz*h,engine.running?.04/(h*h):0,h,undefined,e);put(s,i++,'diesel',engine.efrHz*h,engine.running?.15/(h*h):0,h,undefined,e);put(s,i++,'cylinder',engine.cfrHz*h,engine.running?.025/(h*h):0,h,undefined,e);}for(const eda of spec.edas)for(const h of eda.harmonics){const at=i++;put(s,at,'eda',edaFrequencyHz(engine.cfrHz,eda.cfrMultiple)*h,engine.running?.035/(h*h):0,h,undefined,e);const l=s.tonals![at];l.eda??={name:eda.name,cfrMultiple:eda.cfrMultiple};l.eda.name=eda.name;l.eda.cfrMultiple=eda.cfrMultiple;}}
 if(mode!=='AIP'&&(p.kind==='nuclearGR'||p.kind==='nuclearElectric')){const n=p.kind==='nuclearGR'?t.shafts.length:1;for(let shaft=0;shaft<n;shaft++){const rpm=p.kind==='nuclearGR'?t.shafts[shaft].rpm*t.ratio:p.mainTurbines.maxRpm;for(let h=1;h<=3;h++)put(s,i++,'turbine',rpm/60*h,rpm>0?.04*p.mainTurbines.count/n/(h*h):0,h,shaft);}}
 for(let shaft=0;shaft<t.shafts.length;shaft++){const ratio=t.shafts[0].hz>0?t.shafts[shaft].hz/t.shafts[0].hz:1;for(const g of t.stages)for(let h=1;h<=3;h++)put(s,i++,'gear',g.meshHz*ratio*h,g.meshHz>0?.035/(h*h):0,h,shaft);}
 if(mode!=='AIP'&&('reactorSets' in p))for(const r of p.reactorSets)for(let h=1;h<=3;h++){put(s,i++,'pump',r.coolantPumpHz*h,.04/(h*h),h,undefined,undefined,undefined,r.id,'COOLANT');put(s,i++,'turbine',r.turboGenerator.rpm/60*h,.025/(h*h),h,undefined,undefined,undefined,r.id,'TG');}
 if(mode==='AIP'){for(let h=1;h<=2;h++)put(s,i++,'pump',AIP_HZ[spec.aip!.kind]*.5*h,.025/(h*h),h);}else for(const a of spec.aux)if(a.kind!=='hydp')for(const h of a.harmonics)put(s,i++,a.kind==='acPump'||a.kind==='ssma'?'pump':'motor',a.fHz*h,.025/(h*h),h,undefined,undefined,a);
 for(const w of s.speedGated??NO_GATES)if(w.kind==='SRC')for(let h=1;h<=2;h++)put(s,i++,'src',w.hz*h,.04*w.gain/(h*h),h);
 for(const rate of srcHzPerKn)put(s,i++,'src',speedKn*rate,speedKn>0?.06:0,1);
 s.tonals!.length=i;
}
