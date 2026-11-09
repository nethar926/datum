import {catalog} from '../catalog/classes.js';
import {CUT_SSMA_AUX} from './fidelity.js';
import {CUT_MODEL_VERSION,type CutSeed,type CutStarterPack} from './types.js';

const klass=(id:string)=>{const c=catalog.classes.find(x=>x.id===id);if(!c)throw new Error(`Unknown class ${id}`);return c;};
const hydp=(id:string)=>klass(id).hydp!.nominalHz;
const hull=(id:string)=>klass(id).hulls[0].id;

/**
 * Curated ≤10-cut starter pack. Gram looks map to Wilson's fidelity notes; classifyingLines
 * carry harmonicOf / n / behaviour tags and stay truthful to catalog idKeys. All fictional.
 * Full SNORK↔BATT mode-switch still deferred; engine-knee uses engine-ramp (RPM scale).
 */
export const STARTER_PACK:CutStarterPack={
 packVersion:1,
 modelVersion:CUT_MODEL_VERSION,
 cuts:[
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-brindleflux-snork',seed:0xC0710001,durationS:420,richness:'moderate',
   classId:'blue-brindleflux',variantId:'base',hullId:hull('blue-brindleflux'),mode:'SNORK',speedKn:12,depthM:12,
   gramLooks:['engine-harmonics','harmonic-skip','eda-locked','propulsion-ramp','engine-knee','electrical-ac-dc','compendium-truth'],
   classifyingLines:[
    {lineFamily:'CFR',label:'Diesel firing rate (snorting); family knees together',n:1,behaviour:'kneeing',giveaway:false},
    {lineFamily:'CFR',label:'CFR 2nd harmonic drowned',n:2,harmonicOf:'CFR',behaviour:'skipped',giveaway:false},
    {lineFamily:'EDA',label:'LOP EDA locked to CFR (×27.75); riseS + tracks knee',n:1,harmonicOf:'CFR',behaviour:'ramping',giveaway:true},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-cinderlilt-cav',seed:0xC0710002,durationS:360,richness:'rich',
   classId:'red-cinderlilt',variantId:'base',hullId:hull('red-cinderlilt'),mode:'SURF',speedKn:14,depthM:0,
   // Surfaced: effective zs ~half draught still leaves strong LF Lloyd dipole loss + rich ambient;
   // closer textbook CPA so GRID/BR tonals clear the shared window (geometry, not a gain hack).
   cpaM:400,cpaNote:'Surfaced Lloyd dipole + rich SS3 ambient: 400 m CPA so GRID/BR teach above 6 dB',
   gramLooks:['cavitation','engine-harmonics','compendium-truth'],
   classifyingLines:[
    {lineFamily:'BR',label:'5-blade rate; LOFAR shows cavitation broadband',n:1,harmonicOf:'PSR',behaviour:'broadband',giveaway:true},
    {lineFamily:'CFR',label:'Diesel firing rate (surfaced)',n:1,behaviour:'stable',giveaway:false},
    {lineFamily:'GRID',label:'AC bus 50 Hz (stable/discrete)',nominalHz:50,n:1,behaviour:'stable',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-pebblewisp-demon',seed:0xC0710003,durationS:480,richness:'sparse',
   classId:'red-dorhan-pebblewisp',variantId:'base',hullId:hull('red-dorhan-pebblewisp'),mode:'BATT',speedKn:2.5,depthM:60,
   lookalikeGroupId:'lookalike-dorhan-coastal',
   gramLooks:['slow-demon-blade','compendium-truth'],
   classifyingLines:[
    {lineFamily:'BR',label:'4-blade rate — read on DEMON at crawl speed',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false},
    {lineFamily:'HYDP',label:'HYDP pair (Dorhan coastal giveaway)',nominalHz:hydp('red-dorhan-pebblewisp'),n:1,behaviour:'stable',giveaway:true},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-mistacorn-batt',seed:0xC0710004,durationS:300,richness:'sparse',
   classId:'red-dorhan-mistacorn',variantId:'base',hullId:hull('red-dorhan-mistacorn'),mode:'BATT',speedKn:3.5,depthM:50,
   lookalikeGroupId:'lookalike-dorhan-coastal',
   gramLooks:['compendium-truth','slow-demon-blade'],
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Dorhan coastal giveaway)',nominalHz:hydp('red-dorhan-mistacorn'),n:1,behaviour:'stable',giveaway:true},
    {lineFamily:'BR',label:'4-blade blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-orbelune-msr',seed:0xC0710005,durationS:420,richness:'sparse',
   classId:'blue-orbelune',variantId:'base',hullId:hull('blue-orbelune'),mode:'BATT',speedKn:5,depthM:80,
   gramLooks:['msr-dominant','compendium-truth','electrical-ac-dc'],
   classifyingLines:[
    {lineFamily:'MSR',label:'Motor slot rate (124 slots) — dominant giveaway',n:1,behaviour:'stable',giveaway:true},
    {lineFamily:'GRID',label:'AC bus 60 Hz',nominalHz:60,n:1,behaviour:'stable',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-emberbraid-ssma',seed:0xC0710006,durationS:450,richness:'moderate',
   classId:'red-emberbraid',variantId:'base',hullId:hull('red-emberbraid'),mode:'SNORK',speedKn:14,depthM:14,
   gramLooks:['ssma-harmonics-only','electrical-ac-dc','engine-harmonics','eda-locked','compendium-truth'],
   classifyingLines:[
    {lineFamily:'AUX',label:'SSMA 2nd harmonic (no fundamental)',nominalHz:CUT_SSMA_AUX.fHz*2,n:2,harmonicOf:'AUX',behaviour:'harmonics-only',giveaway:true},
    {lineFamily:'MESH',label:'Reduction gear mesh',n:1,behaviour:'stable',giveaway:false},
    {lineFamily:'CFR',label:'Diesel firing rate (snorting)',n:1,behaviour:'stable',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-velvetshoal-nuc',seed:0xC0710007,durationS:540,richness:'moderate',
   classId:'red-velvetshoal',variantId:'base',hullId:hull('red-velvetshoal'),mode:'NUC',speedKn:16,depthM:80,
   lookalikeGroupId:'lookalike-kaelun-ssn',
   gramLooks:['blade-harmonics-reinforced','compendium-truth'],
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Kaelun twin-shaft giveaway)',nominalHz:hydp('red-velvetshoal'),n:1,behaviour:'stable',giveaway:true},
    {lineFamily:'BR',label:'8-blade rate h2 reinforced',n:2,harmonicOf:'BR',behaviour:'stable',giveaway:false},
    {lineFamily:'PSR',label:'Twin-shaft PSR',n:1,behaviour:'stable',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-twilightweft-nuc',seed:0xC0710008,durationS:540,richness:'moderate',
   classId:'red-twilightweft',variantId:'base',hullId:hull('red-twilightweft'),mode:'NUC',speedKn:16,depthM:80,
   lookalikeGroupId:'lookalike-kaelun-ssn',
   gramLooks:['blade-harmonics-reinforced','compendium-truth'],
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Kaelun twin-shaft giveaway)',nominalHz:hydp('red-twilightweft'),n:1,behaviour:'stable',giveaway:true},
    {lineFamily:'BR',label:'8-blade rate h2 reinforced',n:2,harmonicOf:'BR',behaviour:'stable',giveaway:false},
    {lineFamily:'PSR',label:'Twin-shaft PSR',n:1,behaviour:'stable',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-gloamspiral-aip',seed:0xC0710009,durationS:480,richness:'sparse',
   classId:'red-gloamspiral',variantId:'base',hullId:hull('red-gloamspiral'),mode:'AIP',speedKn:4,depthM:80,
   // Quiet AIP: VLF plant giveaway needs a modest closer CPA so 14 Hz AUX clears ambient at 900 m TL.
   cpaM:300,cpaNote:'Quiet AIP VLF AUX giveaway: 300 m textbook CPA so 14/28 Hz plant tones clear shared window',
   gramLooks:['compendium-truth'],
   classifyingLines:[
    {lineFamily:'AUX',label:'AIP-quiet plant (engines off)',nominalHz:14,n:1,behaviour:'unstable',giveaway:true},
    {lineFamily:'BR',label:'7-blade blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false},
    {lineFamily:'HYDP',label:'HYDP pair',nominalHz:hydp('red-gloamspiral'),n:1,behaviour:'stable',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-morrowcoil-hydp-masked',seed:0xC071000B,durationS:300,richness:'sparse',
   classId:'green-morrowcoil',variantId:'base',hullId:hull('green-morrowcoil'),mode:'BATT',speedKn:3,depthM:55,
   // Retarget of c778013 cut-russetwake-hydp-masked: green-russetwake is NO_HYDP on this branch.
   // Same teaching truth — fundamental drowned, harmonics visible; Green diesel with HYDP.
   hydpShape:{orders:12,drownFundamental:true,drownOrders:[],fadeS:.05,powerScale:4},
   gramLooks:['compendium-truth'],
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP harmonics, fundamental masked',nominalHz:hydp('green-morrowcoil'),n:1,behaviour:'harmonics-only',giveaway:true},
    {lineFamily:'HYDP',label:'HYDP 2nd harmonic (visible)',nominalHz:hydp('green-morrowcoil')*2,n:2,harmonicOf:'HYDP',behaviour:'stable',giveaway:false},
    {lineFamily:'BR',label:'Blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false},
   ],
  },
 ] satisfies CutSeed[],
 lookalikePairs:[
  {id:'lookalike-dorhan-coastal',cutIds:['cut-pebblewisp-demon','cut-mistacorn-batt'],differOn:'HYDP'},
  {id:'lookalike-kaelun-ssn',cutIds:['cut-velvetshoal-nuc','cut-twilightweft-nuc'],differOn:'HYDP'},
 ],
};

export const STARTER_CUTS:readonly CutSeed[]=STARTER_PACK.cuts;
