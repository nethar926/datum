import type {OperatingMode} from '../catalog/schema.js';

/** Teaching cut richness: ambient/traffic and how many plant lines are expected on the gram. */
export type CutRichness='sparse'|'moderate'|'rich';

/** Re-export canonical operator mode codes used by CutSeed.mode. */
export type {OperatingMode};

export interface CutClassifyingLine {
  lineFamily:string;
  label:string;
  nominalHz?:number;
  /** True when this line alone separates a lookalike pair (or is the intended teach tip). */
  giveaway:boolean;
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
