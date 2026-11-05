import type {IdKeys} from './idKeys.js';
import {NATIONS,isDeniedOperator} from './nations.js';
import {validateVesselPlant,type VesselPlantSpec,type DrivetrainCode,type PropellerSpec} from './drivetrain.js';
import {legacyAux} from './plants.js';
import type {LineProfile,LineProfiles} from '../sourceModel.js';
/** Fixed fictional data; public mechanisms only (Urick; Ross, Mechanics of Underwater Noise). */
export type Force='Blue'|'Green'|'Red';
export type Propulsion='dieselDirect'|'dieselGearReduction'|'dieselElectric'|'nuclearGearReduction'|'nuclearElectric';
export const OPERATING_MODES=['SURF','SNORK','D/E','BATT','AIP','NUC'] as const;
export type OperatingMode=typeof OPERATING_MODES[number];
export type LegacyOperatingMode='normal'|'quiet'|'aip'|'battery'|'snorkel'|'surfaced';
export type ModeInput=OperatingMode|LegacyOperatingMode;
/** v1 reader aliases only; catalog/generated/truth modes use the canonical operator codes. */
export function normalizeMode(mode:ModeInput,primary:string=''):OperatingMode {switch(mode){case 'surfaced':return 'SURF';case 'snorkel':return 'SNORK';case 'battery':return 'BATT';case 'aip':return 'AIP';case 'normal':case 'quiet':return primary.startsWith('nuclear')?'NUC':primary==='dieselGearReduction'||primary==='dieselGR'?'SNORK':'BATT';default:return mode;}}
export interface OperatingState {speedKn:number;depthM:number;mode:ModeInput;reactorOffline?:boolean}
export interface CatalogReference {classId:string;variantId?:string;hullId?:string}
export interface ClassParams {
 plantSpec?:VesselPlantSpec;
 lineProfiles?:LineProfiles;
 propulsion:Propulsion;aipCapable:boolean;shafts:number;reductionRatio:number;gearTeeth:number;maxShaftRpm:number;blades:number;
 maxSpeedKn:number;quietSpeedKn:number;depthM:[number,number];electricalHz:50|60;electricalHarmonics:number[];
 dieselCylinders:number;dieselRpm:number;srcHzPerKn:number[];levelDb:number;
 aux:{id:string;kind:'pump'|'motor-generator';basis:'rotation'|'electrical';rate:number;harmonics:number[];stability?:LineProfile['stability'];width?:LineProfile['width'];sigmaBins?:number}[];
 cavitation:{surfaceInceptionKn:number;depthCoefficient:number};
 flowNoise:{referenceKn:number;levelDb:number;slopeDb:number;radiatedFraction:number};emitters:{id:string;kind:string}[];
}
export interface CatalogVariant {id:string;name:string;overrides:Partial<ClassParams>}
export interface SubmarineClass extends VesselPlantSpec {propeller:PropellerSpec;idKeys:IdKeys;propellerType:'skewed'|'flat'|'cpp';tpk:number;era:number;quietingTier:'gen2'|'gen3'|'gen4';archetype?:string;drivetrainCode:DrivetrainCode;drivetrainLabel:string;plant:'diesel'|'nuclear';aipCapable:boolean;operatorNationId:string;snorkelDepthM:number;maxSpeedKts:{surfaced:number;submerged:number;snorkel:number;battery:number};quietSpeedKts:[number,number];id:string;name:string;country:string;force:Force;hulls:{id:string;number:string;name:string}[];variants:CatalogVariant[];params:ClassParams}
export interface Catalog {catalogVersion:1;classes:SubmarineClass[]}
export const forceElectricalHz=(force:Force):50|60=>force==='Red'?50:60;
export const isGeared=(p:Propulsion):boolean=>p==='dieselGearReduction'||p==='nuclearGearReduction';
export const isDiesel=(p:Propulsion):boolean=>p.startsWith('diesel');
export function effectiveParams(c:SubmarineClass,variantId?:string):ClassParams {
 const v=variantId===undefined?undefined:c.variants.find(v=>v.id===variantId);if(variantId!==undefined&&!v)throw new Error(`Unknown variant ${variantId}`);const p={...c.params,...v?.overrides};return {...p,plantSpec:{maxPsrpm:p.maxShaftRpm,shafts:p.shafts,shaftMismatchPct:c.shaftMismatchPct,machinery:c.machinery,edas:c.edas,propeller:c.propeller,...(c.hydp?{hydp:c.hydp}:{}),tpk:c.tpk,...(c.tpkMinKts?{tpkMinKts:c.tpkMinKts}:{}),speedWindows:c.speedWindows,...(c.emergencyPropulsor?{emergencyPropulsor:c.emergencyPropulsor}:{}),...(c.motorSlots?{motorSlots:c.motorSlots}:{}),...(c.aip?{aip:c.aip}:{}),aux:v?.overrides.aux?legacyAux(p):c.aux}};
}
const number=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const positiveInts=(a:unknown):a is number[]=>Array.isArray(a)&&a.length>0&&a.every(x=>Number.isInteger(x)&&x>0&&x<=20);
function validProfile(p:Partial<LineProfile>):boolean{return ['stable','unstable'].includes(p.stability??'stable')&&['discrete','diffuse'].includes(p.width??'discrete')&&(p.sigmaBins===undefined||p.width!=='diffuse'||number(p.sigmaBins,.75,16));}
function validateParams(p:ClassParams,force:Force):void{
 if(p?.lineProfiles)for(const profile of Object.values(p.lineProfiles))if(!profile||!validProfile(profile))throw new Error('Invalid line profile');
 if(!p||!['dieselDirect','dieselGearReduction','dieselElectric','nuclearGearReduction','nuclearElectric'].includes(p.propulsion)||typeof p.aipCapable!=='boolean')throw new Error('Invalid propulsion/AIP flag');
 for(const [k,lo,hi] of [['shafts',1,4],['reductionRatio',1,30],['gearTeeth',1,300],['maxShaftRpm',30,600],['blades',2,12],['maxSpeedKn',5,45],['quietSpeedKn',0,30],['dieselCylinders',0,24],['dieselRpm',0,2000],['levelDb',60,200]] as const)if(!number(p[k],lo,hi))throw new Error(`Invalid ${k}`);
 for(const k of ['shafts','gearTeeth','blades','dieselCylinders'] as const)if(!Number.isInteger(p[k]))throw new Error(`Noninteger ${k}`);
 if(p.quietSpeedKn>p.maxSpeedKn||(!isGeared(p.propulsion)&&p.reductionRatio!==1)||!Array.isArray(p.depthM)||p.depthM.length!==2||!number(p.depthM[0],0,1000)||!number(p.depthM[1],p.depthM[0],1000)||p.electricalHz!==forceElectricalHz(force)||!positiveInts(p.electricalHarmonics))throw new Error('Invalid envelope/electrical plant');
 if(!Array.isArray(p.srcHzPerKn)||!p.srcHzPerKn.length||!p.srcHzPerKn.every(x=>number(x,.01,100)))throw new Error('Invalid SRC rates');
 if(!Array.isArray(p.aux)||p.aux.length>8||new Set(p.aux.map(a=>a?.id)).size!==p.aux.length)throw new Error('Invalid auxiliaries');
 for(const a of p.aux)if(!a||!validProfile(a)||typeof a.id!=='string'||!a.id||!['pump','motor-generator'].includes(a.kind)||!['rotation','electrical'].includes(a.basis)||!number(a.rate,.01,1000)||!positiveInts(a.harmonics))throw new Error('Invalid aux tonal');
 const c=p.cavitation,f=p.flowNoise;if(!c||!number(c.surfaceInceptionKn,1,40)||!number(c.depthCoefficient,.001,1)||!f||!number(f.referenceKn,.1,30)||!number(f.levelDb,0,160)||!number(f.slopeDb,50,60)||!number(f.radiatedFraction,0,1))throw new Error('Invalid cavitation/flow');
 if(!Array.isArray(p.emitters)||p.emitters.some(e=>!e||typeof e.id!=='string'||typeof e.kind!=='string'))throw new Error('Invalid emitter placeholders');
}
export function validateCatalog(value:unknown):asserts value is Catalog {
 const c=value as Catalog;if(!c||c.catalogVersion!==1||!Array.isArray(c.classes)||!c.classes.length)throw new Error('Invalid catalog version/classes');const ids=new Set<string>(),hulls=new Set<string>();
 for(const x of c.classes){if(!x||typeof x.id!=='string'||!x.id||ids.has(x.id)||typeof x.name!=='string'||!x.name.startsWith('Fictional ')||typeof x.country!=='string'||!x.country||!['Blue','Green','Red'].includes(x.force))throw new Error('Invalid/duplicate fictional class');const nation=NATIONS.find(n=>n.id===x.operatorNationId);if(isDeniedOperator(x.operatorNationId??'')||isDeniedOperator(x.country)||!nation||nation.name!==x.country||nation.force!==x.force||nation.electricalHz!==forceElectricalHz(x.force))throw new Error('Operator must be an approved fictional nation');if(!number(x.snorkelDepthM,isDiesel(x.params.propulsion)?2:0,isDiesel(x.params.propulsion)?30:0)||!x.maxSpeedKts||!number(x.maxSpeedKts.snorkel,1,x.maxSpeedKts.submerged)||!number(x.maxSpeedKts.battery,1,x.maxSpeedKts.submerged)||!number(x.maxSpeedKts.submerged,5,45)||!number(x.maxSpeedKts.surfaced,1,x.maxSpeedKts.submerged)||x.maxSpeedKts.submerged!==x.params.maxSpeedKn||!Array.isArray(x.quietSpeedKts)||x.quietSpeedKts.length!==2||!number(x.quietSpeedKts[0],0,x.quietSpeedKts[1])||!number(x.quietSpeedKts[1],x.quietSpeedKts[0],x.maxSpeedKts.submerged)||x.quietSpeedKts[1]>=x.params.cavitation.surfaceInceptionKn*Math.sqrt(1+100*x.params.cavitation.depthCoefficient))throw new Error('Invalid quiet/max speed band (knots)');if(!x.propeller||x.propeller.shafts!==x.shafts||x.propeller.blades!==x.params.blades||x.propeller.type!==x.propellerType||!number(x.propeller.blades,3,9))throw new Error('Invalid propeller sheet');if(!['skewed','flat','cpp'].includes(x.propellerType)||!number(x.tpk,.1,100)||Math.abs(x.tpk*x.params.maxSpeedKn/x.maxPsrpm-1)>.02||(x.propellerType==='cpp'&&!number(x.tpkMinKts,.1,x.maxSpeedKts.submerged)))throw new Error('Invalid propeller/TPK sheet');if(!number(x.era,1950,2100)||!['gen2','gen3','gen4'].includes(x.quietingTier))throw new Error('Invalid fictional era/quieting tier');if(x.plant!==(isDiesel(x.params.propulsion)?'diesel':'nuclear')||x.aipCapable!==!!x.aip||x.params.aipCapable!==x.aipCapable)throw new Error('Primary plant/AIP backup flags disagree');ids.add(x.id);validateParams(x.params,x.force);validateVesselPlant(x,forceElectricalHz(x.force));if(x.maxPsrpm!==x.params.maxShaftRpm||x.shafts!==x.params.shafts||x.machinery.kind!==({dieselDirect:'dieselDirect',dieselGearReduction:'dieselGR',dieselElectric:'dieselElectric',nuclearGearReduction:'nuclearGR',nuclearElectric:'nuclearElectric'}[x.params.propulsion]))throw new Error('Legacy/class plant mismatch');
  if(!Array.isArray(x.hulls)||!x.hulls.length||!Array.isArray(x.variants)||!x.variants.length)throw new Error('Class needs hulls/variants');
  for(const h of x.hulls){if(!h||typeof h.id!=='string'||!h.id||hulls.has(h.id)||typeof h.number!=='string'||!h.number.startsWith('FX-')||typeof h.name!=='string'||!h.name)throw new Error('Invalid/duplicate fictional hull');hulls.add(h.id);}
  const variants=new Set<string>();for(const v of x.variants){if(!v||typeof v.id!=='string'||!v.id||variants.has(v.id)||typeof v.name!=='string'||!v.overrides||typeof v.overrides!=='object')throw new Error('Invalid variant');variants.add(v.id);for(const k of Object.keys(v.overrides))if(!(k in x.params))throw new Error('Unknown variant parameter');const p=effectiveParams(x,v.id);if(p.propulsion!==x.params.propulsion)throw new Error('Variants cannot change propulsion');validateParams(p,x.force);validateVesselPlant(p.plantSpec!,forceElectricalHz(x.force));}
 }
}
