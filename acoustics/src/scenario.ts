import type { Track } from './kinematics.js';
import type { Signature } from './sourceModel.js';
import { fictionalSignature } from './sourceModel.js';
import type { Buoy } from './buoys.js';
import type { Shipping } from './ambientNoise.js';
import type { Spreading } from './transmissionLoss.js';
export interface MotionLeg { at:number; course:number; speed:number; depth:number; waypoint?:{x:number;y:number} }
export interface Contact extends Track { id:string; params:Signature; motion:MotionLeg[]; transients?:{at:number;kind:string;params:Record<string,number|string>}[] }
export interface Environment { seaState:number; shipping:Shipping; soundSpeed:number; spreading:Spreading; transition:number }
export interface Scenario { v:1; seed:number; mode:'aviation'; bins:number; fmax:number; time:number; ownship:Track; environment:Environment; contacts:Contact[]; buoys:Buoy[] }
const finite=(x:unknown,lo:number,hi:number):x is number => typeof x==='number' && Number.isFinite(x) && x>=lo && x<=hi;
function track(t:Track):boolean { return !!t && finite(t.x,-1e9,1e9)&&finite(t.y,-1e9,1e9)&&finite(t.depth,0,1e6)&&finite(t.course,-1e6,1e6)&&finite(t.speed,0,500); }
export function validateScenario(value:unknown):asserts value is Scenario {
  const s=value as Scenario;
  if(!s || s.v!==1 || s.mode!=='aviation' || !finite(s.seed,0,4294967295)||!Number.isInteger(s.seed)||!finite(s.bins,2,16384)||!Number.isInteger(s.bins)||!finite(s.fmax,1,1e6)||!finite(s.time,0,1e9)||!track(s.ownship)) throw new Error('Invalid scenario header/ownship');
  const e=s.environment;
  if(!e||!finite(e.seaState,0,6)||!['light','moderate','heavy'].includes(e.shipping)||!finite(e.soundSpeed,1300,1800)||!['spherical','cylindrical','hybrid'].includes(e.spreading)||!finite(e.transition,1,1e9)) throw new Error('Invalid environment');
  if(!Array.isArray(s.contacts)||s.contacts.length>250||!Array.isArray(s.buoys)||s.buoys.length>128) throw new Error('Invalid counts');
  const ids=new Set<string>();
  for(const c of s.contacts){const a=c?.params;
    if(!track(c)||typeof c.id!=='string'||!c.id||ids.has(c.id)||!a||typeof a.label!=='string'||!finite(a.shaftHz,.01,1000)||!finite(a.blades,1,20)||!Number.isInteger(a.blades)||!finite(a.tonalHz,1,1e6)||!finite(a.levelDb,0,220)||!finite(a.modulation,0,.9)) throw new Error('Invalid contact'); ids.add(c.id);
    if(!Array.isArray(c.motion)||c.motion.length<1||c.motion[0].at!==0)throw new Error('Contact needs initial timed motion leg');
    let last=-1;for(const leg of c.motion){if(!finite(leg.at,0,1e9)||leg.at<=last||!finite(leg.course,-1e6,1e6)||!finite(leg.speed,0,500)||!finite(leg.depth,0,1e6))throw new Error('Invalid motion leg');if(leg.waypoint!==undefined)throw new Error('Waypoint targets reserved; use course/speed legs in M1');last=leg.at;}
    if(c.transients!==undefined && (!Array.isArray(c.transients)||c.transients.length))throw new Error('Transients reserved for future milestones');
  }
  ids.clear(); for(const b of s.buoys){ if(!track(b)||typeof b.id!=='string'||!b.id||ids.has(b.id)||!['passive-omni','difar'].includes(b.type)||!finite(b.rfChannel,0,9999)||!Number.isInteger(b.rfChannel)||!finite(b.deployedAt,0,1e9)||!finite(b.life,.001,1e9)) throw new Error('Invalid buoy');ids.add(b.id); }
}
const receiver=(id:string,x:number,y:number):Buoy => ({id,x,y,depth:40,course:0,speed:0,rfChannel:Number(id.replace(/\D/g,''))||1,deployedAt:0,life:7200,type:'difar'});
/** Generic fictional maritime patrol aircraft operator lays these patterns; no real platform signatures. */
export function cpaScenario():Scenario {return {v:1,seed:42,mode:'aviation',bins:1024,fmax:500,time:0,ownship:{x:0,y:0,depth:0,course:0,speed:100},environment:{seaState:1,shipping:'light',soundSpeed:1500,spreading:'spherical',transition:1000},contacts:[{id:'fictional-a',x:-3000,y:300,depth:80,course:Math.PI/2,speed:8,motion:[{at:0,course:Math.PI/2,speed:8,depth:80}],params:{...fictionalSignature}}],buoys:[receiver('buoy-1',0,0)]};}
export function busyScenario():Scenario {const s=cpaScenario();s.seed=131;s.environment.seaState=4;s.environment.shipping='heavy';s.contacts=[];s.buoys=[];
  for(let i=0;i<12;i++)s.contacts.push({id:`fictional-${i}`,x:(i%4-2)*1800,y:(Math.floor(i/4)-1)*2100,depth:30+15*i,course:i*.7,speed:2+i%7,motion:[{at:0,course:i*.7,speed:2+i%7,depth:30+15*i}],params:{...fictionalSignature,label:`Fictional vessel ${i}`,tonalHz:55+i*11,shaftHz:1+i*.13}});
  for(let i=0;i<8;i++)s.buoys.push(receiver(`buoy-${i+1}`,(i%4-1.5)*1200,Math.floor(i/4)*1500));return s;
}

/** Validated JSON boundary with a JSONPath-style location; existing validator remains authoritative. */
export class ScenarioError extends Error {
  constructor(message:string,readonly path:string='$'){super(`${path}: ${message}`);this.name='ScenarioError';}
}
export function loadScenario(json:unknown):Scenario {
  try{validateScenario(json);return json;}
  catch(error){throw new ScenarioError(error instanceof Error?error.message:'Invalid scenario',errorPath(json));}
}
// Diagnostic-only walk: runs only after validation fails, never in the render path.
function errorPath(value:unknown):string {
  if(!value||typeof value!=='object')return '$';const s=value as Scenario;
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
    const a=c.params;if(!a)return `${p}.params`;if(typeof a.label!=='string')return `${p}.params.label`;
    for(const [key,lo,hi] of [['shaftHz',.01,1000],['blades',1,20],['tonalHz',1,1e6],['levelDb',0,220],['modulation',0,.9]] as const)if(!finite(a[key],lo,hi)||(key==='blades'&&!Number.isInteger(a[key])))return `${p}.params.${key}`;
    if(!Array.isArray(c.motion)||!c.motion.length)return `${p}.motion`;let last=-1;
    for(let j=0;j<c.motion.length;j++){const leg=c.motion[j],q=`${p}.motion[${j}]`;if(!leg)return q;
      if(!finite(leg.at,0,1e9)||leg.at<=last||(j===0&&leg.at!==0))return `${q}.at`;last=leg.at;
      for(const [key,lo,hi] of [['course',-1e6,1e6],['speed',0,500],['depth',0,1e6]] as const)if(!finite(leg[key],lo,hi))return `${q}.${key}`;
      if(leg.waypoint!==undefined)return `${q}.waypoint`;
    }if(c.transients!==undefined&&(!Array.isArray(c.transients)||c.transients.length))return `${p}.transients`;
  }
  ids.clear();for(let i=0;i<s.buoys.length;i++){const b=s.buoys[i],p=`$.buoys[${i}]`,bad=trackPath(b,p);if(bad)return bad;if(typeof b.id!=='string'||!b.id||ids.has(b.id))return `${p}.id`;ids.add(b.id);
    if(!['passive-omni','difar'].includes(b.type))return `${p}.type`;
    for(const [key,lo,hi] of [['rfChannel',0,9999],['deployedAt',0,1e9],['life',.001,1e9]] as const)if(!finite(b[key],lo,hi)||(key==='rfChannel'&&!Number.isInteger(b[key])))return `${p}.${key}`;
  }return '$';
}
export const exampleScenarios:Record<string,Scenario>={'m1-cpa-pass':cpaScenario(),'benchmark-busy-field':busyScenario()};
