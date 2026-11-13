/**
 * BFI per-band samples for Dorian's `pointsFromBandSamples` / `bfiPointsFromBandSamples`
 * seam. DIFAR only. Each user-editable Hz band is collapsed in frequency to a
 * band-integrated level-versus-bearing curve, using the existing public DIFAR
 * noise model. Fictional contacts, public physics only.
 */
import {gaussian, mulberry32} from './prng.js';
import {dbToPower, powerToDb} from './units.js';
import {geometry, createGeometry} from './kinematics.js';
import {doppler} from './doppler.js';
import {transmissionLoss} from './transmissionLoss.js';
import {ambientLevel} from './ambientNoise.js';
import {fillTonals, sourceLevel} from './sourceModel.js';
import {BEARING_SNR_FLOOR} from './lofar.js';
import {isFeeding, type Buoy} from './buoys.js';
import type {Environment} from './scenario.js';
import {
  bearingSigmaDeg, mixSeedTime, numericBuoyId, wrapDeg,
  type ContactPose,
} from './autoBearings.js';

/** Inclusive frequency window in Hz. Defaults match Dorian's three BFI presets. */
export type BfiBand = {loHz: number; hiHz: number};

/** One band's integrated power against bearing (degrees true, 0..360). */
export type BfiBandResult = {
  loHz: number;
  hiHz: number;
  /** Band midpoint, for Dorian's `BfiBandSample.freqHz`. */
  freqHz: number;
  bearingDeg: number[];
  levelDb: number[];
};

export type BfiBandSamples = {
  buoyId: number;
  atSimTime: number;
  bands: BfiBandResult[];
};

export const BFI_DEFAULT_BANDS: BfiBand[] = [
  {loHz: 10, hiHz: 100},
  {loHz: 10, hiHz: 500},
  {loHz: 100, hiHz: 1000},
];

/** 1° bearing axis (0, 1, …, 359). */
export const BFI_BEARING_BINS = 360;

export function clampBfiRange(range: BfiBand, minSpan = 1): BfiBand {
  let lo = Number.isFinite(range.loHz) ? range.loHz : 0;
  let hi = Number.isFinite(range.hiHz) ? range.hiHz : lo + minSpan;
  if (lo < 0) lo = 0;
  if (hi < 0) hi = 0;
  if (hi < lo) { const t = lo; lo = hi; hi = t; }
  if (hi - lo < minSpan) hi = lo + minSpan;
  return {loHz: lo, hiHz: hi};
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

function receivedLinear(power: number, freqHz: number, rangeM: number, env: Environment, absTonals: boolean, slDb: number): number {
  const tl = transmissionLoss(rangeM, freqHz, env.spreading, env.transition);
  const sent = absTonals ? power : power * dbToPower(slDb);
  return sent * dbToPower(-tl);
}

/**
 * Band-integrated DIFAR BFI at `atSimTime`. Throws on an unknown buoy or a
 * non-DIFAR receiver. A non-feeding DIFAR buoy returns empty arrays per band.
 * Pure in t given poses; does not mutate the engine.
 */
export function bfiBandSamplesFromState(args: {
  buoy: Buoy;
  buoyIndex: number;
  contacts: ContactPose[];
  environment: Environment;
  seed: number;
  atSimTime: number;
  bands?: BfiBand[];
  dfHz?: number;
}): BfiBandSamples {
  const buoyId = numericBuoyId(args.buoy.id, args.buoyIndex);
  if (args.buoy.type !== 'difar') throw new Error('BFI is DIFAR only');
  const dfHz = args.dfHz ?? 1;
  const bandsIn = args.bands && args.bands.length ? args.bands : BFI_DEFAULT_BANDS;
  const feeding = isFeeding(args.buoy, args.atSimTime);
  const env = args.environment;
  const g = createGeometry();
  const outBands: BfiBandResult[] = [];
  for (const raw of bandsIn) {
    const band = clampBfiRange(raw);
    const freqHz = (band.loHz + band.hiHz) / 2;
    const levels = new Float64Array(BFI_BEARING_BINS);
    if (feeding) {
      for (const c of args.contacts) {
        if (c.active === false) continue;
        geometry(c, args.buoy, g);
        if (!(g.range > 1e-6)) continue;
        const sl = sourceLevel(c.params, c.speed, c.depth);
        const abs = c.params.tonalRefDb !== undefined;
        let recv = 0, amb = 0, east = 0, north = 0, nF = 0;
        const sinB = Math.sin(g.bearing), cosB = Math.cos(g.bearing);
        for (const line of tonalList(c)) {
          const f = doppler(line.hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
          if (f < band.loHz - 1e-9 || f > band.hiHz + 1e-9) {
            if (line.hz < band.loHz - 1e-9 || line.hz > band.hiHz + 1e-9) continue;
          }
          const p = receivedLinear(line.power, f, g.range, env, abs, sl);
          recv += p;
          east += p * sinB;
          north += p * cosB;
          amb += dbToPower(ambientLevel(f, env.seaState, env.shipping, env.shippingDensity)) * Math.max(1e-12, dfHz);
          nF++;
        }
        // Also integrate a dense grid so broadband/band shape is defined even
        // when a contact's tonals sit just outside the clip after Doppler.
        if (nF === 0) {
          for (let f = band.loHz; f <= band.hiHz + 1e-9; f += dfHz) {
            amb += dbToPower(ambientLevel(f, env.seaState, env.shipping, env.shippingDensity)) * Math.max(1e-12, dfHz);
          }
          continue;
        }
        const snr = recv / Math.max(1e-30, amb);
        const trueRad = (east === 0 && north === 0) ? g.bearing : Math.atan2(east, north);
        let rngSeed = mixSeedTime(args.seed, `bfi:${buoyId}:${c.id}`, args.atSimTime);
        rngSeed = mixSeedTime(rngSeed, 'lo', band.loHz);
        rngSeed = mixSeedTime(rngSeed, 'hi', band.hiHz);
        rngSeed = mixSeedTime(rngSeed, 'f', freqHz);
        const rng = mulberry32(rngSeed);
        let brgDeg: number;
        if (!(snr >= BEARING_SNR_FLOOR)) brgDeg = rng() * 360;
        else {
          const sigma = bearingSigmaDeg(snr);
          brgDeg = wrapDeg(trueRad * 180 / Math.PI + sigma * gaussian(rng));
        }
        const bin = ((Math.round(brgDeg) % BFI_BEARING_BINS) + BFI_BEARING_BINS) % BFI_BEARING_BINS;
        levels[bin]! += recv;
      }
    }
    const bearingDeg: number[] = [], levelDb: number[] = [];
    for (let i = 0; i < BFI_BEARING_BINS; i++) {
      if (!(levels[i]! > 0)) continue;
      bearingDeg.push(i);
      levelDb.push(powerToDb(levels[i]!));
    }
    outBands.push({loHz: band.loHz, hiHz: band.hiHz, freqHz, bearingDeg, levelDb});
  }
  return {buoyId, atSimTime: args.atSimTime, bands: outBands};
}

/** Look up a buoy and return BFI samples, or throw. */
export function bfiBandSamplesForBuoy(args: {
  buoys: Buoy[];
  buoyId: number;
  contacts: ContactPose[];
  environment: Environment;
  seed: number;
  atSimTime: number;
  bands?: BfiBand[];
  dfHz?: number;
}): BfiBandSamples {
  const i = args.buoys.findIndex((b, idx) => numericBuoyId(b.id, idx) === args.buoyId);
  if (i < 0) throw new Error('Unknown buoyId');
  return bfiBandSamplesFromState({
    buoy: args.buoys[i]!, buoyIndex: i, contacts: args.contacts,
    environment: args.environment, seed: args.seed, atSimTime: args.atSimTime,
    bands: args.bands, dfHz: args.dfHz,
  });
}

