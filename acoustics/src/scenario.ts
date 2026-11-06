import {deriveSignature,resolveReference,validateOperatingState} from './catalog/derive.js';
import type {CatalogReference,ModeInput} from './catalog/schema.js';
import {normalizeMode} from './catalog/schema.js';
import {mpsToKnots} from './units.js';
import type { Track } from './kinematics.js';
import type { Signature,TonalLine } from './sourceModel.js';
import { fictionalSignature } from './sourceModel.js';
import type { Buoy } from './buoys.js';
import type { Shipping } from './ambientNoise.js';
import type { Spreading } from './transmissionLoss.js';
import {BEHAVIOUR_KINDS,type BehaviourKind} from './behaviours.js';
export interface MotionLeg { at:number; course:number; speed:number; depth:number; waypoint?:{x:number;y:number} }
/** m3-events live kinds:
 * - `hydp`: rudder/hydroplane paired blip (durationS, startOffsetPct).
 * - `engine-ramp`: ratio-locked diesel RPM knee (durationS, toScale, optional fromScale).
 * Other kinds stay reserved and are rejected. */
export interface ContactTransient {at:number;kind:string;params:Record<string,number|string>}
export const TRANSIENT_KINDS=['hydp','engine-ramp'] as const;
function badHydp(p:Record<string,number|string>):boolean{for(const k of Object.keys(p))if(k!=='durationS'&&k!=='startOffsetPct')return true;return (p.durationS!==undefined&&!finite(p.durationS,.01,3600))||(p.startOffsetPct!==undefined&&!finite(p.startOffsetPct,0,20));}
function badEngineRamp(p:Record<string,number|string>):boolean{for(const k of Object.keys(p))if(k!=='durationS'&&k!=='toScale'&&k!=='fromScale')return true;return !finite(p.durationS,.01,3600)||!finite(p.toScale,.05,1.5)||(p.fromScale!==undefined&&!finite(p.fromScale,.05,1.5));}
function badTransient(x:ContactTransient):boolean{if(!x||typeof x!=='object'||!finite(x.at,0,1e9)||!x.params||typeof x.params!=='object'||Array.isArray(x.params))return true;if(x.kind==='hydp')return badHydp(x.params);if(x.kind==='engine-ramp')return badEngineRamp(x.params);return true;}
export interface Contact extends Track {behaviour?:BehaviourKind; lines?:TonalLine[]; id:string; category?:'surface'|'subsurface'; classificationTarget?:boolean; active?:boolean; surface?:{type:string;shafts:number;electricalHz:50|60;rank:number}; params:Signature; catalogRef?:CatalogReference; operatingMode?:ModeInput;reactorOffline?:boolean; motion:MotionLeg[]; transients?:ContactTransient[] }
export interface Environment { shippingDensity?:number; seaState:number; shipping:Shipping; soundSpeed:number; spreading:Spreading; transition:number }
export interface Scenario {reactorOffline?:boolean; surfacePool?:Contact[]; classificationTargets?:string[]; v:1; fMax?:number; fBin?:number; band?:[number,number]; surfaceTraffic?:number; seed:number; mode:'aviation'; bins:number; fmax:number; time:number; ownship:Track; environment:Environment; contacts:Contact[]; buoys:Buoy[] }
export type ContactInput=Omit<Contact,'params'> & {params?:Signature};
export type ScenarioInput=Omit<Scenario,'contacts'> & {contacts:ContactInput[]};
export function resolveContactParams(c:ContactInput,time=0,reactorOffline=false):Signature {
 if(!c.catalogRef){if(!c.params)throw new Error('Contact requires params or catalogRef');return c.params;}
 const {klass}=resolveReference(c.catalogRef);let speed=c.speed,depth=c.depth;for(const leg of c.motion??[])if(leg&&leg.at<=time){speed=leg.speed;depth=leg.depth;}
 return deriveSignature(klass,c.catalogRef.variantId,{speedKn:mpsToKnots(speed),depthM:depth,mode:c.operatingMode??'normal',reactorOffline:c.reactorOffline??reactorOffline});
}
const finite=(x:unknown,lo:number,hi:number):x is number => typeof x==='number' && Number.isFinite(x) && x>=lo && x<=hi;
function track(t:Track):boolean { return !!t && finite(t.x,-1e9,1e9)&&finite(t.y,-1e9,1e9)&&finite(t.depth,0,1e6)&&finite(t.course,-1e6,1e6)&&finite(t.speed,0,500); }
export function validateScenario(value:unknown):asserts value is ScenarioInput {
  const s=value as ScenarioInput;
  if(!s || s.v!==1 || s.mode!=='aviation' || !finite(s.seed,0,4294967295)||!Number.isInteger(s.seed)||!finite(s.bins,2,16384)||!Number.isInteger(s.bins)||!finite(s.fmax,1,1e6)||!finite(s.time,0,1e9)||!track(s.ownship)) throw new Error('Invalid scenario header/ownship');
  if(s.fMax!==undefined&&!finite(s.fMax,1,1e6))throw new Error('Invalid fMax');if(s.fBin!==undefined&&!finite(s.fBin,1e-12,1e6))throw new Error('Invalid fBin');if(s.surfaceTraffic!==undefined&&!finite(s.surfaceTraffic,0,1))throw new Error('Invalid surfaceTraffic');if(s.band!==undefined&&(!Array.isArray(s.band)||s.band.length!==2||!finite(s.band[0],0,1e6)||!finite(s.band[1],s.band[0]+1e-9,1e6)))throw new Error('Invalid default band');
  const e=s.environment;
  if(!e||!finite(e.seaState,0,6)||!['light','moderate','heavy'].includes(e.shipping)||!finite(e.soundSpeed,1300,1800)||!['spherical','cylindrical','hybrid'].includes(e.spreading)||!finite(e.transition,1,1e9)) throw new Error('Invalid environment');
  if(!Array.isArray(s.contacts)||s.contacts.length>250||!Array.isArray(s.buoys)||s.buoys.length>128) throw new Error('Invalid counts');
  if(s.environment.shippingDensity!==undefined&&!finite(s.environment.shippingDensity,0,1))throw new Error('Invalid shipping density');
  if(s.surfacePool!==undefined){if(!Array.isArray(s.surfacePool)||s.surfacePool.length>18||s.surfacePool.some(c=>c.category!=='surface')||s.contacts.filter(c=>!s.surfacePool!.some(p=>p.id===c.id)).length+s.surfacePool.length>250)throw new Error('Invalid surface pool');validateScenario({...s,surfacePool:undefined,classificationTargets:undefined,contacts:s.surfacePool});}
  if(s.classificationTargets!==undefined&&(!Array.isArray(s.classificationTargets)||s.classificationTargets.some(id=>!s.contacts.some(c=>c.id===id&&c.category!=='surface'))))throw new Error('Invalid classification targets');
  const ids=new Set<string>();
  for(const c of s.contacts){if(c?.category!==undefined&&!['surface','subsurface'].includes(c.category))throw new Error('Invalid contact category');const a=c?resolveContactParams(c,s.time,s.reactorOffline):undefined;
    if(!track(c)||typeof c.id!=='string'||!c.id||ids.has(c.id)||!a||typeof a.label!=='string'||!finite(a.shaftHz,0,1000)||!finite(a.blades,1,20)||!Number.isInteger(a.blades)||!finite(a.tonalHz,1,1e6)||!finite(a.levelDb,0,220)||!finite(a.modulation,0,.9)) throw new Error('Invalid contact'); ids.add(c.id);
    if(a.tonals!==undefined){if(!Array.isArray(a.tonals)||a.tonals.length>256)throw new Error('Invalid tonal list');const lineIds=new Set<string>();for(const line of a.tonals){if(!line||!finite(line.hz,0,1e8)||!finite(line.power,0,1e6)||(line.stability!==undefined&&!['stable','unstable'].includes(line.stability))||(line.width!==undefined&&!['discrete','diffuse'].includes(line.width))||(line.width==='diffuse'&&line.sigmaBins!==undefined&&!finite(line.sigmaBins,.75,16))||(line.id!==undefined&&(typeof line.id!=='string'||!line.id||lineIds.has(line.id))))throw new Error('Invalid tonal tags');if(line.id)lineIds.add(line.id);}}
    if(!Array.isArray(c.motion)||c.motion.length<1||c.motion[0].at!==0)throw new Error('Contact needs initial timed motion leg');
    let last=-1;for(const leg of c.motion){if(!finite(leg.at,0,1e9)||leg.at<=last||!finite(leg.course,-1e6,1e6)||!finite(leg.speed,0,500)||!finite(leg.depth,0,1e6))throw new Error('Invalid motion leg');if(c.catalogRef){const {params}=resolveReference(c.catalogRef);validateOperatingState(params,{speedKn:mpsToKnots(leg.speed),depthM:leg.depth,mode:c.operatingMode??'normal',reactorOffline:c.reactorOffline??s.reactorOffline});}if(leg.waypoint!==undefined)throw new Error('Waypoint targets reserved; use course/speed legs in M1');last=leg.at;}
    if(c.transients!==undefined && (!Array.isArray(c.transients)||c.transients.length>512||c.transients.some(badTransient)))throw new Error('Invalid transient (only hydp/engine-ramp are live; other kinds reserved)');
    if(c.behaviour!==undefined&&!BEHAVIOUR_KINDS.includes(c.behaviour))throw new Error('Invalid behaviour');
  }
  ids.clear(); for(const b of s.buoys){ if(!track(b)||typeof b.id!=='string'||!b.id||ids.has(b.id)||!['passive-omni','difar'].includes(b.type)||!finite(b.rfChannel,0,9999)||!Number.isInteger(b.rfChannel)||!finite(b.deployedAt,0,1e9)||!finite(b.life,.001,1e9)) throw new Error('Invalid buoy');ids.add(b.id); }
}
const receiver=(id:string,x:number,y:number):Buoy => ({id,x,y,depth:40,course:0,speed:0,rfChannel:Number(id.replace(/\D/g,''))||1,deployedAt:0,life:7200,type:'difar'});
/** Generic fictional maritime patrol aircraft operator lays these patterns; no real platform signatures. */
export function cpaScenario():Scenario {return {v:1,seed:42,mode:'aviation',bins:1024,fmax:500,time:0,ownship:{x:0,y:0,depth:0,course:0,speed:100},environment:{seaState:1,shipping:'light',soundSpeed:1500,spreading:'spherical',transition:1000},contacts:[{id:'fictional-a',category:'subsurface',classificationTarget:true,x:-3000,y:300,depth:80,course:Math.PI/2,speed:8,motion:[{at:0,course:Math.PI/2,speed:8,depth:80}],params:{...fictionalSignature}}],buoys:[receiver('buoy-1',0,0)]};}
export function busyScenario():Scenario {const s=cpaScenario();s.seed=131;s.environment.seaState=4;s.environment.shipping='heavy';s.contacts=[];s.buoys=[];
  for(let i=0;i<12;i++)s.contacts.push({id:`fictional-${i}`,x:(i%4-2)*1800,y:(Math.floor(i/4)-1)*2100,depth:30+15*i,course:i*.7,speed:2+i%7,motion:[{at:0,course:i*.7,speed:2+i%7,depth:30+15*i}],params:{...fictionalSignature,label:`Vessel ${i}`,tonalHz:55+i*11,shaftHz:1+i*.13}});
  for(let i=0;i<8;i++)s.buoys.push(receiver(`buoy-${i+1}`,(i%4-1.5)*1200,Math.floor(i/4)*1500));return s;
}

/** Validated JSON boundary with a JSONPath-style location; existing validator remains authoritative. */
export class ScenarioError extends Error {
  constructor(message:string,readonly path:string='$'){super(`${path}: ${message}`);this.name='ScenarioError';}
}
export function loadScenario(json:unknown):Scenario {
  try{validateScenario(json);return json.contacts.some(c=>c.catalogRef)?{...json,contacts:json.contacts.map(c=>({...c,operatingMode:normalizeMode(c.operatingMode??'normal',c.catalogRef?resolveReference(c.catalogRef).params.propulsion:c.params?.plantSpec?.machinery.kind??''),params:resolveContactParams(c,json.time,json.reactorOffline)}))}:json as Scenario;}
  catch(error){throw new ScenarioError(error instanceof Error?error.message:'Invalid scenario',errorPath(json));}
}
// Diagnostic-only walk: runs only after validation fails, never in the render path.
function errorPath(value:unknown):string {
  if(!value||typeof value!=='object')return '$';const s=value as ScenarioInput;
  for(const [key,lo,hi] of [['seed',0,4294967295],['bins',2,16384],['fmax',1,1e6],['time',0,1e9]] as const)if(!finite(s[key],lo,hi)||((key==='seed'||key==='bins')&&!Number.isInteger(s[key])))return `$.${key}`;
  if(s.v!==1)return '$.v';if(s.mode!=='aviation')return '$.mode';
  const trackPath=(t:Track,path:string):string=>{if(!t)return path;for(const [key,lo,hi] of [['x',-1e9,1e9],['y',-1e9,1e9],['depth',0,1e6],['course',-1e6,1e6],['speed',0,500]] as const)if(!finite(t[key],lo,hi))return `${path}.${key}`;return '';};
  const own=trackPath(s.ownship,'$.ownship');if(own)return own;
  const e=s.environment;if(!e)return '$.environment';
  for(const [key,lo,hi] of [['seaState',0,6],['soundSpeed',1300,1800],['transition',1,1e9]] as const)if(!finite(e[key],lo,hi))return `$.environment.${key}`;
  if(!['light','moderate','heavy'].includes(e.shipping))return '$.environment.shipping';if(!['spherical','cylindrical','hybrid'].includes(e.spreading))return '$.environment.spreading';
  if(!Array.isArray(s.contacts)||s.contacts.length>250)return '$.contacts';if(!Array.isArray(s.buoys)||s.buoys.length>128)return '$.buoys';
  const ids=new Set<string>();
  for(let i=0;i<s.contacts.length;i++){const c=s.contacts[i],p=`$.contacts[${i}]`,bad=trackPath(c,p);if(bad)return bad;
    if(typeof c.id!=='string'||!c.id||ids.has(c.id))return `${p}.id`;ids.add(c.id);
    if(c.catalogRef){try{resolveContactParams(c,s.time,s.reactorOffline);}catch{return `${p}.catalogRef`;}}
    const a=c.catalogRef?resolveContactParams(c,s.time,s.reactorOffline):c.params;if(!a)return `${p}.params`;if(typeof a.label!=='string')return `${p}.params.label`;
    for(const [key,lo,hi] of [['shaftHz',.01,1000],['blades',1,20],['tonalHz',1,1e6],['levelDb',0,220],['modulation',0,.9]] as const)if(!finite(a[key],lo,hi)||(key==='blades'&&!Number.isInteger(a[key])))return `${p}.params.${key}`;
    if(!Array.isArray(c.motion)||!c.motion.length)return `${p}.motion`;let last=-1;
    for(let j=0;j<c.motion.length;j++){const leg=c.motion[j],q=`${p}.motion[${j}]`;if(!leg)return q;
      if(!finite(leg.at,0,1e9)||leg.at<=last||(j===0&&leg.at!==0))return `${q}.at`;last=leg.at;
      for(const [key,lo,hi] of [['course',-1e6,1e6],['speed',0,500],['depth',0,1e6]] as const)if(!finite(leg[key],lo,hi))return `${q}.${key}`;
      if(leg.waypoint!==undefined)return `${q}.waypoint`;
    }if(c.transients!==undefined){if(!Array.isArray(c.transients)||c.transients.length>512)return `${p}.transients`;const k=c.transients.findIndex(badTransient);if(k>=0)return `${p}.transients[${k}]`;}if(c.behaviour!==undefined&&!BEHAVIOUR_KINDS.includes(c.behaviour))return `${p}.behaviour`;
  }
  ids.clear();for(let i=0;i<s.buoys.length;i++){const b=s.buoys[i],p=`$.buoys[${i}]`,bad=trackPath(b,p);if(bad)return bad;if(typeof b.id!=='string'||!b.id||ids.has(b.id))return `${p}.id`;ids.add(b.id);
    if(!['passive-omni','difar'].includes(b.type))return `${p}.type`;
    for(const [key,lo,hi] of [['rfChannel',0,9999],['deployedAt',0,1e9],['life',.001,1e9]] as const)if(!finite(b[key],lo,hi)||(key==='rfChannel'&&!Number.isInteger(b[key])))return `${p}.${key}`;
  }return '$';
}
export const exampleScenarios:Record<string,Scenario>={'m1-cpa-pass':cpaScenario(),'benchmark-busy-field':busyScenario()};

/** Seeded broadband teaching pass: coherent Lloyd striations, not a real platform signature. */
export function lloydsCpaScenario(seed=712):Scenario {
 const s=cpaScenario();s.seed=seed;s.bins=4096;s.fmax=s.fMax=6000;s.fBin=6000/4095;s.band=[0,6000];s.environment.seaState=0;s.environment.shipping='light';s.buoys[0].depth=60;
 const c=s.contacts[0];c.id='fictional-broadband-pass';c.x=-1800+(seed%101);c.y=2500;c.depth=40;c.speed=14;c.motion=[{at:0,course:Math.PI/2,speed:14,depth:40}];
 c.params={label:'Cavitating Training Contact',shaftHz:2.5,blades:5,tonalHz:100,levelDb:175,modulation:.6,tonals:[],cavitationPower:.3};return s;
}
exampleScenarios['m2-lloyds-cpa']=lloydsCpaScenario();

/** Fictional diesel teaching pass: rich CSR/CFR/EFR/EDA family, clear CPA Doppler curve, and a
 * small engine-slowdown knee (ratio-locked). Illustration-only — not a real platform signature. */
export function dieselDynScenario(seed=0xD1E501):Scenario {
 const s=cpaScenario();s.seed=seed;s.bins=2048;s.fmax=s.fMax=500;s.fBin=500/2047;s.band=[0,500];s.environment.seaState=1;s.environment.shipping='light';
 s.buoys[0].depth=60;s.buoys[0].type='difar';
 const v=8,course=Math.PI/2,cpa=450,tCpa=180;
 const c=s.contacts[0];c.id='fictional-diesel-dyn';c.category='subsurface';c.classificationTarget=true;c.behaviour='transit';
 c.catalogRef={classId:'blue-brindleflux',variantId:'base'};c.operatingMode='SNORK';c.params=undefined as never;
 c.depth=12;c.speed=v;c.course=course;c.x=-tCpa*v*Math.sin(course)+cpa*Math.cos(course);c.y=-tCpa*v*Math.cos(course)-cpa*Math.sin(course);
 // Steady approach through CPA, then a mild speed drop (moves BR/PSR); engine-ramp knee mid-pass.
 // Seed-varied knee start/duration/depth (not fixed last-20%); ratio-locked EDA tracks CFR.
 const kRng=((seed*1664525+1013904223)>>>0)/4294967296,kAt=60+Math.floor(kRng*120),kDur=25+Math.floor(((seed*22695477)>>>0)/4294967296*40),kTo=.78+.12*(((seed*69069)>>>0)%1000)/1000;
 c.motion=[{at:0,course,speed:v,depth:12},{at:kAt+kDur+20,course,speed:v*.82,depth:12}];
 c.transients=[{at:kAt,kind:'engine-ramp',params:{durationS:kDur,fromScale:1,toScale:Number(kTo.toFixed(3))}}];
 return loadScenario(s);
}
exampleScenarios['m3-diesel-dyn']=dieselDynScenario();
