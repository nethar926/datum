import type {ModeInput,OperatingMode} from './schema.js';
import type {LineStability,LineWidth} from '../sourceModel.js';
/** Public machine kinematics (Urick/Ross): shaft/mesh orders, cylinders and electrical poles.
 * Every dimension and oscillator strength in the accompanying catalog is invented. */
export type DieselDrivetrainCode='D/D'|'D/GR'|'DEL';
export type DrivetrainCode=DieselDrivetrainCode|'N/GR'|'NEL';
export function drivetrainCode(p:Plant):DrivetrainCode{return ({dieselDirect:'D/D',dieselGR:'D/GR',dieselElectric:'DEL',nuclearGR:'N/GR',nuclearElectric:'NEL'} as const)[p.kind];}
export function drivetrainLabel(p:Plant):string{return p.kind==='dieselElectric'?'DIESEL ELECTRIC':drivetrainCode(p);}
export interface EngineSpec {id:string;stroke:2|4;cylinders:number;erpm:{obsMin:number;obsMax:number;normal:number}}
export interface GearStage {pinionTeeth:number;bullTeeth:number}
export interface Drivetrain {kind:'direct'|'gr1'|'gr2';stages:GearStage[];ratio:number;ratioLabel:string}
export interface MotorSpec {maxRpm:number;drivetrain:Drivetrain}
export interface DieselPlant {kind:'dieselDirect'|'dieselGR'|'dieselElectric';engines:EngineSpec[];drivetrain?:Drivetrain;generator?:{polePairs:number};motor?:MotorSpec}
export interface ReactorSet {id:string;coolantPumpHz:number;turboGenerator:{rpm:number;polePairs:number}}
export interface EmergencyPropulsorSpec {maxRpm:number;blades:number;maxSpeedKts:number}
export interface NuclearPlant {reactors:number;reactorSets:ReactorSet[];kind:'nuclearGR'|'nuclearElectric';mainTurbines:{count:number;maxRpm:number;drivetrain:Drivetrain;/** Fictional teaching vane count per main-turbine stage; vane-pass = rotor Hz × vaneCount. Not a real platform figure. */vaneCount:number};turbineGenerators:{count:number;rpm:number;polePairs:number};motor?:MotorSpec}
export type Plant=DieselPlant|NuclearPlant;
/** Intermittent duty on/off is simulated via Signature.dutyClockS (see intermittentDutyGain). */
export interface DutySpec {onMedianS:number;offMedianS:number;sigma:number}
export interface EdaSpec {id:string;name:string;cfrMultiple:number;perCrankRev?:number;harmonics:number[];ramp?:{riseS:number;fallS:number};modes?:OperatingMode[]}
export type AuxEdge='fade'|'abrupt'|'knee';
export interface AuxSpec {id:string;kind:'electrical'|'acvr'|'dcvr'|'ssma'|'hydp'|'acPump';fHz:number;harmonics:number[];stability:LineStability;width:LineWidth;sigmaBins?:number;duty:'continuous'|'intermittent';dutyOnS?:[number,number];dutyOffS?:[number,number];/** On/off edge for intermittent sources (Wilson). */edge?:AuxEdge}
export interface AipSpec {kind:'stirling'|'fuelcell'|'closed-cycle';powerKw:number;maxSpeedKts:number;enduranceDays:number}
export type SpeedWindowSpec={name:string;kind:'SRC';speedKts:[number,number];hz:number;hzPerKnot?:number}|{name:string;kind:'SWATH';speedKts:[number,number];loHz:number;hiHz:number};
export type SpeedGated={name:string;kind:'SRC';hz:number;active:boolean;gain:number}|{name:string;kind:'SWATH';loHz:number;hiHz:number;active:boolean;gain:number};
export interface PropellerSpec {shafts:number;blades:number;type:'flat'|'skewed'|'cpp'}
export interface HydpSpec {nominalHz:number;pairSpacingHz:number;durationS:number}
/** Class-specific unintentional narrowband transient (Wilson). */
export interface ClassTransientSpec {id:string;name:string;hz:number;harmonics:number[];durationS:number}
/** PRES (prop resonance), fictional. FREQUENCIES are always shaft-synchronous: line n sits at n·PSR for every
 * integer n in [nCentre−halfWidth, nCentre+halfWidth] (Wilson: resonance shares PSR spacing, ∝ PSR).
 * The AMPLITUDE ENVELOPE is a separate weight defined in PSR orders (raised cosine about nCentre), so the
 * whole cluster, centre included, scales with PSR. No fixed natural-frequency envelope. levelDb is the
 * envelope peak relative to the PSR h=1 line. Optional [onsetKn, offsetKn] speed band with ~0.5 kn edges.
 * No physics-side merging: each shaft emits its own n·PSR lines; each stream's FFT bin decides doublets. */
export interface PropResonanceSpec {nCentre:number;halfWidth:number;levelDb:number;onsetKn?:number;offsetKn?:number;stability:LineStability}
export interface VesselPlantSpec {classTransients?:ClassTransientSpec[];/** Optional BR1 power boost on DEMON/LOFAR teaching. */reinforceBr1?:boolean;/** Optional: emit PSR harmonics only through blade count. */psrHarmonicsStopAtBlades?:boolean;propResonance?:PropResonanceSpec;/** Geared diesel with a clutch-shift onto its propulsion motor: an out-of-band coupled command auto-declutches. Unflagged coupled plants reject such commands. */declutchToMotor?:boolean;propeller?:PropellerSpec;hydp?:HydpSpec;tpk?:number;tpkMinKts?:number;speedWindows?:SpeedWindowSpec[];emergencyPropulsor?:EmergencyPropulsorSpec;motorSlots?:number;aip?:AipSpec;maxPsrpm:number;shafts:number;shaftMismatchPct:[number,number];machinery:Plant;edas:EdaSpec[];aux:AuxSpec[]}
export interface PropulsionTruth {
 kind:Plant['kind']|'unspecified';tpk:number;tpkValid:boolean;tpkMinKts?:number;propulsor:{shafts:number;blades:number;bladeType:PropellerSpec['type'];brHz:number};emergencyPropulsor?:{active:boolean;rpm:number;hz:number;blades:number};mode:OperatingMode;drivetrainCode:DrivetrainCode|'unspecified';drivetrainLabel:string;aip?:{kind:AipSpec['kind'];active:boolean};ratio:number;ratioLabel:string;
 /** Speed window where PSR×R:R sits inside every engine's own erpmMin–erpmMax (coupled D/D & GR). */
 coupledSpeedKn?:{min:number;max:number};
 /** True when a clutched mode was requested but PSR×R:R left the engine band (motor declutch or invalid). */
 declutched?:boolean;
 /** Coupled command check: 'rejected' when PSR×R:R would leave the engine band on a plant without declutchToMotor (previous valid command held). */
 commandStatus?:'ok'|'rejected';
 /** True when an engine-ramp knee was bounded so coupled ERPM stays inside the band (unflagged plants). */
 kneeLimited?:boolean;
 engines:{id:string;stroke:2|4;cylinders:number;erpm:number;running:boolean;csrHz:number;cfrHz:number;efrHz:number}[];
 stages:{pinionTeeth:number;bullTeeth:number;ratio:number;meshHz:number}[];
 shafts:{rpm:number;hz:number;coupled:boolean}[];motor?:{rpm:number;shaftHz:number;slots:number;msrHz:number};generators?:{rpm:number;hz:number}[];
}
const finite=(x:unknown,lo:number,hi:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=lo&&x<=hi;
const gcd=(a:number,b:number):number=>{while(b){const t=b;b=a%b;a=t;}return a;};
export function drivetrainRatio(d:Pick<Drivetrain,'stages'>):number {let r=1;for(const s of d.stages)r*=s.bullTeeth/s.pinionTeeth;return r;}
export function makeDrivetrain(kind:Drivetrain['kind'],stages:GearStage[]=[]):Drivetrain {const ratio=drivetrainRatio({stages}),d={kind,stages,ratio,ratioLabel:`${ratio.toFixed(2)}:1`};validateDrivetrain(d);return d;}
export function validateDrivetrain(d:Drivetrain):void {
 if(!d||!['direct','gr1','gr2'].includes(d.kind)||!Array.isArray(d.stages)||d.stages.length!==({direct:0,gr1:1,gr2:2}[d.kind]))throw new Error('Invalid drivetrain stage count');
 for(const s of d.stages)if(!s||!Number.isInteger(s.pinionTeeth)||!Number.isInteger(s.bullTeeth)||!finite(s.pinionTeeth,5,300)||!finite(s.bullTeeth,s.pinionTeeth+1,600)||gcd(s.pinionTeeth,s.bullTeeth)!==1)throw new Error('Gear teeth must be coprime hunting-tooth pairs');
 const r=drivetrainRatio(d);if(!finite(d.ratio,1,1000)||Math.abs(r-d.ratio)>1e-10||d.ratioLabel!==`${r.toFixed(2)}:1`)throw new Error('Derived drivetrain ratio/label mismatch');
}
/** Total firings/s: one event/cylinder/revolution (2 stroke), per two revolutions (4 stroke). */
export function firingRateHz(engine:Pick<EngineSpec,'stroke'|'cylinders'>,erpm:number):number{return erpm/60*engine.cylinders*(engine.stroke===2?1:.5);}
/** Fictional engine-driven auxiliary order: CFR multiples need not be integer harmonics. */
export function edaFrequencyHz(cfrHz:number,cfrMultiple:number):number{return cfrHz*cfrMultiple;}
/** Turbine vane-pass rate: rotor rotation rate times the (fictional) vane count. */
export function vanePassHz(rotorHz:number,vaneCount:number):number{return rotorHz*vaneCount;}
/** Each mesh has identical frequency on pinion and bull sides. Writes Hz without allocation. */
export function meshRates(d:Drivetrain,inputHz:number,out:Float64Array|Float32Array):typeof out {if(out.length<d.stages.length)throw new RangeError('Short mesh buffer');let hz=inputHz;for(let i=0;i<d.stages.length;i++){out[i]=hz*d.stages[i].pinionTeeth;hz/=d.stages[i].bullTeeth/d.stages[i].pinionTeeth;}return out;}
export function shaftDrivetrain(p:Plant,mode?:ModeInput):Drivetrain {if((mode==='BATT'||mode==='AIP'||mode==='D/E')&&p.motor)return p.motor.drivetrain;return p.kind==='dieselElectric'||p.kind==='nuclearElectric'?p.motor!.drivetrain:'mainTurbines' in p?p.mainTurbines.drivetrain:p.drivetrain!;}
export function validateVesselPlant(s:VesselPlantSpec,electricalHz:50|60):void {
 if(!s||!finite(s.maxPsrpm,20,1200)||!Number.isInteger(s.shafts)||!finite(s.shafts,1,3)||!Array.isArray(s.shaftMismatchPct)||s.shaftMismatchPct.length!==2||!finite(s.shaftMismatchPct[0],0,2)||!finite(s.shaftMismatchPct[1],s.shaftMismatchPct[0],2))throw new Error('Invalid vessel shaft envelope');
 if(s.aip&&(!['stirling','fuelcell','closed-cycle'].includes(s.aip.kind)||!finite(s.aip.powerKw,1,1000)||!finite(s.aip.maxSpeedKts,1,8)||!finite(s.aip.enduranceDays,.1,90)))throw new Error('Invalid AIP backup');
 if(s.speedWindows)for(const w of s.speedWindows)if(!w||!w.name||!Array.isArray(w.speedKts)||w.speedKts.length!==2||!finite(w.speedKts[0],0,45)||!finite(w.speedKts[1],w.speedKts[0],45)||(w.kind==='SRC'?(!finite(w.hz,.01,1e5)||(w.hzPerKnot!==undefined&&!finite(w.hzPerKnot,.01,100))):w.kind!=='SWATH'||!finite(w.loHz,0,1e5)||!finite(w.hiHz,w.loHz+1e-6,1e5)))throw new Error('Invalid speed window');
 if(s.propResonance){const r=s.propResonance;if(!Number.isInteger(r.nCentre)||!Number.isInteger(r.halfWidth)||!finite(r.halfWidth,1,6)||!finite(r.nCentre,r.halfWidth+2,120)||!finite(r.levelDb,-20,6)||!['stable','unstable'].includes(r.stability)||(r.onsetKn!==undefined&&!finite(r.onsetKn,0,45))||(r.offsetKn!==undefined&&!finite(r.offsetKn,(r.onsetKn??0)+1,45)))throw new Error('Invalid prop resonance');}
 if(s.declutchToMotor&&(s.machinery?.kind!=='dieselGR'||!s.machinery.motor))throw new Error('declutchToMotor needs a geared diesel with a propulsion motor');
 const p=s.machinery;if(!p||!['dieselDirect','dieselGR','dieselElectric','nuclearGR','nuclearElectric'].includes(p.kind))throw new Error('Invalid plant');let rated=0;
 if(p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric'){
  if(!Array.isArray(p.engines)||!p.engines.length||p.engines.length>6||new Set(p.engines.map(e=>e?.id)).size!==p.engines.length)throw new Error('Invalid engine list');
  for(const e of p.engines){if(!e||typeof e.id!=='string'||!e.id||(e.stroke!==2&&e.stroke!==4)||(e.stroke===2?e.cylinders!==6:![6,8,10,12,16].includes(e.cylinders))||!e.erpm||!finite(e.erpm.obsMin,0,2000)||!finite(e.erpm.obsMax,30,2000)||!finite(e.erpm.normal,e.erpm.obsMin,e.erpm.obsMax)||e.erpm.obsMin>=e.erpm.obsMax)throw new Error('Invalid engine stroke/cylinder/ERPM sheet');}
  
  if(p.kind==='dieselElectric'){
   if(p.drivetrain!==undefined)throw new Error('D/E engines are not shaft-coupled');
   if(!p.generator||!Number.isInteger(p.generator.polePairs)||!finite(p.generator.polePairs,1,24)||p.engines.some(e=>Math.abs(e.erpm.normal/60*p.generator!.polePairs-electricalHz)>1e-9)||!p.motor)throw new Error('Generator RPM/poles must match force bus frequency');
   rated=p.motor.maxRpm/p.motor.drivetrain.ratio;
  }else {validateDrivetrain(p.drivetrain!);if((p.kind==='dieselDirect')!==(p.drivetrain!.kind==='direct'))throw new Error('Diesel plant/drivetrain kind mismatch');rated=p.engines[0].erpm.obsMax/p.drivetrain!.ratio;for(const e of p.engines)if(Math.abs(e.erpm.obsMax/p.drivetrain!.ratio/s.maxPsrpm-1)>.02)throw new Error('Engine/shaft max RPM mismatch');if(p.kind==='dieselDirect'){if(p.engines.some(e=>e.stroke!==2||e.cylinders!==6)||!p.motor||p.motor.drivetrain.kind!=='direct'||Math.abs(p.motor.maxRpm/p.motor.drivetrain.ratio/s.maxPsrpm-1)>.02)throw new Error('D/D requires 2-stroke 6-cylinder engines and clutched direct motor');}else if(p.motor&&Math.abs(p.motor.maxRpm/p.motor.drivetrain.ratio/s.maxPsrpm-1)>.02)throw new Error('Battery motor/shaft RPM mismatch');}
 }else if('mainTurbines' in p){
  if(!Number.isInteger(p.reactors)||!finite(p.reactors,1,3)||!Array.isArray(p.reactorSets)||p.reactorSets.length!==p.reactors||new Set(p.reactorSets.map(r=>r?.id)).size!==p.reactorSets.length)throw new Error('Invalid reactor sets');for(const r of p.reactorSets)if(!r||typeof r.id!=='string'||!r.id||!finite(r.coolantPumpHz,1,500)||!r.turboGenerator||!Number.isInteger(r.turboGenerator.polePairs)||!finite(r.turboGenerator.polePairs,1,24)||!finite(r.turboGenerator.rpm,30,12000)||Math.abs(r.turboGenerator.rpm/60*r.turboGenerator.polePairs-electricalHz)>1e-9)throw new Error('Invalid reactor coolant/turbo-generator set');const t=p.mainTurbines,g=p.turbineGenerators;if(!t||!Number.isInteger(t.count)||!finite(t.count,1,3)||!finite(t.maxRpm,30,12000)||!Number.isInteger(t.vaneCount)||!finite(t.vaneCount,8,120)||!g||!Number.isInteger(g.count)||!finite(g.count,1,4)||!Number.isInteger(g.polePairs)||!finite(g.polePairs,1,24)||!finite(g.rpm,30,12000)||Math.abs(g.rpm/60*g.polePairs-electricalHz)>1e-9)throw new Error('Invalid turbine/generator plant');validateDrivetrain(t.drivetrain);
  if(p.kind==='nuclearElectric'){if(!p.motor)throw new Error('Electric plant requires motor');rated=p.motor.maxRpm/p.motor.drivetrain.ratio;}else{if((p.motor&&!s.aip)||t.drivetrain.kind==='direct')throw new Error('Nuclear GR requires reduction');rated=t.maxRpm/t.drivetrain.ratio;}
 }
 if(s.emergencyPropulsor&&(!finite(s.emergencyPropulsor.maxRpm,20,600)||!Number.isInteger(s.emergencyPropulsor.blades)||!finite(s.emergencyPropulsor.blades,2,8)||!finite(s.emergencyPropulsor.maxSpeedKts,1,5)))throw new Error('Invalid emergency propulsor');
 if(p.motor){if(s.motorSlots!==undefined&&(!Number.isInteger(s.motorSlots)||!finite(s.motorSlots,48,200)))throw new Error('Invalid motor slots');if(!finite(p.motor.maxRpm,20,12000))throw new Error('Invalid motor RPM');validateDrivetrain(p.motor.drivetrain);}
 if(Math.abs(rated/s.maxPsrpm-1)>.02)throw new Error('Plant/shaft max RPM mismatch');
 if(s.classTransients){if(!Array.isArray(s.classTransients)||s.classTransients.length>4)throw new Error('Invalid classTransients');for(const tr of s.classTransients)if(!tr||typeof tr.id!=='string'||!tr.id||typeof tr.name!=='string'||!tr.name||!finite(tr.hz,.1,1e5)||!Array.isArray(tr.harmonics)||!tr.harmonics.length||tr.harmonics.length>5||!tr.harmonics.every(h=>Number.isInteger(h)&&h>0&&h<=5)||!finite(tr.durationS,.05,30))throw new Error('Invalid class transient');}
 if(s.hydp&&(!finite(s.hydp.nominalHz,.1,1e5)||!finite(s.hydp.pairSpacingHz,.001,100)||!finite(s.hydp.durationS,.01,3600)))throw new Error('Invalid HYDP metadata');
 if(!Array.isArray(s.edas)||new Set(s.edas.map(e=>e?.id)).size!==s.edas.length||!Array.isArray(s.aux)||new Set(s.aux.map(a=>a?.id)).size!==s.aux.length)throw new Error('Invalid EDA/aux list');
 /** Aux keeps ≥1 harmonic; EDA allows 0–5 (Wilson: fleet median 1–2, per-component). */
 const auxHarmonics=(a:number[])=>Array.isArray(a)&&a.length>0&&a.length<=8&&a.every(h=>Number.isInteger(h)&&h>0&&h<=20);
 const edaHarmonics=(a:number[])=>Array.isArray(a)&&a.length<=5&&a.every(h=>Number.isInteger(h)&&h>0&&h<=5)&&new Set(a).size===a.length;
 if(('engines' in p)&&(s.edas.length<1||s.edas.length>3))throw new Error('Diesel class requires 1-3 EDAs');
 for(const e of s.edas)if(!e||typeof e.id!=='string'||!e.id||typeof e.name!=='string'||!e.name||!finite(e.cfrMultiple,.01,100)||!edaHarmonics(e.harmonics)||(e.ramp&&(!finite(e.ramp.riseS,0,3600)||!finite(e.ramp.fallS,0,3600)))||(e.modes&&(!Array.isArray(e.modes)||e.modes.some(m=>!['SURF','SNORK','D/E','BATT','AIP','NUC'].includes(m)))))throw new Error('Invalid EDA');
 for(const a of s.aux)if(!a||typeof a.id!=='string'||!a.id||!['electrical','acvr','dcvr','ssma','hydp','acPump'].includes(a.kind)||!finite(a.fHz,.01,1e5)||!auxHarmonics(a.harmonics)||!['stable','unstable'].includes(a.stability)||!['discrete','diffuse'].includes(a.width)||(a.width==='diffuse'&&a.sigmaBins!==undefined&&!finite(a.sigmaBins,.75,16))||!['continuous','intermittent'].includes(a.duty)||(a.duty==='intermittent'&&(!Array.isArray(a.dutyOnS)||a.dutyOnS.length!==2||!finite(a.dutyOnS[0],.1,1e6)||!finite(a.dutyOnS[1],a.dutyOnS[0],1e6)||!Array.isArray(a.dutyOffS)||a.dutyOffS.length!==2||!finite(a.dutyOffS[0],.1,1e6)||!finite(a.dutyOffS[1],a.dutyOffS[0],1e6)||(a.edge!==undefined&&!['fade','abrupt','knee'].includes(a.edge)))))throw new Error('Invalid auxiliary/duty sheet');
}
