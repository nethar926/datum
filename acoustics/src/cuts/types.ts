import type {OperatingMode} from '../catalog/schema.js';

/** Teaching cut richness: ambient/traffic and how many plant lines are expected on the gram. */
export type CutRichness='sparse'|'moderate'|'rich';

/** Re-export canonical operator mode codes used by CutSeed.mode. */
export type {OperatingMode};

/**
 * Optional gram-fidelity looks (Wilson CUT notes). Additive; FE may ignore unknown ids.
 * Render applies the ones that need a small acoustics hook; the rest are seed/config only.
 * Slip rate and full SNORK↔BATT mode-switch remain deferred; engine-knee is RPM scale only.
 */
export const GRAM_LOOK_IDS=[
 'engine-harmonics',
 'blade-harmonics-reinforced',
 'cavitation',
 'slow-demon-blade',
 'harmonic-skip',
 'ssma-harmonics-only',
 'compendium-truth',
 'electrical-ac-dc',
 'eda-locked',
 'propulsion-ramp', // catalog EDA ramp riseS/fallS only — not a mode switch
 'engine-knee',     // ratio-locked CSR/CFR/EFR/EDA slowdown via engine-ramp transient
 'msr-dominant',
] as const;
export type GramLookId=typeof GRAM_LOOK_IDS[number];

/** Teaching behaviour tag on a classifying line (FE HUD / scoring hints). */
export const CUT_LINE_BEHAVIOURS=[
 'stable',          // AC-like: discrete, narrow, little wander
 'unstable',        // DC-like: wanders a few Hz
 'skipped',         // intermediate harmonic drowned / not visible
 'harmonics-only',  // SSMA-style: harmonics present, no fundamental
 'ramping',         // uses catalog EDA ramp riseS/fallS
 'kneeing',         // ratio-locked engine family slowdown (engine-ramp)
 'broadband',       // cavitation / flow broadband (no single tone)
] as const;
export type CutLineBehaviour=typeof CUT_LINE_BEHAVIOURS[number];

export interface CutClassifyingLine {
  lineFamily:string;
  label:string;
  nominalHz?:number;
  /** True when this line alone separates a lookalike pair (or is the intended teach tip). */
  giveaway:boolean;
  /**
   * Family this tone is an integer harmonic of (e.g. EDA→CFR, BR h2→BR, BR→PSR).
   * Omit when the line is the family's own fundamental (n===1) with no parent family.
   */
  harmonicOf?:string;
  /** Harmonic order; 1 = fundamental of `lineFamily` (or of `harmonicOf` when set). */
  n?:number;
  /** Teaching behaviour for FE reveal / scoring. */
  behaviour?:CutLineBehaviour;
}

/** 15-min scenario-pack kinds (Wilson procedural teaching cuts). */
export const CUT_SCENARIO_KINDS=[
 'surfaced','snorting','battery','declutch','swaths','eda-rich','intermittent-aux',
 'limited-data','demon-only','hydp-masked','no-hydp','lloyd-symmetric','lloyd-maneuver',
 'src-fade','cavitation','doppler-cpa',
] as const;
export type CutScenarioKind=typeof CUT_SCENARIO_KINDS[number];

/** Fixed seed for a short classification practice gram (CUT mode). Public physics only. */

/** Optional pinned HYDP burst shape for teaching cuts (masked fund / rich stack). */
export interface CutHydpShape {
  orders:number;
  drownFundamental:boolean;
  drownOrders?:readonly number[];
  fadeS:number;
  powerScale?:number;
}
export interface CutSeed {
  v:1;
  /** Pinned acoustics cut renderer revision. */
  modelVersion:string;
  id:string;
  seed:number;
  /** Wall-clock-free sim duration of the cut (seconds); scenario pack uses 900. */
  durationS:number;
  richness:CutRichness;
  classId:string;
  variantId?:string;
  hullId?:string;
  mode:OperatingMode;
  speedKn:number;
  depthM:number;
  lookalikeGroupId?:string;
  /** Always 1–3 classifying lines the FE can score against. */
  classifyingLines:readonly CutClassifyingLine[];
  /** Optional teaching looks this seed is meant to exercise. */
  gramLooks?:readonly GramLookId[];
  /** Optional scenario-pack kind (15-min static seeded cuts). */
  scenario?:CutScenarioKind;
  /** Pin HYDP burst shape (drown fund / rich harmonics). Requires class.hydp. */
  hydpShape?:CutHydpShape;
  /**
   * Optional FE lesson blurb (cut metadata only). Answer-free: says what to look at, never the
   * class name or whether DEMON lines are expected (that lives in `cutDemonExpectation`).
   */
  lessonNote?:string;
  /** Optional CPA range (m). Default 900. Textbook closer CPA is a cut-design choice
   * (geometry), not a gain hack — document why in cpaNote when set. */
  cpaM?:number;
  /** Why cpaM differs from the default 900 m teaching CPA. */
  cpaNote?:string;
}

export interface CutScenarioPack {
  packVersion:1;
  modelVersion:string;
  /** All cuts are durationS === 900 (15 min). */
  cuts:readonly CutSeed[];
}

export interface CutLookalikePair {
  id:string;
  cutIds:[string,string];
  /** Declared discriminator: 'HYDP' | 'blades' | 'shafts' | aux id, etc. */
  differOn:string;
}

export interface CutStarterPack {
  packVersion:1;
  modelVersion:string;
  cuts:readonly CutSeed[];
  lookalikePairs:readonly CutLookalikePair[];
}

export const CUT_MODEL_VERSION='m3-cuts-1';

/** DEMON lesson pack: cinderlilt-cav is the main lesson; extra 15-min cavitating diesel cuts. */
export interface CutDemonLessonPack {
  packVersion:1;
  modelVersion:string;
  /** Main DEMON lesson cut id (lives in STARTER_PACK). */
  mainLessonCutId:string;
  /** Ordered lesson set: main lesson first, then `cuts`. */
  lessonCutIds:readonly string[];
  cuts:readonly CutSeed[];
}
