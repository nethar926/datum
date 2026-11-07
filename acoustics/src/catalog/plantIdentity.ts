import {deriveSeed,mulberry32} from '../prng.js';
import {makeDrivetrain,type Drivetrain,type VesselPlantSpec} from './drivetrain.js';
const stream=(id:string,feature:string)=>mulberry32(deriveSeed(0x51d3a97,`${id}:${feature}`));
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
/** Wilson (2026-11-06): PSR typically 2–7 Hz; overall teaching envelope 1–17 Hz. */
export const PSR_TYPICAL_LO_HZ=2;
export const PSR_TYPICAL_HI_HZ=7;
export const PSR_ENVELOPE_LO_HZ=1;
export const PSR_ENVELOPE_HI_HZ=17;
/** Most class max shaft RPM ≤ this (~9.2 Hz); 1–2 outliers may reach 600–1020. */
export const PSR_TYPICAL_MAX_RPM=550;
export const PSR_OUTLIER_MAX_RPM=1020;
/** Documented high-PSR outliers (maxShaftRpm). */
export const PSR_OUTLIER_MAX_SHAFT_RPM:Readonly<Record<string,number>>={
 'red-dorhan-mistacorn':900,
 'red-lanternmoss':720,
};
/** Wilson (2026-11-06): diesel ERPM teaching envelope. */
export const ERPM_ENVELOPE_LO=150;
export const ERPM_ENVELOPE_HI=2000;
/** Configuration only. Independent ID-keyed streams never consume scenario/hull PRNG draws. */
export function varyPlantIdentity(s:VesselPlantSpec,id:string):VesselPlantSpec {
 const p=s.machinery,diesel='engines' in p;
 // Cap diesel GR ratio so ERPM = shaft×ratio stays inside the 150–2000 teaching envelope.
 const maxEngineRatio=Math.max(2.2,Math.min(4.6,ERPM_ENVELOPE_HI/Math.max(1,s.maxPsrpm)));
 const gear=(d:Drivetrain,key:string)=>{if(d.kind==='direct')return;const rng=stream(id,key),stages=d.stages.map((_,i)=>{const pinionTeeth=17+Math.floor(rng()*13);const span=key==='turbine'&&i===1?2.5:key==='engine-gear'?Math.min(1.2,Math.max(.4,maxEngineRatio-2.5)):1.2;let bullTeeth=Math.round(pinionTeeth*(2.5+rng()*span));while(gcd(pinionTeeth,bullTeeth)!==1)bullTeeth++;return {pinionTeeth,bullTeeth};});Object.assign(d,makeDrivetrain(d.kind,stages));};
 if(diesel){if(p.drivetrain)gear(p.drivetrain,'engine-gear');if(p.kind!=='dieselElectric')for(const e of p.engines){
  // Coupled plants: live ERPM tracks shaft×ratio. Keep the catalog obsMin floor; obsMax follows physics.
  const coupledMax=s.maxPsrpm*p.drivetrain!.ratio;
  e.erpm.obsMax=Math.min(ERPM_ENVELOPE_HI,Math.max(e.erpm.obsMax,coupledMax));
  // Prefer exact coupling match when within envelope.
  if(coupledMax<=ERPM_ENVELOPE_HI)e.erpm.obsMax=coupledMax;
  e.erpm.obsMin=Math.min(e.erpm.obsMax*.95,Math.max(ERPM_ENVELOPE_LO,e.erpm.obsMin));
  e.erpm.normal=Math.min(e.erpm.obsMax,Math.max(e.erpm.obsMin,e.erpm.obsMax*.7));
 }}
 else {gear(p.mainTurbines.drivetrain,'turbine');if(p.kind==='nuclearGR')p.mainTurbines.maxRpm=s.maxPsrpm*p.mainTurbines.drivetrain.ratio;}
 if(p.motor){gear(p.motor.drivetrain,'motor-gear');p.motor.maxRpm=s.maxPsrpm*p.motor.drivetrain.ratio;}
 const rng=stream(id,'eda'),names=['LOP','Cooling pump','Fuel transfer','Lube scavenger','Freshwater pump','Ventilation drive'];
 for(let i=names.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[names[i],names[j]]=[names[j],names[i]];}
 if(id==='blue-brindleflux'){const at=names.indexOf('LOP');[names[0],names[at]]=[names[at],names[0]];}
 // Wilson: each EDA has its own harmonic count 0–5 (1–2 typical). Seeded weights aim for fleet median 1–2.
 const pickEdaHarmonics=():number[]=>{const u=rng();const n=u<.08?0:u<.40?1:u<.78?2:u<.90?3:u<.97?4:5;return Array.from({length:n},(_,h)=>h+1);};
 s.edas=diesel?Array.from({length:2+Math.floor(rng()*2)},(_,i)=>{const example=id==='blue-brindleflux'&&i===0,cfrMultiple=example?27.75:3+Math.floor(rng()*41)+[.25,.5,.75][Math.floor(rng()*3)],name=example?'LOP':names[i];let harmonics=example?[1,2]:pickEdaHarmonics();if(i===0&&!harmonics.length)harmonics=[1];return {id:`fictional-eda-${i}`,name,cfrMultiple,perCrankRev:cfrMultiple*(p.engines[0].stroke===4?.5:1),harmonics,ramp:{riseS:3,fallS:2}};}):[];
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
 // Continuous SSMA on a seeded subset (~1/3 of classes) as a classification clue. Some are
 // harmonics-only (no fundamental) per Wilson CUT notes; not engine-proportional.
 const SSMA_IDS=new Set(['blue-orbelune','green-fennelglint','red-emberbraid','red-gloamspiral','blue-vellumwake','red-frostwhorl','green-thistledrift']);
 if(SSMA_IDS.has(id)&&!s.aux.some(a=>a.kind==='ssma')){const sm=stream(id,'ssma-teach'),harmonicsOnly=sm()<.45;s.aux.push({id:'fictional-ssma',kind:'ssma',duty:'continuous',fHz:Number((48+sm()*40).toFixed(2)),harmonics:harmonicsOnly?[2,3]:[1,2],stability:'unstable',width:'discrete'});}
 for(const a of s.aux)if(a.kind==='ssma'){a.stability='unstable';a.width='discrete';delete a.sigmaBins;}
 // Intermittent edge shapes + A/C compressor on a class subset (Wilson intermittent sources).
 const edges:Array<'fade'|'abrupt'|'knee'>=['fade','abrupt','knee'];
 for(const a of s.aux)if(a.duty==='intermittent'&&a.kind!=='hydp'){const e=stream(id,`edge:${a.id}`);a.edge=edges[Math.floor(e()*3)];}
 const AC_IDS=new Set(['blue-brindleflux','green-morrowcoil','red-cinderlilt','red-sablequill','blue-quartzwhorl','green-opalweft']);
 if(AC_IDS.has(id)&&!s.aux.some(a=>a.id==='fictional-ac-compressor')){const ac=stream(id,'ac-comp');s.aux.push({id:'fictional-ac-compressor',kind:'acPump',duty:'intermittent',fHz:Number((55+ac()*90).toFixed(2)),harmonics:ac()<.5?[1]:[1,2],stability:'stable',width:'discrete',dutyOnS:[40+Math.floor(ac()*40),90+Math.floor(ac()*50)] as [number,number],dutyOffS:[50+Math.floor(ac()*40),140+Math.floor(ac()*80)] as [number,number],edge:edges[Math.floor(ac()*3)]});}
 // Class-specific narrowband unintentional transients (subset) — classification clues.
 const TR_IDS=new Set(['blue-brindleflux','green-thistledrift','red-velvetshoal','red-lanternmoss','blue-orbelune']);
 if(TR_IDS.has(id)){const tr=stream(id,'class-transient');s.classTransients=[{id:'fictional-tool-drop',name:'Dropped tool',hz:Number((180+tr()*220).toFixed(2)),harmonics:tr()<.6?[1]:[1,2],durationS:Number((.4+tr()*1.2).toFixed(2))}];}
 return s;
}
/** Hash order, not catalog insertion order, assigns non-overlapping teaching bands.
 * The fixed roster is a design input; there is no runtime or per-hull randomization. */
export function identityBands(ids:readonly string[]):Map<string,{hydpHz:number;loHz:number;hiHz:number}> {
 const ordered=[...ids].sort((a,b)=>deriveSeed(0x79c2,a)-deriveSeed(0x79c2,b)||(a<b?-1:a>b?1:0)),anchor=ordered.indexOf('blue-brindleflux');
 return new Map(ordered.map((id,i)=>[id,{hydpHz:Number((367.77*1.1**(i-anchor)).toFixed(2)),loHz:20+i*21,hiHz:34+i*21}]));
}
