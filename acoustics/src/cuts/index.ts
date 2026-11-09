import {STARTER_CUTS,STARTER_PACK} from './starterPack.js';
import {DEMON_CUTS,DEMON_LESSON_PACK} from './demonPack.js';
import {validateDemonLessonPack} from './demonExpectation.js';
import {CutSession,scenarioFromCut} from './render.js';
import {validateCutSeed,validateStarterPack} from './validate.js';
import {CUT_MODEL_VERSION,type CutSeed,type CutStarterPack} from './types.js';

export * from './types.js';
export {validateCutSeed,validateStarterPack,validateLookalikePair} from './validate.js';
export {lookalikeDiffersOn} from './lookalike.js';
export {looksOf,bakeFidelityParams,applyRuntimeFidelity,cutNeedsRuntimeFidelity,CUT_SSMA_AUX} from './fidelity.js';
export {scenarioFromCut,CutSession,CUT_BINS,CUT_FMAX} from './render.js';
export {
 CUT_LOFAR_NORM,CUT_LOFAR_NORM_PASS2,CUT_LOFAR_NORM_GAIN,CUT_LOFAR_NORM_RECIPE,
 DEMON_NORM,DEMON_CARRIER_BAND,DEMON_DISPLAY_DB,SplitWindowNormalizer,normalizeCutRow,normalizeCutLofarRow,normalizeDemonRow,
 type NormParams,type DemonNormParams,type CutLofarNormRecipe,
} from './norm.js';
export {STARTER_PACK,STARTER_CUTS} from './starterPack.js';
export {DEMON_LESSON_PACK,DEMON_CUTS,DEMON_LESSON_CUT_IDS} from './demonPack.js';
/** Reveal / answer-key only — never attached to live rows, subscriptions or live contact state. */
export {cutDemonExpectation,contactDemonExpectation,scenarioDemonAnswerKey,validateDemonLessonPack,DEMON_REASONS,DEMON_EXPECTED_MIN_MOD_FRACTION,type DemonReason,type DemonExpectation,type ContactDemonExpectation,type CutDemonExpectation} from './demonExpectation.js';

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
validateDemonLessonPack(DEMON_LESSON_PACK,STARTER_CUTS);
deepFreeze(DEMON_LESSON_PACK);

export function listCutSeeds():readonly CutSeed[]{return STARTER_CUTS;}

/** Starter-pack or DEMON-lesson-pack cut by id. */
export function getCutSeed(id:string):CutSeed|undefined{return STARTER_CUTS.find(c=>c.id===id)??DEMON_CUTS.find(c=>c.id===id);}

/** DEMON lesson set in teaching order: main lesson (cut-cinderlilt-cav) first. */
export function listDemonLessonCuts():readonly CutSeed[]{return DEMON_LESSON_PACK.lessonCutIds.map(id=>getCutSeed(id)!);}

export function getCutStarterPack():CutStarterPack{return STARTER_PACK;}

/** Open a fast-drain CutSession from a CutSeed or starter-pack id. */
export function renderCut(cut:CutSeed|string):CutSession {
 const seed=typeof cut==='string'?getCutSeed(cut):cut;
 if(!seed)throw new Error(`Unknown cut id ${String(cut)}`);
 validateCutSeed(seed);
 return new CutSession(seed);
}

export {CUT_MODEL_VERSION};

export {SIM_STREAM_SET,liveSimStreamSet,cutStreamSet,resForBand,type SimStreamId} from '../streamSet.js';

export {SCENARIO_PACK,SCENARIO_CUTS} from './scenarioPack.js';
export {validateScenarioPack} from './validate.js';
export type {CutScenarioKind,CutScenarioPack} from './types.js';
export {CUT_SCENARIO_KINDS} from './types.js';
export {CUT_VISIBILITY_WINDOW,cutVisibilityIds,meanRawRow,localContrastDb,bestLine,contrastNearHz,cutHydpAtS,resolveLessonHz,lessonLineContrasts} from './visibility.js';
export type {LessonContrast} from './visibility.js';
