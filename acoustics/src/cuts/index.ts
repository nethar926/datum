import {STARTER_CUTS,STARTER_PACK} from './starterPack.js';
import {CutSession,scenarioFromCut} from './render.js';
import {validateCutSeed,validateStarterPack} from './validate.js';
import {CUT_MODEL_VERSION,type CutSeed,type CutStarterPack} from './types.js';

export * from './types.js';
export {validateCutSeed,validateStarterPack,validateLookalikePair} from './validate.js';
export {lookalikeDiffersOn} from './lookalike.js';
export {looksOf,bakeFidelityParams,applyRuntimeFidelity,CUT_SSMA_AUX} from './fidelity.js';
export {scenarioFromCut,CutSession} from './render.js';
export {STARTER_PACK,STARTER_CUTS} from './starterPack.js';

validateStarterPack(STARTER_PACK);

/** Deep-freeze starter-pack seeds so practice scoring cannot mutate truth keys. */
function deepFreeze<T>(value:T):T{
 if(value!==null&&(typeof value==='object'||typeof value==='function')&&!Object.isFrozen(value)){
  Object.freeze(value);
  for(const k of Reflect.ownKeys(value as object))deepFreeze((value as Record<PropertyKey,unknown>)[k as keyof typeof value]);
 }
 return value;
}
deepFreeze(STARTER_PACK);

export function listCutSeeds():readonly CutSeed[]{return STARTER_CUTS;}

export function getCutSeed(id:string):CutSeed|undefined{return STARTER_CUTS.find(c=>c.id===id);}

export function getCutStarterPack():CutStarterPack{return STARTER_PACK;}

/** Open a fast-drain CutSession from a CutSeed or starter-pack id. */
export function renderCut(cut:CutSeed|string):CutSession {
 const seed=typeof cut==='string'?getCutSeed(cut):cut;
 if(!seed)throw new Error(`Unknown cut id ${String(cut)}`);
 validateCutSeed(seed);
 return new CutSession(seed);
}

export {CUT_MODEL_VERSION};
