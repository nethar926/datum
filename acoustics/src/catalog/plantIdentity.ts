import {deriveSeed,mulberry32} from '../prng.js';
import {makeDrivetrain,type Drivetrain,type VesselPlantSpec} from './drivetrain.js';
const stream=(id:string,feature:string)=>mulberry32(deriveSeed(0x51d3a97,`${id}:${feature}`));
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
/** Configuration only. Independent ID-keyed streams never consume scenario/hull PRNG draws. */
export function varyPlantIdentity(s:VesselPlantSpec,id:string):VesselPlantSpec {
 const p=s.machinery,diesel='engines' in p;
 const gear=(d:Drivetrain,key:string)=>{if(d.kind==='direct')return;const rng=stream(id,key),stages=d.stages.map((_,i)=>{const pinionTeeth=17+Math.floor(rng()*13);let bullTeeth=Math.round(pinionTeeth*(2.5+rng()*(key==='turbine'&&i===1?2.5:1.2)));while(gcd(pinionTeeth,bullTeeth)!==1)bullTeeth++;return {pinionTeeth,bullTeeth};});Object.assign(d,makeDrivetrain(d.kind,stages));};
 if(diesel){if(p.drivetrain)gear(p.drivetrain,'engine-gear');if(p.kind!=='dieselElectric')for(const e of p.engines){e.erpm.obsMax=s.maxPsrpm*p.drivetrain!.ratio;e.erpm.obsMin=e.erpm.obsMax*.15;e.erpm.normal=e.erpm.obsMax*.7;}}
 else {gear(p.mainTurbines.drivetrain,'turbine');if(p.kind==='nuclearGR')p.mainTurbines.maxRpm=s.maxPsrpm*p.mainTurbines.drivetrain.ratio;}
 if(p.motor){gear(p.motor.drivetrain,'motor-gear');p.motor.maxRpm=s.maxPsrpm*p.motor.drivetrain.ratio;}
 const rng=stream(id,'eda'),names=['LOP','Cooling pump','Fuel transfer','Lube scavenger','Freshwater pump','Ventilation drive'];
 for(let i=names.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[names[i],names[j]]=[names[j],names[i]];}
 if(id==='blue-brindleflux'){const at=names.indexOf('LOP');[names[0],names[at]]=[names[at],names[0]];}
 s.edas=diesel?Array.from({length:2+Math.floor(rng()*2)},(_,i)=>{const example=id==='blue-brindleflux'&&i===0,cfrMultiple=example?27.75:3+Math.floor(rng()*41)+[.25,.5,.75][Math.floor(rng()*3)],name=example?'LOP':names[i];return {id:`fictional-eda-${i}`,name,cfrMultiple,perCrankRev:cfrMultiple*(p.engines[0].stroke===4?.5:1),harmonics:[1,2,3],ramp:{riseS:3,fallS:2}};}):[];
 const motor=stream(id,'slots');delete s.motorSlots;if(diesel&&p.motor&&(id==='blue-orbelune'||motor()<.55))s.motorSlots=id==='blue-orbelune'?124:48+Math.floor(motor()*153);
 const hydp=stream(id,'hydraulics');s.hydp={nominalHz:Number((120+hydp()*1100).toFixed(2)),pairSpacingHz:Number((.6+hydp()*2.2).toFixed(2)),durationS:6+Math.floor(hydp()*15)};
 for(const a of s.aux){const aux=stream(id,`aux:${a.id}`);a.fHz=a.kind==='hydp'?s.hydp.nominalHz:a.kind==='electrical'?a.fHz:Number((12+aux()*85).toFixed(2));}
 // Wilson AC/DC bar: AC AUX (electrical/acPump/acvr) stable+discrete; DC (dcvr) unstable+discrete.
 for(const a of s.aux){
  if(a.kind==='electrical'||a.kind==='acPump'||a.kind==='acvr'){a.stability='stable';a.width='discrete';delete a.sigmaBins;}
  else if(a.kind==='dcvr'){a.stability='unstable';a.width='discrete';delete a.sigmaBins;}
 }
 // Guarantee a DC teaching aux on diesel plants when none exists (seeded fictional Hz).
 if(diesel&&!s.aux.some(a=>a.kind==='dcvr')){const d=stream(id,'dc-teach');s.aux.push({id:'fictional-dc-bus',kind:'dcvr',duty:'continuous',fHz:Number((22+d()*55).toFixed(2)),harmonics:[1,2],stability:'unstable',width:'discrete'});}
 return s;
}
/** Hash order, not catalog insertion order, assigns non-overlapping teaching bands.
 * The fixed roster is a design input; there is no runtime or per-hull randomization. */
export function identityBands(ids:readonly string[]):Map<string,{hydpHz:number;loHz:number;hiHz:number}> {
 const ordered=[...ids].sort((a,b)=>deriveSeed(0x79c2,a)-deriveSeed(0x79c2,b)||(a<b?-1:a>b?1:0)),anchor=ordered.indexOf('blue-brindleflux');
 return new Map(ordered.map((id,i)=>[id,{hydpHz:Number((367.77*1.1**(i-anchor)).toFixed(2)),loHz:20+i*21,hiHz:34+i*21}]));
}
