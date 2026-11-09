import {updatePropulsion,writePlantTonals} from './plantModel.js';
import {catalog} from './classes.js';
import {normalizeMode,effectiveParams,isDiesel,isGeared,type CatalogReference,type SubmarineClass,type CatalogVariant,type ClassParams,type OperatingState,type ModeInput} from './schema.js';
import {tagLine,type Signature,type TonalFamily,type LineProfile} from '../sourceModel.js';
import {clamp,cavitationInceptionSpeedKn as cavKn} from '../units.js';
import {stateBroadband} from '../stateBroadband.js';
/** Strip the catalog's required leading "Fictional " for operator-facing labels. */
export function displayName(name:string):string{return name.startsWith('Fictional ')?name.slice(10):name;}
export function getClass(id:string):SubmarineClass {const c=catalog.classes.find(c=>c.id===id);if(!c)throw new Error(`Unknown fictional class ${id}`);return c;}
export function resolveReference(ref:CatalogReference):{klass:SubmarineClass;params:ClassParams}{
 const klass=getClass(ref.classId);if(ref.hullId!==undefined&&!klass.hulls.some(h=>h.id===ref.hullId))throw new Error(`Unknown hull ${ref.hullId}`);return {klass,params:effectiveParams(klass,ref.variantId)};
}
/** Class wrapper around units.cavitationInceptionKn (Urick cavitation-number teaching). */
export function cavitationInceptionKn(p:ClassParams,depthM:number,temperatureC=15,salinityPsu=35):number{
 return cavKn(p.cavitation.surfaceInceptionKn,p.cavitation.depthCoefficient,depthM,temperatureC,salinityPsu);
}
export function validateOperatingState(p:ClassParams,state:OperatingState):void{
 const mode=normalizeMode(state.mode,p.propulsion),aip=p.plantSpec?.aip;
 if(!Number.isFinite(state.speedKn)||state.speedKn<0||state.speedKn>p.maxSpeedKn||!Number.isFinite(state.depthM)||state.depthM<p.depthM[0]||state.depthM>p.depthM[1])throw new Error('Operating state outside class envelope');
 if(!['SURF','SNORK','D/E','BATT','AIP','NUC'].includes(mode)||(mode==='AIP'&&(!aip||state.depthM<=0||state.speedKn>aip.maxSpeedKts||(!isDiesel(p.propulsion)&&!state.reactorOffline)))||(['BATT','SNORK','D/E'].includes(mode)&&!isDiesel(p.propulsion)))throw new Error('Unsupported operating mode for class');
}
function tone(out:Signature,i:number,family:TonalFamily,hz:number,power:number,profile?:LineProfile):void{const lines=out.tonals!;let line=lines[i];if(!line)line=lines[i]={family,hz,power};else{line.family=family;line.hz=hz;line.power=power;}tagLine(line,i,profile??out.lineProfiles?.[family]);}
/** Allocates on catalog/config changes only. Fixed class params, state-derived mechanisms. */
export function deriveSignature(c:SubmarineClass,variant:string|CatalogVariant|undefined,state:OperatingState):Signature {
 const p=effectiveParams(c,typeof variant==='string'?variant:variant?.id);validateOperatingState(p,state);
 const out:Signature={label:displayName(c.name),shaftHz:0,blades:p.blades,tonalHz:1,levelDb:p.levelDb,modulation:0,tonals:[],reactorOffline:state.reactorOffline??false};updateDerivedSignature(out,p,state.speedKn,state.depthM,state.mode);return out;
}
/** In-place state refresh. No allocation if operating mode/line topology is unchanged.
 * Ross/Urick: flow self-noise grows roughly 50–60 log10(speed); only a small invented
 * fraction radiates to remote receivers. Pumps/electrical strengths are entirely fictional. */
export function updateDerivedSignature(out:Signature,p:ClassParams,speedKn:number,depthM:number,mode:ModeInput):void {
 const quiet=mode==='quiet';mode=normalizeMode(mode,p.propulsion);
 const speed=clamp(speedKn,0,p.maxSpeedKn),shaft=p.maxShaftRpm/60*speed/p.maxSpeedKn,blade=shaft*p.blades;
 out.lineProfiles=p.lineProfiles;out.shafts=p.shafts;out.electricalHz=p.electricalHz;out.shaftHz=shaft;out.blades=p.blades;out.tonalHz=Math.max(.01,blade);out.levelDb=p.levelDb+20*Math.log10(1+2*speed/p.maxSpeedKn)+(quiet?-8:mode==='AIP'?-5:mode==='D/E'?3:0);
 out.inceptionKn=cavitationInceptionKn(p,depthM,out.waterTempC??15,out.waterSalinity??35);const excess=Math.max(0,speed/out.inceptionKn-1);out.cavitationPower=excess*excess*.02;out.modulation=excess>0?Math.min(.8,.15+.4*excess):0;
 out.flowNoiseDb=speed>0?p.flowNoise.levelDb+p.flowNoise.slopeDb*Math.log10(speed/p.flowNoise.referenceKn):-300;out.flowRadiatedFraction=p.flowNoise.radiatedFraction;
 if(p.plantSpec){out.plantSpec??=p.plantSpec;out.reinforceBr1=p.plantSpec.reinforceBr1;out.psrHarmonicsStopAtBlades=p.plantSpec.psrHarmonicsStopAtBlades;const windows=out.plantSpec.speedWindows;if(windows){out.speedGated??=windows.map(w=>w.kind==='SRC'?{name:w.name,kind:w.kind,hz:w.hz,active:false,gain:0}:{name:w.name,kind:w.kind,loHz:w.loHz,hiHz:w.hiHz,active:false,gain:0});for(let j=0;j<windows.length;j++){const w=windows[j],g=out.speedGated[j];if(w.kind==='SRC'&&g.kind==='SRC')g.hz=w.hzPerKnot===undefined?w.hz:w.hzPerKnot*speed;g.active=speed>=w.speedKts[0]&&speed<=w.speedKts[1];g.gain=g.active?Math.max(0,Math.min(1,(speed-w.speedKts[0]),(w.speedKts[1]-speed))):0;}}const truth=updatePropulsion(out,speed/p.maxSpeedKn,mode);out.shaftHz=truth.shafts[0].hz;out.tonalHz=Math.max(.01,out.shaftHz*p.blades);writePlantTonals(out,mode,p.electricalHarmonics,p.srcHzPerKn,speed);const running=truth.engines.filter(e=>e.running);const erpm=running.length?running.reduce((a,e)=>a+e.erpm,0)/running.length:0;const sheet=('engines' in p.plantSpec.machinery)?p.plantSpec.machinery.engines[0]?.erpm.normal:undefined;out.stateBroadband=stateBroadband({mode,depthM,speedKn:speed,erpm,erpmNormal:sheet??750,seaState:out.seaState??0,periscopeDepthM:out.periscopeDepthM??18,primary:p.propulsion});return;}
 let i=0;tone(out,i++,'shaft',shaft,speed>0?.1*p.shafts:0);for(let h=1;h<=3;h++)tone(out,i++,'blade',blade*h,speed>0?.25*p.shafts/(h*h):0);
 for(const rate of p.srcHzPerKn)tone(out,i++,'src',speed*rate,speed>0?.06:0);
 if(isGeared(p.propulsion)){tone(out,i++,'gear',shaft*p.reductionRatio,.08);tone(out,i++,'gear',shaft*p.reductionRatio*p.gearTeeth,.04);}
 for(const h of p.electricalHarmonics)tone(out,i++,'electrical',p.electricalHz*h,.04/(h*h));
 if(p.propulsion==='dieselElectric'||p.propulsion==='nuclearElectric')for(let h=1;h<=2;h++)tone(out,i++,'motor',shaft*12*h,speed>0?.05/h:0);
 const diesel=(p.propulsion==='dieselDirect'||p.propulsion==='dieselGearReduction'||mode==='SNORK')&&mode!=='BATT'&&mode!=='AIP';
 if(diesel){const rpm=p.propulsion==='dieselElectric'?p.erpmMax:shaft*60*p.reductionRatio;for(let h=1;h<=2;h++)tone(out,i++,'diesel',rpm/60*p.dieselCylinders/2*h,rpm>0?.15/h:0);}
 for(const a of p.aux)for(const h of a.harmonics)tone(out,i++,a.kind==='pump'?'pump':'motor',(a.basis==='electrical'?p.electricalHz:1)*a.rate*h,.025/(h*h),a.stability&&a.width?a as LineProfile:undefined);
 out.tonals!.length=i;
}
