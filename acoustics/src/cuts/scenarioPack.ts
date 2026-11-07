import {catalog} from '../catalog/classes.js';
import {CUT_MODEL_VERSION,type CutScenarioPack,type CutSeed} from './types.js';

const klass=(id:string)=>{const c=catalog.classes.find(x=>x.id===id);if(!c)throw new Error(`Unknown class ${id}`);return c;};
const hydp=(id:string)=>{const h=klass(id).hydp;if(!h)throw new Error(`Class ${id} has no HYDP`);return h.nominalHz;};
const hull=(id:string)=>klass(id).hulls[0].id;
const D=900;

/**
 * 15-min (900 s) static seeded scenario pack — one cut per teaching scenario.
 * Each cut carries the full live stream set via CutSession (Wilson cut parity).
 */
export const SCENARIO_PACK:CutScenarioPack={
 packVersion:1,
 modelVersion:CUT_MODEL_VERSION,
 cuts:[
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-surfaced',seed:0xC15F0001,durationS:D,richness:'moderate',scenario:'surfaced',
   classId:'red-cinderlilt',variantId:'base',hullId:hull('red-cinderlilt'),mode:'SURF',speedKn:12,depthM:0,
   gramLooks:['engine-harmonics','compendium-truth'],
   classifyingLines:[{lineFamily:'CFR',label:'Surfaced diesel',n:1,behaviour:'stable',giveaway:true},{lineFamily:'BR',label:'Blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-snorting',seed:0xC15F0002,durationS:D,richness:'moderate',scenario:'snorting',
   classId:'blue-brindleflux',variantId:'base',hullId:hull('blue-brindleflux'),mode:'SNORK',speedKn:11,depthM:12,
   gramLooks:['engine-harmonics','eda-locked','compendium-truth'],
   classifyingLines:[{lineFamily:'CFR',label:'Snorting diesel',n:1,behaviour:'stable',giveaway:false},{lineFamily:'EDA',label:'LOP EDA',n:1,harmonicOf:'CFR',behaviour:'ramping',giveaway:true}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-battery',seed:0xC15F0003,durationS:D,richness:'sparse',scenario:'battery',
   classId:'blue-orbelune',variantId:'base',hullId:hull('blue-orbelune'),mode:'BATT',speedKn:4,depthM:80,
   gramLooks:['msr-dominant','compendium-truth'],
   classifyingLines:[{lineFamily:'MSR',label:'Motor slot rate on battery',n:1,behaviour:'stable',giveaway:true},{lineFamily:'BR',label:'Blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-declutch',seed:0xC15F0004,durationS:D,richness:'moderate',scenario:'declutch',
   classId:'green-morrowcoil',variantId:'base',hullId:hull('green-morrowcoil'),mode:'SNORK',speedKn:8,depthM:20,
   gramLooks:['engine-harmonics','eda-locked','compendium-truth'],
   classifyingLines:[{lineFamily:'CFR',label:'Diesel stays charging after declutch',n:1,behaviour:'stable',giveaway:true},{lineFamily:'EDA',label:'EDA follows engine CFR',n:1,harmonicOf:'CFR',behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-swaths',seed:0xC15F0005,durationS:D,richness:'moderate',scenario:'swaths',
   classId:'red-emberbraid',variantId:'base',hullId:hull('red-emberbraid'),mode:'SNORK',speedKn:10,depthM:14,
   gramLooks:['engine-harmonics','compendium-truth'],
   classifyingLines:[{lineFamily:'CFR',label:'Snorting with rudder/planes swaths',n:1,behaviour:'stable',giveaway:false},{lineFamily:'MESH',label:'Gear mesh',n:1,behaviour:'stable',giveaway:true}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-eda-rich',seed:0xC15F0006,durationS:D,richness:'rich',scenario:'eda-rich',
   classId:'blue-brindleflux',variantId:'base',hullId:hull('blue-brindleflux'),mode:'SNORK',speedKn:12,depthM:12,
   gramLooks:['engine-harmonics','eda-locked','compendium-truth'],
   classifyingLines:[{lineFamily:'EDA',label:'LOP rich EDA stack',n:1,harmonicOf:'CFR',behaviour:'ramping',giveaway:true},{lineFamily:'CFR',label:'CFR fundamental',n:1,behaviour:'stable',giveaway:false},{lineFamily:'EFR',label:'EFR',n:1,behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-intermittent',seed:0xC15F0007,durationS:D,richness:'moderate',scenario:'intermittent-aux',
   classId:'blue-brindleflux',variantId:'base',hullId:hull('blue-brindleflux'),mode:'SNORK',speedKn:10,depthM:12,
   gramLooks:['electrical-ac-dc','compendium-truth'],
   classifyingLines:[{lineFamily:'INTERMITTENT',label:'A/C compressor duty cycle',n:1,behaviour:'unstable',giveaway:true},{lineFamily:'GRID',label:'AC bus',n:1,behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-limited',seed:0xC15F0008,durationS:D,richness:'sparse',scenario:'limited-data',
   classId:'red-dorhan-pebblewisp',variantId:'base',hullId:hull('red-dorhan-pebblewisp'),mode:'BATT',speedKn:2.5,depthM:60,
   gramLooks:['slow-demon-blade','compendium-truth'],
   classifyingLines:[{lineFamily:'BR',label:'Sparse blade rate only',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:true}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-demon-only',seed:0xC15F0009,durationS:D,richness:'sparse',scenario:'demon-only',
   classId:'red-dorhan-mistacorn',variantId:'base',hullId:hull('red-dorhan-mistacorn'),mode:'BATT',speedKn:3,depthM:50,
   gramLooks:['slow-demon-blade','compendium-truth'],
   classifyingLines:[{lineFamily:'BR',label:'Prop/DEMON blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:true},{lineFamily:'PSR',label:'Shaft',n:1,behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-hydp-masked',seed:0xC15F000A,durationS:D,richness:'moderate',scenario:'hydp-masked',
   classId:'red-gloamspiral',variantId:'base',hullId:hull('red-gloamspiral'),mode:'BATT',speedKn:5,depthM:70,
   gramLooks:['compendium-truth'],
   classifyingLines:[{lineFamily:'HYDP',label:'HYDP (fundamental may drown)',nominalHz:hydp('red-gloamspiral'),n:1,behaviour:'stable',giveaway:true},{lineFamily:'BR',label:'Blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-no-hydp',seed:0xC15F000B,durationS:D,richness:'moderate',scenario:'no-hydp',
   classId:'green-fennelglint',variantId:'base',hullId:hull('green-fennelglint'),mode:'BATT',speedKn:5,depthM:60,
   gramLooks:['compendium-truth','msr-dominant'],
   classifyingLines:[{lineFamily:'BR',label:'No-HYDP class — blade only',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:true},{lineFamily:'GRID',label:'AC bus',n:1,behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-lloyd-sym',seed:0xC15F000C,durationS:D,richness:'moderate',scenario:'lloyd-symmetric',
   classId:'blue-vellumwake',variantId:'base',hullId:hull('blue-vellumwake'),mode:'NUC',speedKn:14,depthM:60,
   gramLooks:['blade-harmonics-reinforced','compendium-truth'],
   classifyingLines:[{lineFamily:'PSR',label:'Symmetric Lloyd CPA pass',n:1,behaviour:'stable',giveaway:true},{lineFamily:'BR',label:'Blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-lloyd-maneuver',seed:0xC15F000D,durationS:D,richness:'moderate',scenario:'lloyd-maneuver',
   classId:'red-velvetshoal',variantId:'base',hullId:hull('red-velvetshoal'),mode:'NUC',speedKn:12,depthM:50,
   gramLooks:['blade-harmonics-reinforced','compendium-truth'],
   classifyingLines:[{lineFamily:'PSR',label:'Maneuvering CPA — Lloyd asymmetry',n:1,behaviour:'stable',giveaway:true},{lineFamily:'HYDP',label:'HYDP on depth change',nominalHz:hydp('red-velvetshoal'),n:1,behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-src-fade',seed:0xC15F000E,durationS:D,richness:'moderate',scenario:'src-fade',
   classId:'red-sablequill',variantId:'base',hullId:hull('red-sablequill'),mode:'NUC',speedKn:6,depthM:90,
   gramLooks:['compendium-truth'],
   classifyingLines:[{lineFamily:'SRC',label:'SRC fade-in with speed-up',n:1,behaviour:'broadband',giveaway:true},{lineFamily:'PSR',label:'Shaft',n:1,behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-cavitation',seed:0xC15F000F,durationS:D,richness:'rich',scenario:'cavitation',
   classId:'red-lanternmoss',variantId:'base',hullId:hull('red-lanternmoss'),mode:'SURF',speedKn:14,depthM:0,
   gramLooks:['cavitation','engine-harmonics','compendium-truth'],
   classifyingLines:[{lineFamily:'BR',label:'Cavitation onset at surface',n:1,harmonicOf:'PSR',behaviour:'broadband',giveaway:true},{lineFamily:'CFR',label:'Diesel',n:1,behaviour:'stable',giveaway:false}]},
  {v:1,modelVersion:CUT_MODEL_VERSION,id:'scen-doppler-cpa',seed:0xC15F0010,durationS:D,richness:'moderate',scenario:'doppler-cpa',
   classId:'blue-copperlune',variantId:'base',hullId:hull('blue-copperlune'),mode:'NUC',speedKn:18,depthM:80,
   gramLooks:['blade-harmonics-reinforced','compendium-truth'],
   classifyingLines:[{lineFamily:'PSR',label:'Doppler curve across CPA',n:1,behaviour:'stable',giveaway:true},{lineFamily:'BR',label:'Blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false}]},
 ] satisfies CutSeed[],
};

export const SCENARIO_CUTS:readonly CutSeed[]=SCENARIO_PACK.cuts;
