import type {Signature,TonalLine} from '../sourceModel.js';
import type {AuxSpec} from '../catalog/drivetrain.js';
import type {CutSeed,GramLookId} from './types.js';
import {GRAM_LOOK_IDS} from './types.js';

/** Fictional SSMA teaching tone (~shaft-aux); harmonics [2,3] only — no fundamental (Wilson note 5). */
export const CUT_SSMA_AUX:AuxSpec={
 id:'cut-ssma-teach',kind:'ssma',fHz:58,harmonics:[2,3],stability:'unstable',width:'discrete',duty:'continuous',
};

export function looksOf(cut:CutSeed):ReadonlySet<GramLookId> {
 const out=new Set<GramLookId>();
 for(const id of cut.gramLooks??[])if((GRAM_LOOK_IDS as readonly string[]).includes(id))out.add(id as GramLookId);
 return out;
}

/** Bake plantSpec overlays into a derived signature before AcousticEngine construction. */
export function bakeFidelityParams(sig:Signature,cut:CutSeed):Signature {
 const looks=looksOf(cut);
 if(!sig.plantSpec)return sig;
 if(looks.has('ssma-harmonics-only')){
  const aux=sig.plantSpec.aux.some(a=>a.id===CUT_SSMA_AUX.id)?sig.plantSpec.aux:[...sig.plantSpec.aux,CUT_SSMA_AUX];
  sig.plantSpec={...sig.plantSpec,aux};
 }
 return sig;
}

/**
 * Runtime, idempotent fidelity on live tonals after each sim advance.
 * Does not allocate; only mutates power fields on existing tonal records.
 *
 * Propulsion "ramp" here is catalog EDA riseS only (Lead: no full mode-switch this tip).
 * Slip rate is deferred.
 */
export function applyRuntimeFidelity(sig:Signature,cut:CutSeed,simT:number,bases:Map<TonalLine,number>,engineBases:Map<TonalLine,number>=bases):void {
 const looks=looksOf(cut),tonals=sig.tonals;if(!tonals)return;
 if(looks.has('propulsion-ramp')){
  // Use the first EDA's catalog ramp.riseS (default 3 s from plantIdentity).
  const rise=Math.max(.01,sig.plantSpec?.edas[0]?.ramp?.riseS??3);
  const gain=Math.max(0,Math.min(1,simT/rise));
  for(const l of tonals){
   if(l.lineFamily!=='EDA')continue;
   if(!bases.has(l))bases.set(l,l.power);
   l.power=bases.get(l)!*gain;
  }
 }else if(bases.size)bases.clear();
 if(looks.has('harmonic-skip')){
  for(const l of tonals)if(l.harmonic===2&&(l.lineFamily==='CFR'||l.lineFamily==='BR'))l.power=0;
 }
 if(looks.has('blade-harmonics-reinforced')){
  for(const l of tonals){
   if(l.lineFamily!=='BR'||!l.harmonic||l.harmonic<2)continue;
   const h=l.harmonic,shaft=sig.propulsion?.shafts[l.shaftIndex??0]?.hz??sig.shaftHz;
   l.power=shaft>0?.25/(h*h)*2.4:0;
  }
 }
 if(looks.has('msr-dominant')){
  for(const l of tonals){
   if(l.lineFamily==='MSR'){const h=l.harmonic??1;l.power=l.hz>0?.08/(h*h):0;}
   else if(l.lineFamily==='BR'){const h=l.harmonic??1,shaft=sig.propulsion?.shafts[l.shaftIndex??0]?.hz??sig.shaftHz;l.power=shaft>0?.25/(h*h)*.35:0;}
  }
 }
 if(looks.has('engine-harmonics')){
  // Idempotent teaching lift: remember plant-written power; re-capture when writePlantTonals rewrites.
  for(const l of tonals){
   if(!(l.lineFamily==='CSR'||l.lineFamily==='CFR'||l.lineFamily==='EFR'||l.lineFamily==='EDA'))continue;
   if(l.power<=0){engineBases.delete(l);continue;}
   const h=l.harmonic??1,lift=1.35*(h>=4?1.15:1);
   const prev=engineBases.get(l);
   if(prev===undefined){engineBases.set(l,l.power);l.power*=lift;continue;}
   const expected=prev*lift;
   if(Math.abs(l.power-expected)>1e-9*Math.max(1,expected)){engineBases.set(l,l.power);l.power*=lift;}
   // else already lifted from this plant base — leave alone
  }
 }
}
