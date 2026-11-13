/**
 * Auto DIFAR bearings and ALI peak-to-bearing, reusing the existing public
 * DIFAR noise model (Urick-level cross-spectral variance ~ k/√SNR). Seeded,
 * deterministic, fictional contacts only.
 */
import {deriveSeed, gaussian, mulberry32} from './prng.js';
import {dbToPower, powerToDb} from './units.js';
import {geometry, createGeometry, type Track} from './kinematics.js';
import {doppler} from './doppler.js';
import {transmissionLoss} from './transmissionLoss.js';
import {ambientLevel} from './ambientNoise.js';
import {fillTonals, sourceLevel, type TonalLine} from './sourceModel.js';
import {BEARING_NOISE_K, BEARING_SNR_FLOOR} from './lofar.js';
import {isFeeding, type Buoy} from './buoys.js';
import type {Contact, Environment} from './scenario.js';

/** Matches Dorian's PlotAutoFixes.Line / tactical bearings, plus per-contact fields. */
export type AutoBearing = {
  buoyId: number;
  contactId: string;
  freqHz: number;
  brgDeg: number;
  /** SNR in dB over ambient (same meaning as tactical `quality`). */
  quality: number;
  snrDb: number;
  sigmaDeg: number;
};

export const AUTO_BEARING_MIN_QUALITY = 10;

export type AutoBearingOpts = {
  seed?: number;
  minQuality?: number;
  dfHz?: number;
};

export type ContactPose = Track & {id: string; active?: boolean; lines?: TonalLine[]; params: Contact['params']};

export type AliPeakRequest = {
  freqHz?: number;
  band?: [number, number];
};

export type AliPeakBearing = {
  bearingDeg: number;
  sigmaDeg: number;
  snrDb: number;
  freqHz: number;
};

export function numericBuoyId(id: string, index: number): number {
  return Number(String(id).replace(/\D/g, '')) || index + 1;
}

export function wrapDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/** Mix a float time into a deriveSeed key without JS/Swift string-format drift. */
export function mixSeedTime(seed: number, key: string, t: number): number {
  const s = deriveSeed(seed >>> 0, key);
  const buf = new Float64Array(1); buf[0] = t;
  const u = new Uint32Array(buf.buffer);
  return (s ^ u[0]! ^ Math.imul(u[1]!, 0x9e3779b9)) >>> 0;
}

/** sigmaDeg = min(90, BEARING_NOISE_K / sqrt(SNR)), SNR linear. */
export function bearingSigmaDeg(snrLinear: number): number {
  if (!(snrLinear >= BEARING_SNR_FLOOR)) return 90;
  return Math.min(90, BEARING_NOISE_K / Math.sqrt(snrLinear));
}

function tonalList(c: ContactPose): {hz: number; power: number}[] {
  const lines = c.lines ?? c.params.tonals;
  if (lines && lines.length) {
    const freq = new Float64Array(lines.length), power = new Float64Array(lines.length);
    fillTonals(c.params, freq, power, lines);
    const out: {hz: number; power: number}[] = [];
    for (let i = 0; i < freq.length; i++) if (power[i]! > 0 && freq[i]! > 0) out.push({hz: freq[i]!, power: power[i]!});
    return out;
  }
  const n = 6;
  const freq = new Float64Array(n), power = new Float64Array(n);
  fillTonals(c.params, freq, power);
  const out: {hz: number; power: number}[] = [];
  for (let i = 0; i < n; i++) if (power[i]! > 0 && freq[i]! > 0) out.push({hz: freq[i]!, power: power[i]!});
  return out;
}

function receivedSnr(power: number, freqHz: number, rangeM: number, env: Environment, dfHz: number, absTonals: boolean, slDb: number): number {
  const tl = transmissionLoss(rangeM, freqHz, env.spreading, env.transition);
  const sent = absTonals ? power : power * dbToPower(slDb);
  const recv = sent * dbToPower(-tl);
  const psd = recv / Math.max(1e-12, dfHz);
  const amb = dbToPower(ambientLevel(freqHz, env.seaState, env.shipping, env.shippingDensity));
  return psd / Math.max(1e-30, amb);
}

function noisyBearing(trueRad: number, snrLinear: number, rngSeed: number): {brgDeg: number; sigmaDeg: number} {
  const rng = mulberry32(rngSeed >>> 0);
  if (!(snrLinear >= BEARING_SNR_FLOOR)) {
    return {brgDeg: rng() * 360, sigmaDeg: 90};
  }
  const sigmaDeg = bearingSigmaDeg(snrLinear);
  const brgDeg = wrapDeg(trueRad * 180 / Math.PI + sigmaDeg * gaussian(rng));
  return {brgDeg, sigmaDeg};
}

/**
 * Strongest-SNR DIFAR bearing per (feeding buoy, active contact) above
 * `minQuality` (default 10 dB, Dorian's MIN_DRAW_Q). Pure in t given poses.
 */
export function autoBearingsFromState(args: {
  buoys: Buoy[];
  contacts: ContactPose[];
  environment: Environment;
  seed: number;
  atSimTime: number;
  minQuality?: number;
  dfHz?: number;
}): AutoBearing[] {
  const minQ = args.minQuality ?? AUTO_BEARING_MIN_QUALITY;
  const dfHz = args.dfHz ?? 1;
  const env = args.environment;
  const g = createGeometry();
  const out: AutoBearing[] = [];
  for (let bi = 0; bi < args.buoys.length; bi++) {
    const b = args.buoys[bi]!;
    if (b.type !== 'difar' || !isFeeding(b, args.atSimTime)) continue;
    const buoyId = numericBuoyId(b.id, bi);
    for (const c of args.contacts) {
      if (c.active === false) continue;
      geometry(c, b, g);
      if (!(g.range > 1e-6)) continue;
      const sl = sourceLevel(c.params, c.speed, c.depth);
      const abs = c.params.tonalRefDb !== undefined;
      let best: {freqHz: number; snr: number} | undefined;
      for (const line of tonalList(c)) {
        const f = doppler(line.hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
        const snr = receivedSnr(line.power, f, g.range, env, dfHz, abs, sl);
        if (!best || snr > best.snr) best = {freqHz: f, snr};
      }
      if (!best) continue;
      const snrDb = powerToDb(best.snr);
      if (snrDb < minQ) continue;
      const rngSeed = mixSeedTime(args.seed, `autobearing:${buoyId}:${c.id}`, args.atSimTime);
      const nb = noisyBearing(g.bearing, best.snr, rngSeed);
      out.push({
        buoyId, contactId: c.id, freqHz: best.freqHz,
        brgDeg: nb.brgDeg, quality: snrDb, snrDb, sigmaDeg: nb.sigmaDeg,
      });
    }
  }
  return out;
}

/** ALI peak send: DIFAR bearing at a frequency or the strongest bin in a band. */
export function sendBearingFromPeakAt(args: {
  buoy: Buoy;
  buoyIndex: number;
  contacts: ContactPose[];
  environment: Environment;
  seed: number;
  atSimTime: number;
  freqHz?: number;
  band?: [number, number];
  dfHz?: number;
}): AliPeakBearing {
  const env = args.environment;
  const dfHz = args.dfHz ?? 1;
  const g = createGeometry();
  let east = 0, north = 0, sig = 0, freqUsed = args.freqHz ?? ((args.band?.[0] ?? 0) + (args.band?.[1] ?? 0)) / 2;
  const lo = args.band?.[0], hi = args.band?.[1];
  for (const c of args.contacts) {
    if (c.active === false) continue;
    geometry(c, args.buoy, g);
    if (!(g.range > 1e-6)) continue;
    const sl = sourceLevel(c.params, c.speed, c.depth);
    const abs = c.params.tonalRefDb !== undefined;
    const sinB = Math.sin(g.bearing), cosB = Math.cos(g.bearing);
    for (const line of tonalList(c)) {
      const f = doppler(line.hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
      if (args.freqHz !== undefined) {
        const half = Math.max(dfHz, 1) / 2;
        if (Math.abs(f - args.freqHz) > half && Math.abs(line.hz - args.freqHz) > half) continue;
      } else if (lo !== undefined && hi !== undefined) {
        if ((f < lo || f > hi) && (line.hz < lo || line.hz > hi)) continue;
      }
      const snr = receivedSnr(line.power, f, g.range, env, dfHz, abs, sl);
      if (snr > sig) { sig = snr; freqUsed = f; }
      const w = Math.max(0, snr);
      east += w * sinB;
      north += w * cosB;
    }
  }
  const snrDb = powerToDb(Math.max(1e-30, sig));
  const trueRad = (east === 0 && north === 0) ? 0 : Math.atan2(east, north);
  const id = numericBuoyId(args.buoy.id, args.buoyIndex);
  const rngSeed = mixSeedTime(mixSeedTime(args.seed, `ali-bearing:${id}`, args.atSimTime), 'f', freqUsed);
  const nb = noisyBearing(trueRad, sig, rngSeed);
  return {bearingDeg: nb.brgDeg, sigmaDeg: nb.sigmaDeg, snrDb, freqHz: freqUsed};
}
