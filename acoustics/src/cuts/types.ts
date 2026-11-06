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

/** Fixed seed for a short classification practice gram (CUT mode). Public physics only. */
export interface CutSeed {
  v:1;
  /** Pinned acoustics cut renderer revision. */
  modelVersion:string;
  id:string;
  seed:number;
  /** Wall-clock-free sim duration of the cut (seconds), typically 300–600. */
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
