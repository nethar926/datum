import {catalog} from '../catalog/classes.js';
import {CUT_MODEL_VERSION,type CutSeed,type CutStarterPack} from './types.js';

const klass=(id:string)=>{const c=catalog.classes.find(x=>x.id===id);if(!c)throw new Error(`Unknown class ${id}`);return c;};
const hydp=(id:string)=>klass(id).hydp!.nominalHz;
const hull=(id:string)=>klass(id).hulls[0].id;

/** Curated 8-cut starter pack from the fixed fictional catalog. Lookalike pairs share nation /
 * plant layout and differ on one declared key (HYDP Hz). All parameters invented. */
export const STARTER_PACK:CutStarterPack={
 packVersion:1,
 modelVersion:CUT_MODEL_VERSION,
 cuts:[
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-brindleflux-snork',seed:0xC0710001,durationS:420,richness:'moderate',
   classId:'blue-brindleflux',variantId:'base',hullId:hull('blue-brindleflux'),mode:'SNORK',speedKn:12,depthM:12,
   classifyingLines:[
    {lineFamily:'CFR',label:'Diesel firing rate (snorting)',giveaway:false},
    {lineFamily:'BR',label:'5-blade blade rate',nominalHz:undefined,giveaway:false},
    {lineFamily:'HYDP',label:'HYDP pair',nominalHz:hydp('blue-brindleflux'),giveaway:true},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-gloamspiral-aip',seed:0xC0710002,durationS:480,richness:'sparse',
   classId:'red-gloamspiral',variantId:'base',hullId:hull('red-gloamspiral'),mode:'AIP',speedKn:4,depthM:80,
   classifyingLines:[
    {lineFamily:'AUX',label:'AIP-quiet plant (engines off)',giveaway:true},
    {lineFamily:'BR',label:'7-blade blade rate',giveaway:false},
    {lineFamily:'HYDP',label:'HYDP pair',nominalHz:hydp('red-gloamspiral'),giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-vellumwake-nuc',seed:0xC0710003,durationS:360,richness:'rich',
   classId:'blue-vellumwake',variantId:'base',hullId:hull('blue-vellumwake'),mode:'NUC',speedKn:18,depthM:100,
   classifyingLines:[
    {lineFamily:'COOLANT',label:'Reactor coolant pump',giveaway:false},
    {lineFamily:'VANE',label:'Turbine vane-pass',giveaway:false},
    {lineFamily:'PSR',label:'Twin-shaft PSR doublets',giveaway:true},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-emberbraid-snork',seed:0xC0710004,durationS:450,richness:'moderate',
   classId:'red-emberbraid',variantId:'base',hullId:hull('red-emberbraid'),mode:'SNORK',speedKn:14,depthM:14,
   classifyingLines:[
    {lineFamily:'MESH',label:'Reduction gear mesh',giveaway:true},
    {lineFamily:'BR',label:'6-blade blade rate',giveaway:false},
    {lineFamily:'CFR',label:'Diesel firing rate (snorting)',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-pebblewisp-batt',seed:0xC0710005,durationS:300,richness:'sparse',
   classId:'red-dorhan-pebblewisp',variantId:'base',hullId:hull('red-dorhan-pebblewisp'),mode:'BATT',speedKn:4,depthM:60,
   lookalikeGroupId:'lookalike-dorhan-coastal',
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Dorhan coastal giveaway)',nominalHz:hydp('red-dorhan-pebblewisp'),giveaway:true},
    {lineFamily:'BR',label:'4-blade blade rate',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-mistacorn-batt',seed:0xC0710006,durationS:300,richness:'sparse',
   classId:'red-dorhan-mistacorn',variantId:'base',hullId:hull('red-dorhan-mistacorn'),mode:'BATT',speedKn:3.5,depthM:50,
   lookalikeGroupId:'lookalike-dorhan-coastal',
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Dorhan coastal giveaway)',nominalHz:hydp('red-dorhan-mistacorn'),giveaway:true},
    {lineFamily:'BR',label:'4-blade blade rate',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-velvetshoal-nuc',seed:0xC0710007,durationS:540,richness:'moderate',
   classId:'red-velvetshoal',variantId:'base',hullId:hull('red-velvetshoal'),mode:'NUC',speedKn:12,depthM:120,
   lookalikeGroupId:'lookalike-kaelun-ssn',
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Kaelun twin-shaft giveaway)',nominalHz:hydp('red-velvetshoal'),giveaway:true},
    {lineFamily:'PSR',label:'Twin-shaft PSR',giveaway:false},
    {lineFamily:'BR',label:'8-blade blade rate',giveaway:false},
   ],
  },
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-twilightweft-nuc',seed:0xC0710008,durationS:540,richness:'moderate',
   classId:'red-twilightweft',variantId:'base',hullId:hull('red-twilightweft'),mode:'NUC',speedKn:12,depthM:120,
   lookalikeGroupId:'lookalike-kaelun-ssn',
   classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP pair (Kaelun twin-shaft giveaway)',nominalHz:hydp('red-twilightweft'),giveaway:true},
    {lineFamily:'PSR',label:'Twin-shaft PSR',giveaway:false},
    {lineFamily:'BR',label:'8-blade blade rate',giveaway:false},
   ],
  },
 ] satisfies CutSeed[],
 lookalikePairs:[
  {id:'lookalike-dorhan-coastal',cutIds:['cut-pebblewisp-batt','cut-mistacorn-batt'],differOn:'HYDP'},
  {id:'lookalike-kaelun-ssn',cutIds:['cut-velvetshoal-nuc','cut-twilightweft-nuc'],differOn:'HYDP'},
 ],
};

/** Frozen snapshot used by listCutSeeds / getCutSeed. */
export const STARTER_CUTS:readonly CutSeed[]=STARTER_PACK.cuts;
