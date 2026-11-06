import {catalog} from '../catalog/classes.js';
import {CUT_MODEL_VERSION,type CutSeed,type CutStarterPack} from './types.js';

const klass=(id:string)=>{const c=catalog.classes.find(x=>x.id===id);if(!c)throw new Error(`Unknown class ${id}`);return c;};
const hydp=(id:string)=>klass(id).hydp!.nominalHz;
const hull=(id:string)=>klass(id).hulls[0].id;

/**
 * Curated ≤10-cut starter pack. Gram looks map to Wilson's fidelity notes; classifyingLines
 * stay truthful to catalog idKeys / HYDP / EDA sheets. All parameters invented.
 */
export const STARTER_PACK:CutStarterPack={
 packVersion:1,
 modelVersion:CUT_MODEL_VERSION,
 cuts:[
  {
   // Notes 1 (engine harmonics), 4 (harmonic skip), 7 (AC GRID stable), 8 (EDA locked), 9 (propulsion ramp)
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-brindleflux-snork',seed:0xC0710001,durationS:420,richness:'moderate',
   classId:'blue-brindleflux',variantId:'base',hullId:hull('blue-brindleflux'),mode:'SNORK',speedKn:12,depthM:12,
   gramLooks:['engine-harmonics','harmonic-skip','eda-locked','propulsion-ramp','electrical-ac-dc','compendium-truth'],
   classifyingLines:[
    {lineFamily:'CFR',label:'Diesel firing rate (snorting; h2 skipped)',giveaway:false},
    {lineFamily:'EDA',label:'LOP EDA locked to CFR (×27.75)',giveaway:true},
    {lineFamily:'GRID',label:'AC bus 60 Hz (stable/discrete)',nominalHz:60,giveaway:false},
   ],
  },
  {
   // Note 2 — cavitation visible on LOFAR (shallow/high speed)
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-cinderlilt-cav',seed:0xC0710002,durationS:360,richness:'rich',
   classId:'red-cinderlilt',variantId:'base',hullId:hull('red-cinderlilt'),mode:'SURF',speedKn:14,depthM:0,
   gramLooks:['cavitation','engine-harmonics','compendium-truth'],
   classifyingLines:[
    {lineFamily:'BR',label:'5-blade rate; LOFAR shows cavitation broadband',giveaway:true},
    {lineFamily:'CFR',label:'Diesel firing rate (surfaced)',giveaway:false},
    {lineFamily:'GRID',label:'AC bus 50 Hz (stable/discrete)',nominalHz:50,giveaway:false},
   ],
  },
  {
   // Note 3 — slow-speed blade data best on DEMON (lookalike A)
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-pebblewisp-demon',seed:0xC0710003,durationS:480,richness:'sparse',
   classId:'red-dorhan-pebblewisp',variantId:'base',hullId:hull('red-dorhan-pebblewisp'),mode:'BATT',speedKn:2.5,depthM:60,
   lookalikeGroupId:'lookalike-dorhan-coastal',
   gramLooks:['slow-demon-blade','compendium-truth'],
   classifyingLines:[
    {lineFamily:'BR',label:'4-blade rate — read on DEMON at crawl speed',giveaway:false},
    {lineFamily:'HYDP',label:'HYDP pair (Dorhan coastal giveaway)',nominalHz:hydp('red-dorhan-pebblewisp'),giveaway:true},
   ],
  },
  {
   // Lookalike A pair
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-mistacorn-batt',seed:0xC0710004,durationS:300,richness:'sparse',
   classId:'red-dorhan-mistacorn',variantId:'base',hullId:hull('red-dorhan-mistacorn'),mode:'BATT',speedKn:3.5,depthM:50,
   lookalikeGroupId:'lookalike-dorhan-coastal',
   gramLooks:['compendium-truth','slow-demon-blade'],
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Dorhan coastal giveaway)',nominalHz:hydp('red-dorhan-mistacorn'),giveaway:true},
    {lineFamily:'BR',label:'4-blade blade rate',giveaway:false},
   ],
  },
  {
   // Note 10 — MSR-dominant; classifier works MSR → slots → class
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-orbelune-msr',seed:0xC0710005,durationS:420,richness:'sparse',
   classId:'blue-orbelune',variantId:'base',hullId:hull('blue-orbelune'),mode:'BATT',speedKn:5,depthM:80,
   gramLooks:['msr-dominant','compendium-truth','electrical-ac-dc'],
   classifyingLines:[
    {lineFamily:'MSR',label:'Motor slot rate (124 slots) — dominant giveaway',giveaway:true},
    {lineFamily:'GRID',label:'AC bus 60 Hz',nominalHz:60,giveaway:false},
   ],
  },
  {
   // Notes 5 (SSMA harmonics only), 7 (DC unstable wander), 1 (blade harm reinforce via snort mesh class)
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-emberbraid-ssma',seed:0xC0710006,durationS:450,richness:'moderate',
   classId:'red-emberbraid',variantId:'base',hullId:hull('red-emberbraid'),mode:'SNORK',speedKn:14,depthM:14,
   gramLooks:['ssma-harmonics-only','electrical-ac-dc','engine-harmonics','eda-locked','compendium-truth'],
   classifyingLines:[
    {lineFamily:'AUX',label:'SSMA harmonics only (no fundamental)',giveaway:true},
    {lineFamily:'MESH',label:'Reduction gear mesh',giveaway:false},
    {lineFamily:'CFR',label:'Diesel firing rate (snorting)',giveaway:false},
   ],
  },
  {
   // Notes 1 blade harmonics reinforced; lookalike B
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-velvetshoal-nuc',seed:0xC0710007,durationS:540,richness:'moderate',
   classId:'red-velvetshoal',variantId:'base',hullId:hull('red-velvetshoal'),mode:'NUC',speedKn:16,depthM:80,
   lookalikeGroupId:'lookalike-kaelun-ssn',
   gramLooks:['blade-harmonics-reinforced','compendium-truth'],
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Kaelun twin-shaft giveaway)',nominalHz:hydp('red-velvetshoal'),giveaway:true},
    {lineFamily:'BR',label:'8-blade rate with reinforced h2/h3',giveaway:false},
    {lineFamily:'PSR',label:'Twin-shaft PSR',giveaway:false},
   ],
  },
  {
   // Lookalike B pair
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-twilightweft-nuc',seed:0xC0710008,durationS:540,richness:'moderate',
   classId:'red-twilightweft',variantId:'base',hullId:hull('red-twilightweft'),mode:'NUC',speedKn:16,depthM:80,
   lookalikeGroupId:'lookalike-kaelun-ssn',
   gramLooks:['blade-harmonics-reinforced','compendium-truth'],
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Kaelun twin-shaft giveaway)',nominalHz:hydp('red-twilightweft'),giveaway:true},
    {lineFamily:'BR',label:'8-blade rate with reinforced h2/h3',giveaway:false},
    {lineFamily:'PSR',label:'Twin-shaft PSR',giveaway:false},
   ],
  },
  {
   // AIP requirement + sparse quiet plant
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-gloamspiral-aip',seed:0xC0710009,durationS:480,richness:'sparse',
   classId:'red-gloamspiral',variantId:'base',hullId:hull('red-gloamspiral'),mode:'AIP',speedKn:4,depthM:80,
   gramLooks:['compendium-truth'],
   classifyingLines:[
    {lineFamily:'AUX',label:'AIP-quiet plant (engines off)',giveaway:true},
    {lineFamily:'BR',label:'7-blade blade rate',giveaway:false},
    {lineFamily:'HYDP',label:'HYDP pair',nominalHz:hydp('red-gloamspiral'),giveaway:false},
   ],
  },
  {
   // Rich nuclear: coolant/vane + blade reinforce
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-vellumwake-nuc',seed:0xC071000A,durationS:360,richness:'rich',
   classId:'blue-vellumwake',variantId:'base',hullId:hull('blue-vellumwake'),mode:'NUC',speedKn:18,depthM:100,
   gramLooks:['blade-harmonics-reinforced','compendium-truth','electrical-ac-dc'],
   classifyingLines:[
    {lineFamily:'COOLANT',label:'Reactor coolant pump',giveaway:false},
    {lineFamily:'VANE',label:'Turbine vane-pass',giveaway:false},
    {lineFamily:'PSR',label:'Twin-shaft PSR doublets',giveaway:true},
   ],
  },
 ] satisfies CutSeed[],
 lookalikePairs:[
  {id:'lookalike-dorhan-coastal',cutIds:['cut-pebblewisp-demon','cut-mistacorn-batt'],differOn:'HYDP'},
  {id:'lookalike-kaelun-ssn',cutIds:['cut-velvetshoal-nuc','cut-twilightweft-nuc'],differOn:'HYDP'},
 ],
};

export const STARTER_CUTS:readonly CutSeed[]=STARTER_PACK.cuts;

