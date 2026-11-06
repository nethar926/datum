import {getClass,resolveReference,validateOperatingState} from '../catalog/derive.js';
import {OPERATING_MODES,type OperatingMode} from '../catalog/schema.js';
import {CUT_MODEL_VERSION,CUT_LINE_BEHAVIOURS,GRAM_LOOK_IDS,type CutClassifyingLine,type CutLookalikePair,type CutRichness,type CutSeed,type CutStarterPack,type GramLookId} from './types.js';

const RICHNESS:readonly CutRichness[]=['sparse','moderate','rich'];
const finite=(x:unknown,lo:number,hi:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=lo&&x<=hi;

function validateLine(line:unknown,path:string):asserts line is CutClassifyingLine {
 if(!line||typeof line!=='object')throw new Error(`${path}: invalid classifying line`);
 const l=line as CutClassifyingLine;
 if(typeof l.lineFamily!=='string'||!l.lineFamily)throw new Error(`${path}.lineFamily required`);
 if(typeof l.label!=='string'||!l.label)throw new Error(`${path}.label required`);
 if(l.nominalHz!==undefined&&!finite(l.nominalHz,0,1e6))throw new Error(`${path}.nominalHz out of range`);
 if(typeof l.giveaway!=='boolean')throw new Error(`${path}.giveaway required`);
 if(l.harmonicOf!==undefined&&(typeof l.harmonicOf!=='string'||!l.harmonicOf))throw new Error(`${path}.harmonicOf invalid`);
 if(l.n!==undefined&&(!Number.isInteger(l.n)||l.n<1||l.n>20))throw new Error(`${path}.n must be integer 1..20`);
 if(l.behaviour!==undefined&&!(CUT_LINE_BEHAVIOURS as readonly string[]).includes(l.behaviour))throw new Error(`${path}.behaviour invalid`);
}

/** Structural + catalog envelope check. Throws on the first failure. */
export function validateCutSeed(value:unknown):asserts value is CutSeed {
 if(!value||typeof value!=='object')throw new Error('CutSeed required');
 const c=value as CutSeed;
 if(c.v!==1)throw new Error('CutSeed.v must be 1');
 if(c.modelVersion!==CUT_MODEL_VERSION)throw new Error(`CutSeed.modelVersion must be ${CUT_MODEL_VERSION}`);
 if(typeof c.id!=='string'||!c.id)throw new Error('CutSeed.id required');
 if(!finite(c.seed,0,4294967295)||!Number.isInteger(c.seed))throw new Error('CutSeed.seed invalid');
 if(!finite(c.durationS,60,3600))throw new Error('CutSeed.durationS must be 60..3600');
 if(!RICHNESS.includes(c.richness))throw new Error('CutSeed.richness invalid');
 if(typeof c.classId!=='string'||!c.classId)throw new Error('CutSeed.classId required');
 if(c.variantId!==undefined&&(typeof c.variantId!=='string'||!c.variantId))throw new Error('CutSeed.variantId invalid');
 if(c.hullId!==undefined&&(typeof c.hullId!=='string'||!c.hullId))throw new Error('CutSeed.hullId invalid');
 if(!(OPERATING_MODES as readonly string[]).includes(c.mode))throw new Error('CutSeed.mode invalid');
 if(!finite(c.speedKn,0,45))throw new Error('CutSeed.speedKn invalid');
 if(!finite(c.depthM,0,1000))throw new Error('CutSeed.depthM invalid');
 if(c.lookalikeGroupId!==undefined&&(typeof c.lookalikeGroupId!=='string'||!c.lookalikeGroupId))throw new Error('CutSeed.lookalikeGroupId invalid');
 if(!Array.isArray(c.classifyingLines)||c.classifyingLines.length<1||c.classifyingLines.length>3)throw new Error('CutSeed.classifyingLines must have 1–3 entries');
 c.classifyingLines.forEach((l,i)=>validateLine(l,`classifyingLines[${i}]`));
 if(c.gramLooks!==undefined){
  if(!Array.isArray(c.gramLooks))throw new Error('CutSeed.gramLooks invalid');
  for(const g of c.gramLooks)if(!(GRAM_LOOK_IDS as readonly string[]).includes(g))throw new Error(`Unknown gramLook ${g}`);
 }
 const klass=getClass(c.classId);
 let resolved;try{resolved=resolveReference({classId:c.classId,variantId:c.variantId,hullId:c.hullId});}catch(e){throw new Error(`CutSeed catalogRef invalid: ${e instanceof Error?e.message:e}`);}
 const reactorOffline=c.mode==='AIP'&&klass.plant==='nuclear';
 validateOperatingState(resolved.params,{mode:c.mode as OperatingMode,speedKn:c.speedKn,depthM:c.depthM,...(reactorOffline?{reactorOffline:true}:{})});
 // Compendium truth: every classifying family must be visible in this mode (or HYDP teach overlay).
 const visible=new Set(klass.idKeys.linesVisiblePerMode[c.mode]??[]);
 for(const line of c.classifyingLines){
  if(line.lineFamily==='HYDP'){if(!klass.hydp)throw new Error(`Cut ${c.id}: HYDP classifying line but class has no hydp`);continue;}
  if(!visible.has(line.lineFamily as never))throw new Error(`Cut ${c.id}: ${line.lineFamily} not in idKeys for mode ${c.mode}`);
 }
}

export function validateLookalikePair(pair:unknown,cuts:readonly CutSeed[]):asserts pair is CutLookalikePair {
 if(!pair||typeof pair!=='object')throw new Error('lookalike pair required');
 const p=pair as CutLookalikePair;
 if(typeof p.id!=='string'||!p.id)throw new Error('lookalike.id required');
 if(!Array.isArray(p.cutIds)||p.cutIds.length!==2||typeof p.cutIds[0]!=='string'||typeof p.cutIds[1]!=='string'||p.cutIds[0]===p.cutIds[1])throw new Error('lookalike.cutIds must be two distinct ids');
 if(typeof p.differOn!=='string'||!p.differOn)throw new Error('lookalike.differOn required');
 const a=cuts.find(c=>c.id===p.cutIds[0]),b=cuts.find(c=>c.id===p.cutIds[1]);
 if(!a||!b)throw new Error(`lookalike ${p.id}: cut id missing from pack`);
 if(a.lookalikeGroupId!==p.id||b.lookalikeGroupId!==p.id)throw new Error(`lookalike ${p.id}: cut lookalikeGroupId mismatch`);
}

/** Pack-level invariants for the curated starter set. */
export function validateStarterPack(pack:CutStarterPack):void {
 if(pack.packVersion!==1)throw new Error('packVersion must be 1');
 if(pack.modelVersion!==CUT_MODEL_VERSION)throw new Error(`pack modelVersion must be ${CUT_MODEL_VERSION}`);
 if(!Array.isArray(pack.cuts)||pack.cuts.length<5||pack.cuts.length>10)throw new Error('starter pack needs 5–10 cuts');
 const ids=new Set<string>();
 for(const c of pack.cuts){validateCutSeed(c);if(ids.has(c.id))throw new Error(`duplicate cut id ${c.id}`);ids.add(c.id);if(c.modelVersion!==pack.modelVersion)throw new Error(`cut ${c.id} modelVersion mismatch`);}
 if(!Array.isArray(pack.lookalikePairs)||pack.lookalikePairs.length<2)throw new Error('need at least two lookalike pairs');
 for(const p of pack.lookalikePairs)validateLookalikePair(p,pack.cuts);
 const plants=new Set(pack.cuts.map(c=>getClass(c.classId).plant));
 if(!plants.has('diesel')||!plants.has('nuclear'))throw new Error('starter pack needs diesel and nuclear cuts');
 if(!pack.cuts.some(c=>c.mode==='AIP'&&getClass(c.classId).aipCapable))throw new Error('starter pack needs an AIP cut');
 // Wilson fidelity coverage: each of the 10 note-looks (excl. pure documentation) appears ≥1×
 const covered=new Set<GramLookId>();
 for(const c of pack.cuts)for(const g of c.gramLooks??[])covered.add(g);
 for(const need of ['cavitation','slow-demon-blade','harmonic-skip','ssma-harmonics-only','msr-dominant','propulsion-ramp','engine-knee','eda-locked','blade-harmonics-reinforced','engine-harmonics','compendium-truth'] as GramLookId[]){
  if(!covered.has(need))throw new Error(`starter pack missing gramLook ${need}`);
 }
}
