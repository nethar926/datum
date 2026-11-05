import {catalog} from './classes.js';
import {effectiveParams,isDiesel,isGeared,type CatalogReference,type SubmarineClass,type CatalogVariant,type ClassParams,type OperatingState,type OperatingMode} from './schema.js';
import type {Signature,TonalFamily} from '../sourceModel.js';
import {clamp} from '../units.js';
export function getClass(id:string):SubmarineClass {const c=catalog.classes.find(c=>c.id===id);if(!c)throw new Error(`Unknown fictional class ${id}`);return c;}
export function resolveReference(ref:CatalogReference):{klass:SubmarineClass;params:ClassParams}{
 const klass=getClass(ref.classId);if(ref.hullId!==undefined&&!klass.hulls.some(h=>h.id===ref.hullId))throw new Error(`Unknown hull ${ref.hullId}`);return {klass,params:effectiveParams(klass,ref.variantId)};
}
/** Urick/Ross: constant cavitation-number approximation V_i(d)=V_i0 sqrt(P(d)/P0).
 * Static seawater pressure ratio ≈1+d/10.06 m. No measured platform inception data. */
export function cavitationInceptionKn(p:ClassParams,depthM:number):number{return p.cavitation.surfaceInceptionKn*Math.sqrt(1+Math.max(0,depthM)*p.cavitation.depthCoefficient);}
export function validateOperatingState(p:ClassParams,state:OperatingState):void{
 if(!Number.isFinite(state.speedKn)||state.speedKn<0||state.speedKn>p.maxSpeedKn||!Number.isFinite(state.depthM)||state.depthM<p.depthM[0]||state.depthM>p.depthM[1])throw new Error('Operating state outside class envelope');
 if(!['normal','quiet','aip','battery','snorkel'].includes(state.mode)||(state.mode==='aip'&&!p.aipCapable)||(state.mode==='battery'&&p.propulsion!=='dieselElectric')||(state.mode==='snorkel'&&!isDiesel(p.propulsion)))throw new Error('Unsupported operating mode for class');
}
function tone(out:Signature,i:number,family:TonalFamily,hz:number,power:number):void{const lines=out.tonals!;let line=lines[i];if(!line)line=lines[i]={family,hz,power};else{line.family=family;line.hz=hz;line.power=power;}}
/** Allocates on catalog/config changes only. Fixed class params, state-derived mechanisms. */
export function deriveSignature(c:SubmarineClass,variant:string|CatalogVariant|undefined,state:OperatingState):Signature {
 const p=effectiveParams(c,typeof variant==='string'?variant:variant?.id);validateOperatingState(p,state);
 const out:Signature={label:c.name,shaftHz:0,blades:p.blades,tonalHz:1,levelDb:p.levelDb,modulation:0,tonals:[]};updateDerivedSignature(out,p,state.speedKn,state.depthM,state.mode);return out;
}
/** In-place state refresh. No allocation if operating mode/line topology is unchanged.
 * Ross/Urick: flow self-noise grows roughly 50–60 log10(speed); only a small invented
 * fraction radiates to remote receivers. Pumps/electrical strengths are entirely fictional. */
export function updateDerivedSignature(out:Signature,p:ClassParams,speedKn:number,depthM:number,mode:OperatingMode):void {
 const speed=clamp(speedKn,0,p.maxSpeedKn),shaft=p.maxShaftRpm/60*speed/p.maxSpeedKn,blade=shaft*p.blades;
 out.shaftHz=shaft;out.blades=p.blades;out.tonalHz=Math.max(.01,blade);out.levelDb=p.levelDb+20*Math.log10(1+2*speed/p.maxSpeedKn)+(mode==='quiet'?-8:mode==='aip'?-5:0);
 out.inceptionKn=cavitationInceptionKn(p,depthM);const excess=Math.max(0,speed/out.inceptionKn-1);out.cavitationPower=excess*excess*.02;out.modulation=excess>0?Math.min(.8,.15+.4*excess):0;
 out.flowNoiseDb=speed>0?p.flowNoise.levelDb+p.flowNoise.slopeDb*Math.log10(speed/p.flowNoise.referenceKn):-300;out.flowRadiatedFraction=p.flowNoise.radiatedFraction;
 let i=0;tone(out,i++,'shaft',shaft,speed>0?.1*p.shafts:0);for(let h=1;h<=3;h++)tone(out,i++,'blade',blade*h,speed>0?.25*p.shafts/(h*h):0);
 for(const rate of p.srcHzPerKn)tone(out,i++,'src',speed*rate,speed>0?.06:0);
 if(isGeared(p.propulsion)){tone(out,i++,'gear',shaft*p.reductionRatio,.08);tone(out,i++,'gear',shaft*p.reductionRatio*p.gearTeeth,.04);}
 for(const h of p.electricalHarmonics)tone(out,i++,'electrical',p.electricalHz*h,.04/(h*h));
 if(p.propulsion==='dieselElectric'||p.propulsion==='nuclearElectric')for(let h=1;h<=2;h++)tone(out,i++,'motor',shaft*12*h,speed>0?.05/h:0);
 const diesel=(p.propulsion==='dieselDirect'||p.propulsion==='dieselGearReduction'||mode==='snorkel')&&mode!=='battery'&&mode!=='aip';
 if(diesel){const rpm=p.propulsion==='dieselElectric'?p.dieselRpm:shaft*60*p.reductionRatio;for(let h=1;h<=2;h++)tone(out,i++,'diesel',rpm/60*p.dieselCylinders/2*h,rpm>0?.15/h:0);}
 for(const a of p.aux)for(const h of a.harmonics)tone(out,i++,a.kind==='pump'?'pump':'motor',(a.basis==='electrical'?p.electricalHz:1)*a.rate*h,.025/(h*h));
 out.tonals!.length=i;
}
