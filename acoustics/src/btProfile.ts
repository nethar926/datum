/**
 * Seeded fictional bathythermograph / sound-speed profile for Dorian's BT/SSP
 * seam. Public physics only: Mackenzie (1981) nine-term equation, an isothermal
 * mixed layer (c rises with depth from pressure), a thermocline (temperature
 * drops), then a deep isothermal region. Not a real-ocean survey.
 */
import {deriveSeed, mulberry32} from './prng.js';
import {soundSpeed, type MackenzieOutOfRange} from './units.js';
import {buildWaterColumn, type WaterColumnProfile} from './waterColumn.js';

/** One depth sample on the shared BT/SSP axis. Salinity is constant with depth. */
export type BtSample = {
  depthM: number;
  tempC: number;
  salPsu: number;
  cMps: number;
};

/**
 * Dorian's BT/SSP feed. `layerDepthM` is the isothermal mixed-layer depth.
 * `sonicLayerDepthM` is the near-surface sound-speed maximum (where dc/dz
 * changes from + to −). `deepChannelAxisM` is the deep c minimum when it
 * sits strictly above the seafloor; omitted otherwise.
 */
export type BtProfile = {
  profile: BtSample[];
  layerDepthM: number;
  sonicLayerDepthM: number;
  thermoclineBaseM: number;
  deepChannelAxisM?: number;
  salinityPsu: number;
  outOfRange: MackenzieOutOfRange;
};

export type BtProfileOpts = {
  maxDepthM?: number;
  samples?: number;
  surfaceTempC?: number;
  deepTempC?: number;
  salinityPsu?: number;
  mixedLayerDepthM?: number;
  thermoclineThicknessM?: number;
};

export type BtProfileSource = number | {
  seed?: number;
  environment?: {temperatureC?: number; salinityPsu?: number};
  waterColumn?: WaterColumnProfile;
};

export type BtDropSpec = {
  x: number;
  y: number;
  id?: number;
  maxDepthM?: number;
  samples?: number;
};

export type BtDrop = {
  id: number;
  x: number;
  y: number;
  profile: BtProfile;
};

const DEFAULT_MAX_DEPTH_M = 2000;
const DEFAULT_SAMPLES = 129;

function sourceSeed(src: BtProfileSource): number {
  if (typeof src === 'number') return src >>> 0;
  return (src.seed ?? 0) >>> 0;
}

function seededDefaults(seed: number): Required<Pick<BtProfileOpts,
  'surfaceTempC' | 'deepTempC' | 'salinityPsu' | 'mixedLayerDepthM' | 'thermoclineThicknessM' | 'maxDepthM' | 'samples'>> {
  const rng = mulberry32(deriveSeed(seed, 'bt-profile'));
  const surfaceTempC = 12 + rng() * 10;           // 12–22 °C
  const deepTempC = 2 + rng() * 5;                // 2–7 °C
  const salinityPsu = 34 + rng() * 1.5;           // 34–35.5 PSU
  const mixedLayerDepthM = 20 + rng() * 60;       // 20–80 m
  const thermoclineThicknessM = 80 + rng() * 400; // 80–480 m
  return {
    surfaceTempC, deepTempC, salinityPsu, mixedLayerDepthM, thermoclineThicknessM,
    maxDepthM: DEFAULT_MAX_DEPTH_M, samples: DEFAULT_SAMPLES,
  };
}

/** Depth of the near-surface c maximum (first + to − sign change of dc/dz, else shallowest max). */
export function sonicLayerDepthOf(profile: BtSample[], thermoclineBaseM: number): number {
  if (profile.length === 0) return 0;
  const cap = thermoclineBaseM;
  let iMax = 0, cMax = profile[0]!.cMps;
  for (let i = 1; i < profile.length; i++) {
    const z = profile[i]!.depthM, c = profile[i]!.cMps;
    if (z > cap + 1e-9) break;
    if (c >= cMax) { cMax = c; iMax = i; }
  }
  return profile[iMax]!.depthM;
}

/**
 * Depth of the deep c minimum when a deeper sample has a higher c (a channel
 * axis, not the seafloor). Undefined if the minimum is at the bottom.
 */
export function deepChannelAxisOf(profile: BtSample[], sonicLayerDepthM: number): number | undefined {
  if (profile.length < 3) return undefined;
  let iMin = -1, cMin = Infinity;
  for (let i = 0; i < profile.length; i++) {
    const s = profile[i]!;
    if (s.depthM < sonicLayerDepthM - 1e-9) continue;
    if (s.cMps < cMin) { cMin = s.cMps; iMin = i; }
  }
  if (iMin <= 0 || iMin >= profile.length - 1) return undefined;
  const below = profile[iMin + 1]!;
  if (!(below.cMps > profile[iMin]!.cMps + 1e-12)) return undefined;
  return profile[iMin]!.depthM;
}

function samplesFromColumn(p: WaterColumnProfile): BtSample[] {
  const n = p.depthM.length, out: BtSample[] = [];
  for (let i = 0; i < n; i++) {
    const depthM = p.depthM[i]!, tempC = p.temperatureC[i]!, salPsu = p.salinityPsu;
    out.push({depthM, tempC, salPsu, cMps: p.soundSpeedMps[i] ?? soundSpeed(tempC, salPsu, depthM)});
  }
  return out;
}

function finish(samples: BtSample[], layerDepthM: number, thermoclineBaseM: number, salinityPsu: number, outOfRange: MackenzieOutOfRange): BtProfile {
  const sonicLayerDepthM = sonicLayerDepthOf(samples, thermoclineBaseM);
  const deepChannelAxisM = deepChannelAxisOf(samples, sonicLayerDepthM);
  const profile: BtProfile = {profile: samples, layerDepthM, sonicLayerDepthM, thermoclineBaseM, salinityPsu, outOfRange};
  if (deepChannelAxisM !== undefined) profile.deepChannelAxisM = deepChannelAxisM;
  return profile;
}

export function btProfileFromWaterColumn(p: WaterColumnProfile): BtProfile {
  const samples = samplesFromColumn(p);
  return finish(samples, p.mixedLayerDepthM, p.thermoclineBaseM, p.salinityPsu, p.outOfRange);
}

/**
 * Build a seeded BT/SSP. When `src` is a scenario with `waterColumn` and no
 * shape overrides, that column is reused (SLD / axis are derived). Otherwise a
 * fictional Mackenzie profile is generated from the seed, with mixed-layer and
 * thermocline-base depths inserted so they land on samples.
 */
export function btProfile(src: BtProfileSource, opts: BtProfileOpts = {}): BtProfile {
  if (typeof src !== 'number' && src.waterColumn &&
      opts.maxDepthM === undefined && opts.mixedLayerDepthM === undefined &&
      opts.thermoclineThicknessM === undefined && opts.surfaceTempC === undefined &&
      opts.deepTempC === undefined && opts.salinityPsu === undefined && opts.samples === undefined) {
    return btProfileFromWaterColumn(src.waterColumn);
  }
  const seed = sourceSeed(src);
  const dflt = seededDefaults(seed);
  const env = typeof src === 'number' ? undefined : src.environment;
  const surfaceTempC = opts.surfaceTempC ?? env?.temperatureC ?? dflt.surfaceTempC;
  const deepTempC = opts.deepTempC ?? Math.min(surfaceTempC - 4, dflt.deepTempC);
  const salinityPsu = opts.salinityPsu ?? env?.salinityPsu ?? dflt.salinityPsu;
  const maxDepthM = opts.maxDepthM ?? dflt.maxDepthM;
  const mixedLayerDepthM = opts.mixedLayerDepthM ?? dflt.mixedLayerDepthM;
  const thermoclineThicknessM = opts.thermoclineThicknessM ?? dflt.thermoclineThicknessM;
  const samplesN = opts.samples ?? dflt.samples;

  const wc = buildWaterColumn({
    surfaceTempC, deepTempC, salinityPsu, maxDepthM,
    mixedLayerDepthM, thermoclineThicknessM, samples: samplesN,
  });
  // Insert the layer knees so SLD / layer depth land on samples.
  const depths = new Set<number>([...wc.depthM]);
  depths.add(0);
  depths.add(wc.mixedLayerDepthM);
  depths.add(wc.thermoclineBaseM);
  depths.add(wc.depthM[wc.depthM.length - 1]!);
  const zs = [...depths].sort((a, b) => a - b);
  const S = wc.salinityPsu;
  const Ts = wc.temperatureC[0]!;
  // Deep T is the last sample of the original column.
  const Td = wc.temperatureC[wc.temperatureC.length - 1]!;
  const mld = wc.mixedLayerDepthM, base = wc.thermoclineBaseM;
  const out: BtSample[] = [];
  for (const z of zs) {
    let T: number;
    if (z <= mld) T = Ts;
    else if (z >= base) T = Td;
    else {
      const u = (z - mld) / Math.max(1e-12, base - mld);
      const s = u * u * (3 - 2 * u);
      T = Ts + (Td - Ts) * s;
    }
    out.push({depthM: z, tempC: T, salPsu: S, cMps: soundSpeed(T, S, z)});
  }
  return finish(out, mld, base, S, wc.outOfRange);
}

/** A BT buoy drop returns the scenario's (or seed's) profile; no RF channel. */
export function dropBtBuoy(src: BtProfileSource, spec: BtDropSpec): BtDrop {
  const profile = btProfile(src, {maxDepthM: spec.maxDepthM, samples: spec.samples});
  const id = spec.id ?? 1;
  return {id, x: spec.x, y: spec.y, profile};
}

