import {deriveSeed,mulberry32} from '../prng.js';
import {tagLine,type Signature,type TonalFamily,type LineProfile,type HydpShape,type HydpTransientState} from '../sourceModel.js';
import {shaftDrivetrain,firingRateHz,edaFrequencyHz,vanePassHz,type VesselPlantSpec,type PropulsionTruth,type Plant,drivetrainCode,drivetrainLabel} from './drivetrain.js';
import {normalizeMode,type ModeInput,type OperatingMode} from './schema.js';
export type DieselRichness='sparse'|'partial'|'rich';
interface State {spec:VesselPlantSpec;factors:Float64Array;selected:Uint8Array;truth:PropulsionTruth;bright: {efr:number;csr:number;cfr:number}[];richness:DieselRichness}
const states=new WeakMap<Signature,State>();
function enginesEnabled(p:Plant,mode:OperatingMode):boolean{return p.kind==='dieselDirect'?(mode==='SNORK'||mode==='SURF'||mode==='D/E'):mode!=='BATT'&&mode!=='AIP';}
const AIP_HZ={stirling:28,fuelcell:42,'closed-cycle':34} as const;
const NO_GATES:readonly import('./drivetrain.js').SpeedGated[]=[];
const NO_SRCS:readonly number[]=[];
const DEFAULT_HARMONICS=[1,2,3] as const;
/** Diesel CSR/CFR/EFR teaching orders (Urick/Ross machinery harmonics; invented powers). */
export const ENGINE_HARMONICS=[1,2,3,4,5,6] as const;
/** Invented per-engine brightness profiles (h=1 base powers). EFR>CSR>CFR is common (~55%), not mandatory. */
export const DIESEL_BRIGHTNESS_PROFILES=[{efr:.2,csr:.08,cfr:.03},{efr:.18,csr:.09,cfr:.035},{efr:.14,csr:.11,cfr:.04},{efr:.1,csr:.13,cfr:.05},{efr:.12,csr:.07,cfr:.09},{efr:.16,csr:.05,cfr:.07}] as const;
export function pickDieselBrightness(seed:number,contactId:string,engineId:string):{efr:number;csr:number;cfr:number}{
 const rng=mulberry32(deriveSeed(seed,`diesel-bright:${contactId}:${engineId}`));
 return DIESEL_BRIGHTNESS_PROFILES[Math.floor(rng()*DIESEL_BRIGHTNESS_PROFILES.length)]!;
}
/** Seeded diesel family richness: sparse / partial / rich (Wilson: sketches are examples, not every contact). */
export function pickDieselRichness(seed:number,contactId:string):DieselRichness{
 const rng=mulberry32(deriveSeed(seed,`diesel-rich:${contactId}`)),u=rng();
 return u<.28?'sparse':u<.62?'partial':'rich';
}
/** Max live harmonic order + floor-fade factor for higher orders. */
export function dieselHarmonicGain(richness:DieselRichness,h:number):number{
 const maxLive=richness==='sparse'?2:richness==='partial'?4:6;
 if(h>maxLive)return 0; // no power above live band (topology slots stay at 0)
 // Gradual fade toward higher harmonics; last live lines barely above floor.
 const t=(h-1)/Math.max(1,maxLive-1);
 return Math.max(.06,1-.78*t*t);
}
/** Configuration only: independent contact streams for installed-shaft mismatch and engine selection.
 * plantRpmScale (Signature) applies live engine-ramp knees; no catalog sheet is randomized. */
export function configurePropulsion(s:Signature,seed=0,contactId='catalog',mode:ModeInput='NUC'):PropulsionTruth {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);
 const spec=s.plantSpec;
 if(!spec){const truth:PropulsionTruth={kind:'unspecified',tpk:0,tpkValid:false,propulsor:{shafts:s.shafts??1,blades:s.blades,bladeType:'flat',brHz:s.shaftHz*s.blades},mode:mode as OperatingMode,drivetrainCode:'unspecified',drivetrainLabel:'unspecified',ratio:1,ratioLabel:'1.00:1',engines:[],stages:[],shafts:Array.from({length:s.shafts??1},()=>({rpm:s.shaftHz*60,hz:s.shaftHz,coupled:false}))};s.propulsion=truth;return truth;}
 const p=spec.machinery,d=shaftDrivetrain(p,mode),electrical=s.electricalHz??60,diesel=p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric',engines=diesel?p.engines:[],rng=mulberry32(deriveSeed(seed,`${contactId}:engines`)),selected=new Uint8Array(engines.length),factors=new Float64Array(spec.shafts);let count=0;
 for(let i=0;i<engines.length;i++){selected[i]=p.kind==='dieselDirect'||rng()<.65?1:0;count+=selected[i];}if(engines.length&&!count)selected[Math.floor(rng()*engines.length)]=1;
 factors[0]=1;for(let i=1;i<factors.length;i++){const r=mulberry32(deriveSeed(seed,`${contactId}:shaft:${i}`)),delta=(spec.shaftMismatchPct[0]+r()*(spec.shaftMismatchPct[1]-spec.shaftMismatchPct[0]))/100;factors[i]=1+(r()<.5?-delta:delta);}
 const bright=engines.map(e=>pickDieselBrightness(seed,contactId,e.id)),richness=pickDieselRichness(seed,contactId);
 const truth:PropulsionTruth={kind:p.kind,tpk:spec.tpk??0,tpkValid:false,...(spec.tpkMinKts?{tpkMinKts:spec.tpkMinKts}:{}),propulsor:{shafts:spec.shafts,blades:s.blades,bladeType:spec.propeller?.type??'flat',brHz:0},...(spec.emergencyPropulsor?{emergencyPropulsor:{active:false,rpm:0,hz:0,blades:spec.emergencyPropulsor.blades}}:{}),mode:mode as OperatingMode,drivetrainCode:drivetrainCode(p),drivetrainLabel:drivetrainLabel(p),...(spec.aip?{aip:{kind:spec.aip.kind,active:mode==='AIP'}}:{}),ratio:d.ratio,ratioLabel:d.ratioLabel,engines:engines.map(e=>({id:e.id,stroke:e.stroke,cylinders:e.cylinders,erpm:0,running:false,csrHz:0,cfrHz:0,efrHz:0})),stages:d.stages.map(g=>({...g,ratio:g.bullTeeth/g.pinionTeeth,meshHz:0})),shafts:Array.from({length:spec.shafts},()=>({rpm:0,hz:0,coupled:false})),generators:Array.from({length:diesel?(p.kind==='dieselElectric'?engines.length:1):('turbineGenerators' in p?p.turbineGenerators.count:0)},()=>({rpm:0,hz:electrical})),...(p.motor?{motor:{rpm:0,shaftHz:0,slots:spec.motorSlots??0,msrHz:0}}:{})};
 states.set(s,{spec,factors,selected,truth,bright,richness});s.propulsion=truth;return truth;
}
/** Fill the preallocated nested truth in Hz/RPM. D/E generator RPM is independent of speed.
 * A stopped D/E generator leaves the 50/60-Hz inverter bus; direct diesels use service sets. */
export function updatePropulsion(s:Signature,fraction:number,mode:ModeInput):PropulsionTruth {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);
 let state=states.get(s);if(!state){configurePropulsion(s,0,'catalog',mode);state=states.get(s);}if(!state)return s.propulsion!;
 const {spec,truth:t,factors,selected}=state,p=spec.machinery,d=shaftDrivetrain(p,mode),hz=spec.maxPsrpm/60*Math.max(0,Math.min(1,fraction)),electrical=s.electricalHz??60;
 const adjusted=fraction>0&&spec.tpk&&spec.tpkMinKts?Math.max(fraction,spec.tpk*spec.tpkMinKts/spec.maxPsrpm):fraction;
 const rpmScale=Number.isFinite(s.plantRpmScale)?Math.max(0,s.plantRpmScale!):1;
 for(let i=0;i<t.shafts.length;i++){const shaft=t.shafts[i];shaft.rpm=spec.maxPsrpm*Math.max(0,Math.min(1,adjusted))*factors[i];shaft.hz=shaft.rpm/60;shaft.coupled=(p.kind==='dieselDirect'||p.kind==='dieselGR')?enginesEnabled(p,mode)&&mode!=='D/E':p.kind==='nuclearGR'&&mode!=='AIP';}
 if(p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric'){
  const enabled=enginesEnabled(p,mode);for(let i=0;i<t.engines.length;i++){const e=t.engines[i];e.running=enabled&&selected[i]!==0&&(p.kind==='dieselElectric'||mode==='D/E'||hz>0);e.erpm=e.running?(p.kind==='dieselElectric'||mode==='D/E'?p.engines[i].erpm.normal:(p.kind==='dieselDirect'?t.shafts[i%t.shafts.length].rpm:t.shafts[0].rpm*d.ratio))*rpmScale:0;e.csrHz=e.erpm/60;e.cfrHz=e.csrHz/(e.stroke===4?2:1);e.efrHz=firingRateHz(e,e.erpm);}
  // Coupled D/D / GR: shaft follows the same engine-ramp scale so CSR≡PSR stays exact through a knee.
  if(rpmScale!==1)for(let i=0;i<t.shafts.length;i++){const shaft=t.shafts[i];if(!shaft.coupled)continue;shaft.rpm*=rpmScale;shaft.hz=shaft.rpm/60;}
  for(let i=0;i<t.generators!.length;i++){const g=t.generators![i];g.rpm=p.kind==='dieselElectric'?t.engines[i].erpm:electrical*60/2;g.hz=g.rpm/60*(p.kind==='dieselElectric'?p.generator!.polePairs:2);}
 }else if('turbineGenerators' in p)for(let i=0;i<t.generators!.length;i++){const g=t.generators![i],r=p.reactorSets[i]?.turboGenerator??p.turbineGenerators;g.rpm=r.rpm;g.hz=g.rpm/60*r.polePairs;}
 if(t.motor){t.motor.rpm=(p.kind==='dieselDirect'||p.kind==='dieselGR')&&enginesEnabled(p,mode)&&mode!=='D/E'?0:t.shafts[0].rpm*p.motor!.drivetrain.ratio;t.motor.shaftHz=t.motor.rpm/60;t.motor.msrHz=t.motor.shaftHz*t.motor.slots;}
 if(mode==='AIP'){if(!spec.aip||((p.kind==='nuclearGR'||p.kind==='nuclearElectric')&&!s.reactorOffline))throw new Error('AIP backup requires capability and reactor-off for nuclear');for(const g of t.generators!){g.hz=AIP_HZ[spec.aip.kind];g.rpm=g.hz*60/2;}}
 t.tpkValid=!!spec.tpk&&(!spec.tpkMinKts||fraction*spec.maxPsrpm/spec.tpk+1e-9>=spec.tpkMinKts);t.propulsor.brHz=t.shafts[0].hz*s.blades;if(t.stages.length!==d.stages.length||t.ratio!==d.ratio)throw new Error('Reconfigure static mode before changing drivetrain');t.mode=mode as OperatingMode;if(t.aip)t.aip.active=mode==='AIP';let input=t.shafts[0].hz*d.ratio;for(const g of t.stages){g.meshHz=input*g.pinionTeeth;input/=g.ratio;}return t;
}
function put(s:Signature,i:number,family:TonalFamily,hz:number,power:number,harmonic:number,shaftIndex?:number,engineIndex?:number,profile?:LineProfile,reactorId?:string,operatorFamily?:'COOLANT'|'TG'|'VANE'|'HYDP'):void {
 let l=s.tonals![i];if(!l)l=s.tonals![i]={family,hz,power};if(family!=='eda')l.eda=undefined;l.reactorId=reactorId;l.family=family;l.hz=hz;l.power=power;l.harmonic=harmonic;l.shaftIndex=shaftIndex;l.engineIndex=engineIndex;l.engineId=engineIndex===undefined?undefined:s.propulsion!.engines[engineIndex].id;l.lineFamily=operatorFamily??(family==='shaft'?'PSR':family==='blade'?'BR':family==='electrical'?'GRID':family==='src'?'SRC':family==='motor'&&shaftIndex===0?'MSR':family==='crank'?'CSR':family==='cylinder'?'CFR':family==='diesel'?'EFR':family==='eda'?'EDA':family==='gear'?'MESH':family==='turbine'?'TURBINE':family==='pump'||family==='motor'?'AUX':undefined);const engine=engineIndex===undefined?undefined:s.propulsion!.engines[engineIndex];l.fundamentalHz=family==='shaft'?s.propulsion!.shafts[shaftIndex!].hz:family==='blade'?s.propulsion!.shafts[shaftIndex!].hz*s.blades:family==='motor'&&shaftIndex===0?s.propulsion!.motor!.msrHz:family==='crank'?engine!.csrHz:family==='cylinder'?engine!.cfrHz:family==='diesel'?engine!.efrHz:l.lineFamily?hz/harmonic:undefined;tagLine(l,i,profile??s.lineProfiles?.[family]);
}
/** Public rotation orders only (Urick/Ross); relative powers are invented. Fixed topology
 * for a fixed mode: inactive installed engines keep zero-power slots; updates reuse records. */
export function writePlantTonals(s:Signature,mode:ModeInput,electricalHarmonics:readonly number[]=DEFAULT_HARMONICS,srcHzPerKn:readonly number[]=NO_SRCS,speedKn=0):void {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);const spec=s.plantSpec!,p=spec.machinery,t=s.propulsion!;let i=0;
 for(let shaft=0;shaft<t.shafts.length;shaft++){const hz=t.shafts[shaft].hz;for(let h=1;h<=3;h++){put(s,i++,'shaft',hz*h,hz>0?.1/(h*h):0,h,shaft);put(s,i++,'blade',hz*s.blades*h,hz>0?.25/(h*h):0,h,shaft);}}
 for(const h of electricalHarmonics)put(s,i++,'electrical',(mode==='AIP'?AIP_HZ[spec.aip!.kind]:(s.electricalHz??60))*h,.04/(h*h),h);
 if(p.motor){for(let h=1;h<=3;h++)put(s,i++,'motor',(t.motor!.slots?t.motor!.msrHz:t.motor!.shaftHz)*h,t.motor!.rpm>0?.05/(h*h):0,h,t.motor!.slots?0:undefined);}
 // Seeded brightness + richness (sparse/partial/rich). Topology always emits 1..6 slots; power fades.
 if(enginesEnabled(p,mode)){const st=states.get(s);const bright=st?.bright??t.engines.map(()=>DIESEL_BRIGHTNESS_PROFILES[0]),richness=st?.richness??'partial';
  for(let e=0;e<t.engines.length;e++){const engine=t.engines[e],b=bright[e]??DIESEL_BRIGHTNESS_PROFILES[0];for(const h of ENGINE_HARMONICS){const g=dieselHarmonicGain(richness,h);put(s,i++,'crank',engine.csrHz*h,engine.running?b.csr*g/(h*h):0,h,undefined,e);put(s,i++,'diesel',engine.efrHz*h,engine.running?b.efr*g/(h*h):0,h,undefined,e);put(s,i++,'cylinder',engine.cfrHz*h,engine.running?b.cfr*g/(h*h):0,h,undefined,e);}for(const eda of spec.edas)for(const h of eda.harmonics){const at=i++,g=dieselHarmonicGain(richness,h),f0=edaFrequencyHz(engine.cfrHz,eda.cfrMultiple);put(s,at,'eda',f0*h,engine.running?.05*g/(h*h):0,h,undefined,e);const l=s.tonals![at];l.eda??={name:eda.name,cfrMultiple:eda.cfrMultiple};l.eda.name=eda.name;l.eda.cfrMultiple=eda.cfrMultiple;l.fundamentalHz=f0;}}}
 if(mode!=='AIP'&&(p.kind==='nuclearGR'||p.kind==='nuclearElectric')){const n=p.kind==='nuclearGR'?t.shafts.length:1;for(let shaft=0;shaft<n;shaft++){const rpm=p.kind==='nuclearGR'?t.shafts[shaft].rpm*t.ratio:p.mainTurbines.maxRpm;for(let h=1;h<=3;h++)put(s,i++,'turbine',rpm/60*h,rpm>0?.04*p.mainTurbines.count/n/(h*h):0,h,shaft);for(let h=1;h<=3;h++)put(s,i++,'turbine',vanePassHz(rpm/60,p.mainTurbines.vaneCount)*h,rpm>0?.02*p.mainTurbines.count/n/(h*h):0,h,shaft,undefined,undefined,undefined,'VANE');}}
 for(let shaft=0;shaft<t.shafts.length;shaft++){const ratio=t.shafts[0].hz>0?t.shafts[shaft].hz/t.shafts[0].hz:1;for(const g of t.stages)for(let h=1;h<=3;h++)put(s,i++,'gear',g.meshHz*ratio*h,g.meshHz>0?.035/(h*h):0,h,shaft);}
 if(mode!=='AIP'&&('reactorSets' in p))for(const r of p.reactorSets)for(let h=1;h<=3;h++){put(s,i++,'pump',r.coolantPumpHz*h,.04/(h*h),h,undefined,undefined,undefined,r.id,'COOLANT');put(s,i++,'turbine',r.turboGenerator.rpm/60*h,.025/(h*h),h,undefined,undefined,undefined,r.id,'TG');}
 if(mode==='AIP'){for(let h=1;h<=2;h++)put(s,i++,'pump',AIP_HZ[spec.aip!.kind]*.5*h,.025/(h*h),h);}else for(const a of spec.aux)if(a.kind!=='hydp')for(const h of a.harmonics)put(s,i++,a.kind==='acPump'||a.kind==='ssma'?'pump':'motor',a.fHz*h,.025/(h*h),h,undefined,undefined,a);
 for(const w of s.speedGated??NO_GATES)if(w.kind==='SRC')for(let h=1;h<=2;h++)put(s,i++,'src',w.hz*h,.04*w.gain/(h*h),h);
 for(const rate of srcHzPerKn)put(s,i++,'src',speedKn*rate,speedKn>0?.06:0,1);
 if(s.hydpTransient&&spec.hydp)writeHydpBurst(s,i,spec.hydp,s.hydpTransient),i+=HYDP_MAX_ORDERS;
 s.tonals!.length=i;
}
/** Fixed HYDP harmonic-slot count (topology never changes). Seeded shape picks how many are live. */
export const HYDP_MAX_ORDERS=4;
/** Invented HYDP level — boosted so short bursts read on grams after NORM. */
export const HYDP_POWER=.14;
const HYDP_PROFILE:LineProfile={stability:'stable',width:'discrete'};
/** Deterministic HYDP teaching shape from scenario/contact seed (Wilson): usually 1–3 live
 * harmonics of the class frequency; sometimes drown the fundamental; tiny fade. */
export function pickHydpShape(seed:number,contactId:string):HydpShape {
 const rng=mulberry32(deriveSeed(seed,`hydp-shape:${contactId}`)),u=rng();
 const orders=u<.45?1:u<.75?2:u<.92?3:4,drownFundamental=orders>=2&&rng()<.35,fadeS=Number((.04+.08*rng()).toFixed(3));
 return {orders,drownFundamental,fadeS};
}
/** Squally hydraulic burst: speed-independent class Hz × harmonic. Fixed HYDP_MAX_ORDERS slots;
 * unused/drowned orders carry zero power. No high→fixed curve (offset unused). */
export function writeHydpBurst(s:Signature,i:number,h:import('./drivetrain.js').HydpSpec,state:HydpTransientState):void{
 const shape=state.shape,{orders,drownFundamental}=shape;
 for(let n=1;n<=HYDP_MAX_ORDERS;n++){
  const live=state.gain>0&&n<=orders&&!(drownFundamental&&n===1);
  const pow=live?HYDP_POWER*state.gain/(n*n)*(drownFundamental&&n===2?1.35:1):0;
  put(s,i+n-1,'pump',h.nominalHz*n,pow,n,undefined,undefined,HYDP_PROFILE,undefined,'HYDP');
 }
}
/** @deprecated alias — pair curve retired; writes harmonic burst slots. */
export const writeHydpPair=writeHydpBurst;
