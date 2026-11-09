import {deriveSeed,mulberry32} from '../prng.js';
import {tagLine,type Signature,type TonalFamily,type LineProfile,type HydpShape,type HydpTransientState} from '../sourceModel.js';
import {shaftDrivetrain,firingRateHz,edaFrequencyHz,vanePassHz,type VesselPlantSpec,type PropulsionTruth,type Plant,drivetrainCode,drivetrainLabel} from './drivetrain.js';
import {normalizeMode,type ModeInput,type OperatingMode} from './schema.js';
export type DieselRichness='sparse'|'partial'|'rich';
interface State {lastValidFraction?:number;spec:VesselPlantSpec;factors:Float64Array;selected:Uint8Array;truth:PropulsionTruth;bright: {efr:number;csr:number;cfr:number}[];richness:DieselRichness}
const states=new WeakMap<Signature,State>();
function enginesEnabled(p:Plant,mode:OperatingMode):boolean{return p.kind==='dieselDirect'?(mode==='SNORK'||mode==='SURF'||mode==='D/E'):mode!=='BATT'&&mode!=='AIP';}
/** Coupled D/D & GR speed window from each engine's own erpm band and fixed R:R (no silent clamp).
 * speedKn = shaftRpm / tpk; shaftRpm = erpm / ratio (D/D ratio = 1). */
export function coupledSpeedWindowKn(spec:VesselPlantSpec):{min:number;max:number}|undefined {
 const p=spec.machinery;if(p.kind!=='dieselDirect'&&p.kind!=='dieselGR')return undefined;
 const ratio=p.drivetrain!.ratio,tpk=spec.tpk??0;if(!(tpk>0))return undefined;
 let lo=0,hi=Infinity;for(const e of p.engines){lo=Math.max(lo,e.erpm.obsMin/(ratio*tpk));hi=Math.min(hi,e.erpm.obsMax/(ratio*tpk));}
 if(!(hi>=lo))return undefined;return {min:lo,max:hi};
}
/** Speed window a scenario/tactics planner must respect: defined only for UNFLAGGED coupled plants
 * (dieselDirect, or dieselGR without declutchToMotor) in clutched modes (SURF/SNORK). undefined → no bound. */
export function commandSpeedWindowKn(spec:VesselPlantSpec,mode:ModeInput):{min:number;max:number}|undefined{
 const m=normalizeMode(mode,spec.machinery.kind),p=spec.machinery;if(!(m==='SURF'||m==='SNORK'))return undefined;
 if(p.kind==='dieselDirect'||(p.kind==='dieselGR'&&!spec.declutchToMotor))return coupledSpeedWindowKn(spec);return undefined;
}
/** True when commanded shaft RPM × fixed R:R sits inside every selected engine's own band. */
export function coupledErpmInBand(spec:VesselPlantSpec,shaftRpm:number,selected?:Uint8Array):boolean {
 const p=spec.machinery;if(p.kind!=='dieselDirect'&&p.kind!=='dieselGR')return false;
 const ratio=p.drivetrain!.ratio;
 for(let i=0;i<p.engines.length;i++){if(selected&&!selected[i])continue;const erpm=shaftRpm*ratio,e=p.engines[i].erpm;if(erpm<e.obsMin-1e-9||erpm>e.obsMax+1e-9)return false;}
 return p.engines.length>0;
}
/** Invented AIP plant rates (Hz). Stirling: generator electrical / 2nd harmonic of shaft.
 * Fuel-cell: inverter switching (no rotating prime mover). Closed-cycle: engine-related. */
const AIP_HZ={stirling:28,fuelcell:42,'closed-cycle':34} as const;
/** Fictional fuel-cell plant giveaways (illustrative only — not platform data). */
const FUELCELL_PLANT=[
 {id:'fc-reactant-pump',hz:23,power:.28,harmonics:[1,2]},
 {id:'fc-coolant-pump',hz:31,power:.22,harmonics:[1,2]},
 {id:'fc-cathode-blower',hz:47,power:.25,harmonics:[1]},
 {id:'fc-dcdc-inverter',hz:42,power:.18,harmonics:[1,2]},
] as const;
/** Closed-cycle diesel AIP: invented engine-firing fundamental (Hz). */
const CLOSED_CYCLE_CFR_HZ=17;
const NO_GATES:readonly import('./drivetrain.js').SpeedGated[]=[];
const NO_SRCS:readonly number[]=[];

/** Deterministic intermittent on/off gain in [0,1]. Period = onS+offS; phase from seed.
 * Edges: abrupt (~0.06 s), fade (2 s linear), knee (smoothstep over 5 s). */
export function intermittentDutyGain(t:number,onS:number,offS:number,phaseS:number,edge:'fade'|'abrupt'|'knee'='abrupt'):number{
 const period=Math.max(1e-6,onS+offS),tau=((t+phaseS)%period+period)%period;
 if(tau>=onS){const u=tau-onS; // off half — falling edge then zero
  if(edge==='abrupt'){const f=.06;return u<f?Math.max(0,1-u/f):0;}
  if(edge==='fade'){const f=2;return u<f?Math.max(0,1-u/f):0;}
  const f=5,x=Math.min(1,u/f),s=x*x*(3-2*x);return Math.max(0,1-s);
 }
 // on half — rising edge then one
 if(edge==='abrupt'){const f=.06;return tau<f?tau/f:1;}
 if(edge==='fade'){const f=2;return tau<f?tau/f:1;}
 const f=5,x=Math.min(1,tau/f),s=x*x*(3-2*x);return s;
}

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
 const truth:PropulsionTruth={kind:p.kind,tpk:spec.tpk??0,tpkValid:false,...(spec.tpkMinKts?{tpkMinKts:spec.tpkMinKts}:{}),propulsor:{shafts:spec.shafts,blades:s.blades,bladeType:spec.propeller?.type??'flat',brHz:0},...(spec.emergencyPropulsor?{emergencyPropulsor:{active:false,rpm:0,hz:0,blades:spec.emergencyPropulsor.blades}}:{}),mode:mode as OperatingMode,drivetrainCode:drivetrainCode(p),drivetrainLabel:drivetrainLabel(p),...(spec.aip?{aip:{kind:spec.aip.kind,active:mode==='AIP'}}:{}),ratio:d.ratio,ratioLabel:d.ratioLabel,coupledSpeedKn:coupledSpeedWindowKn(spec),engines:engines.map(e=>({id:e.id,stroke:e.stroke,cylinders:e.cylinders,erpm:0,running:false,csrHz:0,cfrHz:0,efrHz:0})),stages:d.stages.map(g=>({...g,ratio:g.bullTeeth/g.pinionTeeth,meshHz:0})),shafts:Array.from({length:spec.shafts},()=>({rpm:0,hz:0,coupled:false})),generators:Array.from({length:diesel?(p.kind==='dieselElectric'?engines.length:1):('turbineGenerators' in p?p.turbineGenerators.count:0)},()=>({rpm:0,hz:electrical})),...(p.motor?{motor:{rpm:0,shaftHz:0,slots:spec.motorSlots??0,msrHz:0}}:{})};
 states.set(s,{spec,factors,selected,truth,bright,richness});s.propulsion=truth;return truth;
}
/** Fill the preallocated nested truth in Hz/RPM. D/E generator RPM is independent of speed.
 * A stopped D/E generator leaves the 50/60-Hz inverter bus; direct diesels use service sets. */
export function updatePropulsion(s:Signature,fraction:number,mode:ModeInput):PropulsionTruth {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);
 let state=states.get(s);if(!state){configurePropulsion(s,0,'catalog',mode);state=states.get(s);}if(!state)return s.propulsion!;
 const {spec,truth:t,factors,selected}=state,p=spec.machinery,d=shaftDrivetrain(p,mode),electrical=s.electricalHz??60;
 const adjusted=fraction>0&&spec.tpk&&spec.tpkMinKts?Math.max(fraction,spec.tpk*spec.tpkMinKts/spec.maxPsrpm):fraction;
 const rpmScale=Number.isFinite(s.plantRpmScale)?Math.max(0,s.plantRpmScale!):1;
 // Shaft RPM always follows commanded speed (TPK). Coupling never silently clamps PSR or ERPM.
 const setShafts=(f:number)=>{for(let i=0;i<t.shafts.length;i++){const shaft=t.shafts[i];shaft.rpm=spec.maxPsrpm*Math.max(0,Math.min(1,f))*factors[i];shaft.hz=shaft.rpm/60;shaft.coupled=false;}};
 setShafts(adjusted);
 const wantClutch=(p.kind==='dieselDirect'||p.kind==='dieselGR')&&enginesEnabled(p,mode)&&mode!=='D/E';
 // Wilson/Lead: while coupled, R:R is fixed and ERPM must sit in each engine's own band.
 // declutchToMotor (explicit per-class flag, geared + propulsion motor only): out-of-band → deterministic
 // declutch (shaft on motor; diesel keeps running at band-valid charging ERPM so EDAs follow the
 // engine, not the clutch). Unflagged: the command is REJECTED — the previous valid
 // coupled command is held (first-ever command with no history: nearest edge of coupledSpeedKn) and
 // commandStatus='rejected'. Shaft stop (0 RPM) is always valid (engines simply stop).
 let inBand=wantClutch&&coupledErpmInBand(spec,t.shafts[0]?.rpm??0,selected);
 const stopped=(t.shafts[0]?.rpm??0)<=0,canDeclutch=!!spec.declutchToMotor&&p.kind==='dieselGR'&&!!p.motor;
 t.commandStatus='ok';
 if(wantClutch&&!inBand&&!stopped&&!canDeclutch){
  let f=state.lastValidFraction;
  if(f===undefined){const w=coupledSpeedWindowKn(spec),tpk=spec.tpk??0,kn=adjusted*spec.maxPsrpm/(tpk||1);f=w&&tpk>0?Math.min(w.max*(1-1e-9),Math.max(w.min*(1+1e-9),kn))*tpk/spec.maxPsrpm:adjusted;}
  setShafts(f);inBand=coupledErpmInBand(spec,t.shafts[0].rpm,selected);t.commandStatus='rejected';
 }else if(wantClutch&&inBand&&!stopped)state.lastValidFraction=adjusted;
 // Knee (engine-ramp plantRpmScale) obeys the same band rule: the scaled coupled ERPM is re-checked.
 // Unflagged: knee factor is bounded so ERPM stays inside every selected engine's band (kneeLimited).
 // Flagged declutchToMotor: a knee that would leave the band declutches onto the motor deterministically.
 let kneeScale=rpmScale;t.kneeLimited=undefined;
 if(wantClutch&&inBand&&!stopped&&rpmScale!==1&&!coupledErpmInBand(spec,t.shafts[0].rpm*rpmScale,selected)){
  if(canDeclutch)inBand=false;
  else if('engines' in p){const base=t.shafts[0].rpm*d.ratio;let lo=0,hi=Infinity;for(let i=0;i<p.engines.length;i++){if(!selected[i])continue;lo=Math.max(lo,p.engines[i].erpm.obsMin/base);hi=Math.min(hi,p.engines[i].erpm.obsMax/base);}kneeScale=Math.min(hi,Math.max(lo,rpmScale));t.kneeLimited=true;}
 }
 const refShaft=t.shafts[0]?.rpm??0;
 const declutched=wantClutch&&!inBand&&!stopped&&canDeclutch;
 t.declutched=declutched||undefined;t.coupledSpeedKn=coupledSpeedWindowKn(spec);
 if(wantClutch&&inBand)for(const shaft of t.shafts)shaft.coupled=true;
 else if(p.kind==='nuclearGR'&&mode!=='AIP')for(const shaft of t.shafts)shaft.coupled=true;
 if(p.kind==='dieselDirect'||p.kind==='dieselGR'||p.kind==='dieselElectric'){
  const enabled=enginesEnabled(p,mode);for(let i=0;i<t.engines.length;i++){
   const e=t.engines[i],sheet=p.engines[i];
   // D/E (and D/E-mode): generator ERPM is bus-locked / independent of shaft speed.
   // Coupled D/D & GR: ERPM = shaft×R:R exactly (no clamp).
   // Declutch-to-motor (flagged GR, SNORK/SURF): shaft on motor; diesel keeps charging at
   // sheet.erpm.normal (band-valid, deterministic). EDAs/CSR/CFR/EFR follow engine CFR, not PSR.
   // Engines silent only when the mode disables them (BATT/AIP) or no charging path.
   const electricLike=p.kind==='dieselElectric'||mode==='D/E';
   const coupledRun=wantClutch&&inBand&&selected[i]!==0&&refShaft>0;
   const declutchCharge=!!declutched&&enabled&&selected[i]!==0;
   e.running=coupledRun||(enabled&&selected[i]!==0&&electricLike)||declutchCharge;
   if(electricLike)e.erpm=e.running?sheet.erpm.normal*rpmScale:0;
   else if(coupledRun)e.erpm=(p.kind==='dieselDirect'?t.shafts[i%t.shafts.length].rpm:t.shafts[0].rpm*d.ratio)*kneeScale;
   else if(declutchCharge)e.erpm=sheet.erpm.normal*rpmScale;
   else e.erpm=0;
   e.csrHz=e.erpm/60;e.cfrHz=e.csrHz/(e.stroke===4?2:1);e.efrHz=firingRateHz(e,e.erpm);
  }
  // Coupled ramp: scale shaft with plantRpmScale so CSR≡PSR×R:R holds through a knee.
  if(kneeScale!==1)for(let i=0;i<t.shafts.length;i++){const shaft=t.shafts[i];if(!shaft.coupled)continue;shaft.rpm*=kneeScale;shaft.hz=shaft.rpm/60;}
  for(let i=0;i<t.generators!.length;i++){const g=t.generators![i];g.rpm=p.kind==='dieselElectric'?t.engines[i].erpm:electrical*60/2;g.hz=g.rpm/60*(p.kind==='dieselElectric'?p.generator!.polePairs:2);}
 }else if('turbineGenerators' in p)for(let i=0;i<t.generators!.length;i++){const g=t.generators![i],r=p.reactorSets[i]?.turboGenerator??p.turbineGenerators;g.rpm=r.rpm;g.hz=g.rpm/60*r.polePairs;}
 // Motor drives whenever shafts are not engine-coupled (BATT, AIP, D/E electric, or auto-declutch).
 if(t.motor){const engineCoupled=t.shafts.some(s=>s.coupled)&&(p.kind==='dieselDirect'||p.kind==='dieselGR');t.motor.rpm=engineCoupled?0:t.shafts[0].rpm*p.motor!.drivetrain.ratio;t.motor.shaftHz=t.motor.rpm/60;t.motor.msrHz=t.motor.shaftHz*t.motor.slots;}
 if(mode==='AIP'){if(!spec.aip||((p.kind==='nuclearGR'||p.kind==='nuclearElectric')&&!s.reactorOffline))throw new Error('AIP backup requires capability and reactor-off for nuclear');for(const g of t.generators!){g.hz=AIP_HZ[spec.aip.kind];g.rpm=g.hz*60/2;}}
 t.tpkValid=!!spec.tpk&&(!spec.tpkMinKts||fraction*spec.maxPsrpm/spec.tpk+1e-9>=spec.tpkMinKts);t.propulsor.brHz=t.shafts[0].hz*s.blades;if(t.stages.length!==d.stages.length||t.ratio!==d.ratio)throw new Error('Reconfigure static mode before changing drivetrain');t.mode=mode as OperatingMode;if(t.aip)t.aip.active=mode==='AIP';let input=t.shafts[0].hz*d.ratio;for(const g of t.stages){g.meshHz=input*g.pinionTeeth;input/=g.ratio;}return t;
}
function put(s:Signature,i:number,family:TonalFamily,hz:number,power:number,harmonic:number,shaftIndex?:number,engineIndex?:number,profile?:LineProfile,reactorId?:string,operatorFamily?:'COOLANT'|'TG'|'VANE'|'HYDP'|'PRES'|'INTERMITTENT'|'TRANSIENT'|'SWATH'|'GEAR'):void {
 let l=s.tonals![i];if(!l)l=s.tonals![i]={family,hz,power};if(family!=='eda')l.eda=undefined;l.reactorId=reactorId;l.family=family;l.hz=hz;l.power=power;l.harmonic=harmonic;l.shaftIndex=shaftIndex;l.engineIndex=engineIndex;l.engineId=engineIndex===undefined?undefined:s.propulsion!.engines[engineIndex].id;l.lineFamily=operatorFamily??(family==='shaft'?'PSR':family==='blade'?'BR':family==='electrical'?'GRID':family==='src'?'SRC':family==='motor'&&shaftIndex===0?'MSR':family==='crank'?'CSR':family==='cylinder'?'CFR':family==='diesel'?'EFR':family==='eda'?'EDA':family==='gear'?'MESH':family==='turbine'?'TURBINE':family==='pump'||family==='motor'?'AUX':undefined);const engine=engineIndex===undefined?undefined:s.propulsion!.engines[engineIndex];l.fundamentalHz=family==='shaft'?s.propulsion!.shafts[shaftIndex!].hz:family==='blade'?s.propulsion!.shafts[shaftIndex!].hz*s.blades:family==='motor'&&shaftIndex===0?s.propulsion!.motor!.msrHz:family==='crank'?engine!.csrHz:family==='cylinder'?engine!.cfrHz:family==='diesel'?engine!.efrHz:l.lineFamily?hz/harmonic:undefined;tagLine(l,i,profile??s.lineProfiles?.[family]);
}
/** Public rotation orders only (Urick/Ross); relative powers are invented. Fixed topology
 * for a fixed mode: inactive installed engines keep zero-power slots; updates reuse records. */
export function writePlantTonals(s:Signature,mode:ModeInput,electricalHarmonics:readonly number[]=DEFAULT_HARMONICS,srcHzPerKn:readonly number[]=NO_SRCS,speedKn=0):void {
 mode=normalizeMode(mode,s.plantSpec?.machinery.kind);const spec=s.plantSpec!,p=spec.machinery,t=s.propulsion!;let i=0;
 const psrMax=s.psrHarmonicsStopAtBlades||spec.psrHarmonicsStopAtBlades?Math.max(1,s.blades):3,brBoost=(s.reinforceBr1||spec.reinforceBr1)?1.6:1;
 for(let shaft=0;shaft<t.shafts.length;shaft++){const hz=t.shafts[shaft].hz;for(let h=1;h<=3;h++){const psrLive=h<=psrMax;put(s,i++,'shaft',hz*h,hz>0&&psrLive?.1/(h*h):0,h,shaft);const brPow=hz>0?.25/(h*h)*(h===1?brBoost:1):0;put(s,i++,'blade',hz*s.blades*h,brPow,h,shaft);}}
 for(const h of electricalHarmonics)put(s,i++,'electrical',(mode==='AIP'?AIP_HZ[spec.aip!.kind]:(s.electricalHz??60))*h,.04/(h*h),h);
 if(p.motor){for(let h=1;h<=3;h++)put(s,i++,'motor',(t.motor!.slots?t.motor!.msrHz:t.motor!.shaftHz)*h,t.motor!.rpm>0?.05/(h*h):0,h,t.motor!.slots?0:undefined);}
 // Seeded brightness + richness (sparse/partial/rich). Topology always emits 1..6 slots; power fades.
 if(enginesEnabled(p,mode)){const st=states.get(s);const bright=st?.bright??t.engines.map(()=>DIESEL_BRIGHTNESS_PROFILES[0]),richness=st?.richness??'partial';
  for(let e=0;e<t.engines.length;e++){const engine=t.engines[e],b=bright[e]??DIESEL_BRIGHTNESS_PROFILES[0];for(const h of ENGINE_HARMONICS){const g=dieselHarmonicGain(richness,h);put(s,i++,'crank',engine.csrHz*h,engine.running?b.csr*g/(h*h):0,h,undefined,e);put(s,i++,'diesel',engine.efrHz*h,engine.running?b.efr*g/(h*h):0,h,undefined,e);put(s,i++,'cylinder',engine.cfrHz*h,engine.running?b.cfr*g/(h*h):0,h,undefined,e);}for(const eda of spec.edas)for(const h of eda.harmonics){const at=i++,g=dieselHarmonicGain(richness,h),f0=edaFrequencyHz(engine.cfrHz,eda.cfrMultiple);put(s,at,'eda',f0*h,engine.running?.05*g/(h*h):0,h,undefined,e);const l=s.tonals![at];l.eda??={name:eda.name,cfrMultiple:eda.cfrMultiple};l.eda.name=eda.name;l.eda.cfrMultiple=eda.cfrMultiple;l.fundamentalHz=f0;}}}
 if(mode!=='AIP'&&(p.kind==='nuclearGR'||p.kind==='nuclearElectric')){const n=p.kind==='nuclearGR'?t.shafts.length:1;for(let shaft=0;shaft<n;shaft++){const rpm=p.kind==='nuclearGR'?t.shafts[shaft].rpm*t.ratio:p.mainTurbines.maxRpm;for(let h=1;h<=3;h++)put(s,i++,'turbine',rpm/60*h,rpm>0?.04*p.mainTurbines.count/n/(h*h):0,h,shaft);for(let h=1;h<=3;h++)put(s,i++,'turbine',vanePassHz(rpm/60,p.mainTurbines.vaneCount)*h,rpm>0?.02*p.mainTurbines.count/n/(h*h):0,h,shaft,undefined,undefined,undefined,'VANE');}}
 for(let shaft=0;shaft<t.shafts.length;shaft++){const ratio=t.shafts[0].hz>0?t.shafts[shaft].hz/t.shafts[0].hz:1;for(const g of t.stages)for(let h=1;h<=3;h++)put(s,i++,'gear',g.meshHz*ratio*h,g.meshHz>0?.035/(h*h):0,h,shaft);}
 if(mode!=='AIP'&&('reactorSets' in p))for(const r of p.reactorSets)for(let h=1;h<=3;h++){put(s,i++,'pump',r.coolantPumpHz*h,.04/(h*h),h,undefined,undefined,undefined,r.id,'COOLANT');put(s,i++,'turbine',r.turboGenerator.rpm/60*h,.025/(h*h),h,undefined,undefined,undefined,r.id,'TG');}
 // AIP plant giveaways (invented; stable+discrete — fixed-speed plant, not DC AUX wander).
 // Stirling: generator runs at AIP_HZ (rpm=hz*60/2); shaft rotation = rpm/60 = AIP_HZ/2, plus h2.
 // Fuel-cell: no rotating prime mover — reactant/coolant pumps, cathode blower, DC/DC inverter.
 // Closed-cycle: engine-firing fundamental (+h2). Relative powers invented; no per-cut gain.
 if(mode==='AIP'){
  const aipProfile:LineProfile={stability:'stable',width:'discrete'},kind=spec.aip!.kind;
  if(kind==='stirling'){
   // basis rotation 'stirling-shaft': fixed-speed Stirling engine/generator shaft.
   const shaftHz=AIP_HZ.stirling*.5; // === generators[0].rpm/60 after updatePropulsion
   for(let h=1;h<=2;h++)put(s,i++,'pump',shaftHz*h,.35/(h*h),h,undefined,undefined,aipProfile);
  }else if(kind==='fuelcell'){
   for(const line of FUELCELL_PLANT)for(const h of line.harmonics)put(s,i++,'pump',line.hz*h,line.power/(h*h),h,undefined,undefined,aipProfile);
  }else{
   // closed-cycle diesel AIP: firing-rate family (invented CFR)
   for(let h=1;h<=2;h++)put(s,i++,'pump',CLOSED_CYCLE_CFR_HZ*h,.35/(h*h),h,undefined,undefined,aipProfile);
  }
 }
 else for(const a of spec.aux)if(a.kind!=='hydp')for(const h of a.harmonics){const intermittent=a.duty==='intermittent',on=a.dutyOnS?(a.dutyOnS[0]+a.dutyOnS[1])/2:60,off=a.dutyOffS?(a.dutyOffS[0]+a.dutyOffS[1])/2:90,phase=intermittent?((a.id.length*17+h*3)%97):0,gain=intermittent?intermittentDutyGain(s.dutyClockS??0,on,off,phase,a.edge??'abrupt'):1;put(s,i++,a.kind==='acPump'||a.kind==='ssma'?'pump':'motor',a.fHz*h,.025/(h*h)*gain,h,undefined,undefined,a,undefined,intermittent?'INTERMITTENT':undefined);}
 // Lead: speed-window SRC is the source of truth. Legacy srcHzPerKn is a fallback only when
 // this plant has no speedWindows SRC (avoids dual emission of the same component family).
 const gates=s.speedGated??NO_GATES,hasWindowSrc=gates.some(w=>w.kind==='SRC')||!!spec.speedWindows?.some(w=>w.kind==='SRC');
 for(const w of gates)if(w.kind==='SRC')for(let h=1;h<=2;h++)put(s,i++,'src',w.hz*h,.04*w.gain/(h*h),h);
 if(!hasWindowSrc)for(const rate of srcHzPerKn)put(s,i++,'src',speedKn*rate,speedKn>0?.06:0,1);
 if(spec.propResonance)i=writePropResonance(s,i,spec.propResonance,speedKn);
 if(s.hydpTransient&&spec.hydp)writeHydpBurst(s,i,spec.hydp,s.hydpTransient),i+=HYDP_MAX_ORDERS;
 // Fixed TRANSIENT slots (class-specific unintentional); power filled by engine while armed.
 if(spec.classTransients)for(const tr of spec.classTransients)for(const h of tr.harmonics)put(s,i++,'pump',tr.hz*h,0,h,undefined,undefined,{stability:'unstable',width:'diffuse',sigmaBins:2},undefined,'TRANSIENT');
 s.tonals!.length=i;
}

/** Refresh INTERMITTENT aux line powers from Signature.dutyClockS (allocation-free). */
export function applyIntermittentAuxPowers(s:Signature):void{
 const spec=s.plantSpec,lines=s.tonals;if(!spec||!lines)return;const t=s.dutyClockS??0;
 for(const a of spec.aux){if(a.duty!=='intermittent'||a.kind==='hydp'||!a.dutyOnS||!a.dutyOffS)continue;
  const on=(a.dutyOnS[0]+a.dutyOnS[1])/2,off=(a.dutyOffS[0]+a.dutyOffS[1])/2;
  for(const h of a.harmonics){const phase=(a.id.length*17+h*3)%97,gain=intermittentDutyGain(t,on,off,phase,a.edge??'abrupt'),hz=a.fHz*h,base=.025/(h*h);
   for(const l of lines)if(l.lineFamily==='INTERMITTENT'&&l.harmonic===h&&Math.abs(l.hz-hz)<1e-6)l.power=base*gain;}}
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
 const shape=state.shape,{orders,drownFundamental}=shape,scale=shape.powerScale??1;
 for(let n=1;n<=HYDP_MAX_ORDERS;n++){
  const live=state.gain>0&&n<=orders&&!(drownFundamental&&n===1);
  const pow=live?HYDP_POWER*scale*state.gain/(n*n)*(drownFundamental&&n===2?1.35:1):0;
  put(s,i+n-1,'pump',h.nominalHz*n,pow,n,undefined,undefined,HYDP_PROFILE,undefined,'HYDP');
 }
}
/** @deprecated alias — pair curve retired; writes harmonic burst slots. */
export const writeHydpPair=writeHydpBurst;
const PRES_EDGE_KN=.5;
/** PRES amplitude envelope (weights ONLY; never moves a line): raised cosine in PSR order about nCentre. */
export function presEnvelope(r:import('./drivetrain.js').PropResonanceSpec,n:number):number{return .5*(1+Math.cos(Math.PI*(n-r.nCentre)/(r.halfWidth+1)));}
/** Abrupt-ish speed gate for the optional [onsetKn, offsetKn] band (0.5 kn edges). */
export function presSpeedGain(r:import('./drivetrain.js').PropResonanceSpec,speedKn:number):number{
 const on=r.onsetKn===undefined?1:Math.max(0,Math.min(1,(speedKn-r.onsetKn)/PRES_EDGE_KN)),off=r.offsetKn===undefined?1:Math.max(0,Math.min(1,(r.offsetKn-speedKn)/PRES_EDGE_KN));return Math.min(on,off);
}
/** PRES line family. Frequencies: shaft-synchronous n·PSR_shaft for every installed shaft (fixed slot
 * topology shafts × (2·halfWidth+1)). No physics-side merging: each shaft always emits its own lines;
 * matched rates give coincident lines that sum incoherently in power, and each stream's own FFT bin
 * width decides whether a twin pair resolves into a doublet. Zero power when PSR is 0; on D/E/BATT it
 * still tracks PSR (never the engine). */
export function writePropResonance(s:Signature,i:number,r:import('./drivetrain.js').PropResonanceSpec,speedKn:number):number{
 const t=s.propulsion!,gate=presSpeedGain(r,speedKn),peak=.1*10**(r.levelDb/10),lo=r.nCentre-r.halfWidth,width=2*r.halfWidth+1,profile:LineProfile={stability:r.stability,width:'discrete'};
 for(let shaft=0;shaft<t.shafts.length;shaft++){const hz=t.shafts[shaft].hz;for(let k=0;k<width;k++){const n=lo+k;put(s,i++,'shaft',hz*n,hz>0?peak*presEnvelope(r,n)*gate:0,n,shaft,undefined,profile,undefined,'PRES');}}
 return i;
}
