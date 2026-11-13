/**
 * Seeded fictional AIS surface tracks for Dorian's `AisTrackSource` seam.
 * Callsign, class and type are made-up (letters/digits and a closed list);
 * kinematics are great-circle-free straight-line dead-reckoning in the
 * scenario frame (x east, y north, metres) with occasional course changes.
 * Everything is deterministic in (seed, id, t). Public physics only.
 */
import { deriveSeed, mulberry32, type Random } from './prng.js';
import { knotsToMps } from './units.js';

export const AIS_TYPES = ['cargo', 'tanker', 'fishing', 'ferry', 'yacht', 'tug'] as const;
export type AisType = (typeof AIS_TYPES)[number];

/**
 * Fictional class names per type. These are invented labels for the training
 * card, not real ship classes or hull numbers.
 */
export const AIS_CLASSES: Record<AisType, readonly string[]> = {
  cargo: ['Holdfast', 'Keelmark', 'Lakerunner', 'Cratewell'],
  tanker: ['Cistern', 'Amberhold', 'Vatline', 'Oilreed'],
  fishing: ['Netspear', 'Covehand', 'Ridgeline', 'Ironhook'],
  ferry: ['Crossing', 'Channelhop', 'Pierstep', 'Tidallane'],
  yacht: ['Leeward', 'Brightwake', 'Silverlee', 'Windgage'],
  tug: ['Pushpoint', 'Harbourmule', 'Bitthead', 'Warplines'],
};

/** Invented vessel names (no "fictional " prefix; not real ships). */
export const AIS_NAMES = [
  'Ridgeskiff', 'Copperwake', 'Nettlebarge', 'Quartzhaul', 'Brindlekite',
  'Pebbledraft', 'Lumenkeel', 'Shalehopper', 'Cinderpunt', 'Mossyawl',
  'Thistledraft', 'Opalskiff', 'Flaxkeel', 'Amberpunt', 'Covebarge',
] as const;

export const AIS_DEFAULT_COUNT = 8;
export const AIS_DEFAULT_SPREAD_M = 20 * 1852;
export const AIS_HORIZON_S = 48 * 3600;
export const AIS_MIN_LEG_S = 8 * 60;
export const AIS_MAX_LEG_S = 20 * 60;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '0123456789';

export type AisEngineTrack = {
  id: string;
  callsign: string;
  name: string;
  shipClass: string;
  /** Alias of `shipClass` for the web card (`class` / `shipClass`). */
  class: string;
  type: AisType;
  x: number;
  y: number;
  /** Degrees true, wrapped to [0, 360). */
  crsDeg: number;
  spdMps: number;
};

export type AisIdentity = {
  callsign: string;
  name: string;
  shipClass: string;
  type: AisType;
};

export type AisTrackSourceSpec = {
  seed: number;
  count?: number;
  originX?: number;
  originY?: number;
  t0?: number;
  spreadM?: number;
  horizonS?: number;
};

export type AisTrackSource = {
  aisTrack(id: string, atSimTime?: number): AisEngineTrack | undefined;
  aisTracks(atSimTime?: number): AisEngineTrack[];
  decorate(track: DecorateIn, atSimTime?: number): AisEngineTrack;
};

export type DecorateIn = {
  id: string;
  name?: string;
  x: number;
  y: number;
  crsDeg: number;
  spdMps: number;
};

type AisLeg = {
  tStart: number;
  x: number;
  y: number;
  crsRad: number;
  spdMps: number;
  durationS: number;
};

type AisPlan = {
  id: string;
  identity: AisIdentity;
  spdMps: number;
  legs: AisLeg[];
};

const TYPE_SPEED_KN: Record<AisType, readonly [number, number]> = {
  cargo: [12, 16],
  tanker: [10, 14],
  fishing: [4, 8],
  ferry: [14, 22],
  yacht: [6, 12],
  tug: [6, 10],
};

function pick<T>(rng: Random, list: readonly T[]): T {
  const i = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[i]!;
}

function pickChar(rng: Random, alphabet: string): string {
  const i = Math.min(alphabet.length - 1, Math.floor(rng() * alphabet.length));
  return alphabet[i]!;
}

function wrapDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

function headingDeg(rad: number): number {
  return wrapDeg(rad * 180 / Math.PI);
}

/** Callsign like `WK47N`: letters and digits, no real-world prefix claim. */
export function formatCallsign(rng: Random): string {
  return (
    pickChar(rng, LETTERS) + pickChar(rng, LETTERS) +
    pickChar(rng, DIGITS) + pickChar(rng, DIGITS) +
    pickChar(rng, LETTERS)
  );
}

export function identityFromRng(rng: Random): AisIdentity {
  const type = pick(rng, AIS_TYPES);
  const shipClass = pick(rng, AIS_CLASSES[type]);
  const name = pick(rng, AIS_NAMES);
  const callsign = formatCallsign(rng);
  return { callsign, name, shipClass, type };
}

/** Deterministic identity for any contact id (seed + id). */
export function aisIdentity(seed: number, id: string): AisIdentity {
  const rng = mulberry32(deriveSeed(seed >>> 0, id));
  return identityFromRng(rng);
}

function trackId(i: number): string {
  return `ais-${String(i).padStart(2, '0')}`;
}

function buildPlan(seed: number, index: number, spec: Required<AisTrackSourceSpec>): AisPlan {
  const id = trackId(index);
  const rng = mulberry32(deriveSeed(seed >>> 0, id));
  const identity = identityFromRng(rng);
  const [loKn, hiKn] = TYPE_SPEED_KN[identity.type];
  const spdMps = knotsToMps(loKn + rng() * (hiKn - loKn));
  const ang = rng() * 2 * Math.PI;
  const rad = Math.sqrt(rng()) * spec.spreadM;
  const x0 = spec.originX + rad * Math.sin(ang);
  const y0 = spec.originY + rad * Math.cos(ang);
  let crs = rng() * 2 * Math.PI;
  const legs: AisLeg[] = [];
  let t = spec.t0, x = x0, y = y0;
  const end = spec.t0 + spec.horizonS;
  while (t < end) {
    const span = AIS_MIN_LEG_S + rng() * (AIS_MAX_LEG_S - AIS_MIN_LEG_S);
    const durationS = Math.min(span, end - t);
    legs.push({ tStart: t, x, y, crsRad: crs, spdMps, durationS });
    t += durationS;
    x += spdMps * Math.sin(crs) * durationS;
    y += spdMps * Math.cos(crs) * durationS;
    // Typical change ±60°, 10% of legs up to ±120°.
    const wide = rng() < 0.1;
    const maxD = wide ? (2 * Math.PI / 3) : (Math.PI / 3);
    crs = crs + (rng() * 2 - 1) * maxD;
  }
  return { id, identity, spdMps, legs };
}

function poseOnPlan(plan: AisPlan, t: number): { x: number; y: number; crsRad: number; spdMps: number } {
  const legs = plan.legs;
  if (legs.length === 0) return { x: 0, y: 0, crsRad: 0, spdMps: plan.spdMps };
  const first = legs[0]!;
  if (t <= first.tStart) {
    const dt = t - first.tStart;
    return {
      x: first.x + first.spdMps * Math.sin(first.crsRad) * dt,
      y: first.y + first.spdMps * Math.cos(first.crsRad) * dt,
      crsRad: first.crsRad,
      spdMps: first.spdMps,
    };
  }
  const last = legs[legs.length - 1]!;
  const lastEnd = last.tStart + last.durationS;
  if (t >= lastEnd) {
    const dt = t - last.tStart;
    return {
      x: last.x + last.spdMps * Math.sin(last.crsRad) * dt,
      y: last.y + last.spdMps * Math.cos(last.crsRad) * dt,
      crsRad: last.crsRad,
      spdMps: last.spdMps,
    };
  }
  // Binary search the leg containing t (right-open interval except the last).
  let lo = 0, hi = legs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (legs[mid]!.tStart <= t) lo = mid;
    else hi = mid - 1;
  }
  const leg = legs[lo]!;
  const dt = t - leg.tStart;
  return {
    x: leg.x + leg.spdMps * Math.sin(leg.crsRad) * dt,
    y: leg.y + leg.spdMps * Math.cos(leg.crsRad) * dt,
    crsRad: leg.crsRad,
    spdMps: leg.spdMps,
  };
}

function toTrack(plan: AisPlan, t: number): AisEngineTrack {
  const p = poseOnPlan(plan, t);
  const idn = plan.identity;
  return {
    id: plan.id,
    callsign: idn.callsign,
    name: idn.name,
    shipClass: idn.shipClass,
    class: idn.shipClass,
    type: idn.type,
    x: p.x, y: p.y,
    crsDeg: headingDeg(p.crsRad),
    spdMps: p.spdMps,
  };
}

function fillSpec(spec: AisTrackSourceSpec): Required<AisTrackSourceSpec> {
  return {
    seed: spec.seed >>> 0,
    count: spec.count ?? AIS_DEFAULT_COUNT,
    originX: spec.originX ?? 0,
    originY: spec.originY ?? 0,
    t0: spec.t0 ?? 0,
    spreadM: spec.spreadM ?? AIS_DEFAULT_SPREAD_M,
    horizonS: spec.horizonS ?? AIS_HORIZON_S,
  };
}

export class SeededAisTrackSource implements AisTrackSource {
  readonly spec: Required<AisTrackSourceSpec>;
  readonly plans: readonly AisPlan[];
  private readonly byId: Map<string, AisPlan>;

  constructor(spec: AisTrackSourceSpec) {
    const s = fillSpec(spec);
    this.spec = s;
    const plans: AisPlan[] = [];
    for (let i = 0; i < s.count; i++) plans.push(buildPlan(s.seed, i, s));
    this.plans = plans;
    this.byId = new Map(plans.map((p) => [p.id, p]));
  }

  aisTrack(id: string, atSimTime = 0): AisEngineTrack | undefined {
    const plan = this.byId.get(id);
    if (!plan) return undefined;
    return toTrack(plan, atSimTime);
  }

  aisTracks(atSimTime = 0): AisEngineTrack[] {
    return this.plans.map((p) => toTrack(p, atSimTime));
  }

  /**
   * Keep an existing engine/plot pose and fill callsign, class and type from
   * `seed + id`. Use this so the card does not override Reveal-frame kinematics.
   */
  decorate(track: DecorateIn, _atSimTime = 0): AisEngineTrack {
    const idn = aisIdentity(this.spec.seed, track.id);
    return {
      id: track.id,
      callsign: idn.callsign,
      name: track.name && track.name.trim() ? track.name : idn.name,
      shipClass: idn.shipClass,
      class: idn.shipClass,
      type: idn.type,
      x: track.x, y: track.y,
      crsDeg: wrapDeg(track.crsDeg),
      spdMps: track.spdMps,
    };
  }
}

export function createAisTrackSource(spec: AisTrackSourceSpec): SeededAisTrackSource {
  return new SeededAisTrackSource(spec);
}
