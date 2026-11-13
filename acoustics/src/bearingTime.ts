/**
 * Bearing-time series and 360-bin bearing-energy rows for DIFAR buoys.
 *
 * At each 1 s cadence, every feeding DIFAR buoy emits a time entry per tracked
 * line and per configured band, plus one 360-bin energy row (degrees true,
 * compass bias included). Omni and BT buoys emit nothing.
 *
 * sigmaDeg = max(3°, rad2deg(1/sqrt(2·SNR·B·T))). Below the detection floor,
 * valid is false and the bearing is a seeded uniform draw.
 */
import {deriveSeed, mulberry32, gaussian} from './prng.js';
import {dbToPower, powerToDb} from './units.js';
import {geometry, createGeometry} from './kinematics.js';
import {doppler} from './doppler.js';
import {transmissionLoss} from './transmissionLoss.js';
import {ambientLevel} from './ambientNoise.js';
import {fillTonals, sourceLevel} from './sourceModel.js';
import {isFeeding, inferBuoyType, type Buoy} from './buoys.js';
import type {Environment} from './scenario.js';
import {
  numericBuoyId, wrapDeg, mixSeedTime, type ContactPose,
} from './autoBearings.js';

export const BEARING_TIME_PERIOD_S = 1;
export const BEARING_TIME_SIGMA_FLOOR_DEG = 3;
/** Linear SNR below which a time entry is invalid (0 dB). */
export const BEARING_TIME_DETECT_SNR = 1;
export const COMPASS_BIAS_MIN_DEG = 2;
export const COMPASS_BIAS_MAX_DEG = 5;
export const BEARING_ENERGY_BINS = 360;
export const BEARING_ENERGY_F_LO = 10;
export const BEARING_ENERGY_F_HI = 1000;
export const BEARING_ENERGY_DF_HZ = 1;
/** Frames retained per buoy (900 s window + LSTI/late margin + 2). */
export const BEARING_ENERGY_CAPACITY = 1000;

export type BearingTimeEntry = {
  t: number;
  buoyId: number;
  /** Present for a line (tonal or freq-track) entry. */
  freqHz?: number;
  /** Present for a band entry. */
  band?: [number, number];
  /** Degrees true, 0–360, compass bias already included. */
  bearingDeg: number;
  sigmaDeg: number;
  snrDb: number;
  valid: boolean;
};

export type BearingEnergyRow = {
  t: number;
  buoyId: number;
  fLo: number;
  fHi: number;
  /** 360 one-degree bins, 0…359° true, max-normalised and quantised to uint8. */
  energy: Uint8Array;
};

export type BearingTrackSpec = {buoyId: number; freqHz: number};

/** Seeded, fixed compass bias in [−5, −2] ∪ [2, 5] degrees, constant per buoy. */
export function compassBiasDeg(seed: number, buoyId: number): number {
  const rng = mulberry32(deriveSeed(seed >>> 0, `compass-bias:${buoyId}`));
  const mag = COMPASS_BIAS_MIN_DEG + (COMPASS_BIAS_MAX_DEG - COMPASS_BIAS_MIN_DEG) * rng();
  return rng() < 0.5 ? -mag : mag;
}

/**
 * CRLB-style bearing sigma: max(3°, (180/π) / sqrt(2·SNR·B·T)).
 * `snrLinear` is signal/ambient. Below the detection floor the caller still
 * gets a wide (90°) value for energy-row widening.
 */
export function bearingTimeSigmaDeg(
  snrLinear: number,
  bandwidthHz: number,
  integrationS: number = BEARING_TIME_PERIOD_S,
): number {
  const bt = Math.max(0, bandwidthHz) * Math.max(0, integrationS);
  const denom = Math.sqrt(2 * Math.max(0, snrLinear) * bt);
  if (!(denom > 0)) return 90;
  const deg = (1 / denom) * (180 / Math.PI);
  return Math.max(BEARING_TIME_SIGMA_FLOOR_DEG, deg);
}

export function isBearingTimeDetectable(snrLinear: number): boolean {
  return snrLinear >= BEARING_TIME_DETECT_SNR;
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
  for (let i = 0; i < n; i++) if (power[i]! > 0 && freq[i]! > 0) out.push({hz: freq[i]!, power: freq[i]! > 0 ? power[i]! : 0});
  return out.filter(l => l.power > 0 && l.hz > 0);
}

type ContactTones = {c: ContactPose; lines: {hz: number; power: number}[]; sl: number; abs: boolean};

function contactTones(contacts: ContactPose[]): ContactTones[] {
  const out: ContactTones[] = [];
  for (const c of contacts) {
    if (c.active === false) continue;
    out.push({c, lines: tonalList(c), sl: sourceLevel(c.params, c.speed, c.depth), abs: c.params.tonalRefDb !== undefined});
  }
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

function isDifarFeeding(b: Buoy, t: number): boolean {
  return inferBuoyType(b) === 'difar' && isFeeding(b, t);
}

function biasedTrueRad(geomRad: number, biasDeg: number): number {
  return geomRad + biasDeg * Math.PI / 180;
}

/** atan2 of omni-correlated dipole accumulators (east = sin, north = cos). */
export function dipoleBearingRad(east: number, north: number): number {
  if (east === 0 && north === 0) return 0;
  return Math.atan2(east, north);
}

function noisyOrUniform(trueRad: number, valid: boolean, sigmaDeg: number, rngSeed: number): number {
  const rng = mulberry32(rngSeed >>> 0);
  if (!valid) return rng() * 360;
  return wrapDeg(trueRad * 180 / Math.PI + sigmaDeg * gaussian(rng));
}

export type BearingTimeState = {
  buoys: Buoy[];
  contacts: ContactPose[];
  environment: Environment;
  seed: number;
  atSimTime: number;
  band?: [number, number];
  dfHz?: number;
  integrationS?: number;
  tracks?: BearingTrackSpec[];
};

function bandOf(state: BearingTimeState): [number, number] {
  const b = state.band;
  if (b && Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[1] > b[0]) return [b[0], b[1]];
  return [BEARING_ENERGY_F_LO, BEARING_ENERGY_F_HI];
}

type Accum = {east: number; north: number; snr: number; freqHz: number};

function accumulate(
  b: Buoy, tones: ContactTones[], env: Environment, biasDeg: number,
  dfHz: number, pred: (f: number, hz0: number) => boolean,
): Accum {
  const g = createGeometry();
  let east = 0, north = 0, snrSum = 0, freqUsed = 0, best = 0;
  for (const {c, lines, sl, abs} of tones) {
    geometry(c, b, g);
    if (!(g.range > 1e-6)) continue;
    const brg = biasedTrueRad(g.bearing, biasDeg);
    const sinB = Math.sin(brg), cosB = Math.cos(brg);
    for (const line of lines) {
      const f = doppler(line.hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
      if (!pred(f, line.hz)) continue;
      const snr = receivedSnr(line.power, f, g.range, env, dfHz, abs, sl);
      const w = Math.max(0, snr);
      east += w * sinB;
      north += w * cosB;
      snrSum += w;
      if (snr > best) { best = snr; freqUsed = f; }
    }
  }
  return {east, north, snr: snrSum, freqHz: freqUsed};
}

function entryFor(
  t: number, buoyId: number, trueRad: number, snrLinear: number, bandwidthHz: number,
  integrationS: number, rngKey: number, extra: {freqHz?: number; band?: [number, number]},
): BearingTimeEntry {
  const valid = isBearingTimeDetectable(snrLinear);
  const sigmaDeg = valid
    ? bearingTimeSigmaDeg(snrLinear, bandwidthHz, integrationS)
    : 90;
  const bearingDeg = noisyOrUniform(trueRad, valid, sigmaDeg, rngKey);
  return {
    t, buoyId, ...extra, bearingDeg, sigmaDeg,
    snrDb: powerToDb(Math.max(1e-30, snrLinear)),
    valid,
  };
}

/** Time entries for every feeding DIFAR buoy at `atSimTime`. */
export function bearingTimeFromState(state: BearingTimeState): BearingTimeEntry[] {
  const t = state.atSimTime;
  const env = state.environment;
  const dfHz = state.dfHz ?? BEARING_ENERGY_DF_HZ;
  const integ = state.integrationS ?? BEARING_TIME_PERIOD_S;
  const band = bandOf(state);
  const out: BearingTimeEntry[] = [];
  const g = createGeometry();
  const tones = contactTones(state.contacts);
  for (let bi = 0; bi < state.buoys.length; bi++) {
    const b = state.buoys[bi]!;
    if (!isDifarFeeding(b, t)) continue;
    const buoyId = numericBuoyId(b.id, bi);
    const bias = compassBiasDeg(state.seed, buoyId);

    for (const {c, lines, sl, abs} of tones) {
      geometry(c, b, g);
      if (!(g.range > 1e-6)) continue;
      const brg = biasedTrueRad(g.bearing, bias);
      for (const line of lines) {
        const f = doppler(line.hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
        const snr = receivedSnr(line.power, f, g.range, env, dfHz, abs, sl);
        const rng = mixSeedTime(mixSeedTime(state.seed, `bearing-time:${buoyId}:line:${c.id}`, t), 'f', f);
        out.push(entryFor(t, buoyId, brg, snr, dfHz, integ, rng, {freqHz: f}));
      }
    }

    const tracks = state.tracks ?? [];
    for (const tr of tracks) {
      if (tr.buoyId !== buoyId) continue;
      if (out.some(e => e.freqHz !== undefined && Math.abs(e.freqHz - tr.freqHz) <= dfHz / 2)) continue;
      const acc = accumulate(b, tones, env, bias, dfHz, (f, hz0) =>
        Math.abs(f - tr.freqHz) <= dfHz / 2 || Math.abs(hz0 - tr.freqHz) <= dfHz / 2);
      const rng = mixSeedTime(mixSeedTime(state.seed, `bearing-time:${buoyId}:track`, t), 'f', tr.freqHz);
      out.push(entryFor(t, buoyId, dipoleBearingRad(acc.east, acc.north), acc.snr, dfHz, integ, rng, {freqHz: tr.freqHz}));
    }

    const acc = accumulate(b, tones, env, bias, dfHz, (f, hz0) =>
      (f >= band[0] && f <= band[1]) || (hz0 >= band[0] && hz0 <= band[1]));
    const bw = band[1] - band[0];
    const rng = mixSeedTime(mixSeedTime(mixSeedTime(state.seed, `bearing-time:${buoyId}:band`, t), 'lo', band[0]), 'hi', band[1]);
    out.push(entryFor(t, buoyId, dipoleBearingRad(acc.east, acc.north), acc.snr, bw, integ, rng, {band: [band[0], band[1]]}));
  }
  return out;
}

/** Add `weight` as a wrapped unit-mass Gaussian of width `sigmaDeg` centred at `meanDeg`. */
export function addWrappedGaussian(out: Float64Array, meanDeg: number, sigmaDeg: number, weight: number): void {
  if (!(weight > 0) || out.length === 0) return;
  const n = out.length;
  const mean = wrapDeg(meanDeg);
  if (!(sigmaDeg > 0) || sigmaDeg >= 90) {
    const v = weight / n;
    for (let i = 0; i < n; i++) out[i] += v;
    return;
  }
  const span = Math.min(n / 2, 6 * sigmaDeg);
  const inv2s2 = 1 / (2 * sigmaDeg * sigmaDeg);
  const i0 = Math.floor(mean - span);
  const i1 = Math.ceil(mean + span);
  let sum = 0;
  const idx: number[] = [];
  const val: number[] = [];
  for (let i = i0; i <= i1; i++) {
    const d = i - mean;
    const v = Math.exp(-d * d * inv2s2);
    let bin = i % n; if (bin < 0) bin += n;
    idx.push(bin);
    val.push(v);
    sum += v;
  }
  if (!(sum > 0)) return;
  const k = weight / sum;
  for (let j = 0; j < idx.length; j++) out[idx[j]!] += val[j]! * k;
}

/** Half-up rounding to 0…255 (matches Swift `floor(x+0.5)`, not banker's rounding). */
export function quantizeU8(x: number): number {
  if (!(x > 0)) return 0;
  return Math.max(0, Math.min(255, Math.floor(x + 0.5)));
}

export function quantizeEnergyRow(acc: Float64Array): Uint8Array {
  const out = new Uint8Array(acc.length);
  let peak = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i]! > peak) peak = acc[i]!;
  if (!(peak > 0)) return out;
  const s = 255 / peak;
  for (let i = 0; i < acc.length; i++) out[i] = quantizeU8(acc[i]! * s);
  return out;
}

/** One 360-bin energy row for a DIFAR buoy. Null for omni/BT/unknown/not feeding. */
export function bearingEnergyFromState(state: BearingTimeState, buoyId: number): BearingEnergyRow | null {
  const t = state.atSimTime;
  const env = state.environment;
  const dfHz = state.dfHz ?? BEARING_ENERGY_DF_HZ;
  const integ = state.integrationS ?? BEARING_TIME_PERIOD_S;
  const band = bandOf(state);
  const fLo = band[0], fHi = band[1];
  let bu: Buoy | undefined, bi = -1;
  for (let i = 0; i < state.buoys.length; i++) {
    const id = numericBuoyId(state.buoys[i]!.id, i);
    if (id === buoyId) { bu = state.buoys[i]; bi = i; break; }
  }
  if (!bu || bi < 0 || !isDifarFeeding(bu, t)) return null;
  const bias = compassBiasDeg(state.seed, buoyId);
  const nBins = Math.max(1, Math.floor((fHi - fLo) / dfHz + 1e-9) + 1);
  const east = new Float64Array(nBins);
  const north = new Float64Array(nBins);
  const snr = new Float64Array(nBins);
  const g = createGeometry();
  const tones = contactTones(state.contacts);
  for (const {c, lines, sl, abs} of tones) {
    geometry(c, bu, g);
    if (!(g.range > 1e-6)) continue;
    const brg = biasedTrueRad(g.bearing, bias);
    const sinB = Math.sin(brg), cosB = Math.cos(brg);
    for (const line of lines) {
      const f = doppler(line.hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
      if (f < fLo - dfHz / 2 || f > fHi + dfHz / 2) continue;
      let k = Math.round((f - fLo) / dfHz);
      if (k < 0) k = 0;
      if (k >= nBins) k = nBins - 1;
      const s = receivedSnr(line.power, f, g.range, env, dfHz, abs, sl);
      const w = Math.max(0, s);
      east[k] += w * sinB;
      north[k] += w * cosB;
      snr[k] += w;
    }
  }
  const acc = new Float64Array(BEARING_ENERGY_BINS);
  for (let k = 0; k < nBins; k++) {
    const s = snr[k]!;
    if (!(s > 0)) continue;
    const brgDeg = wrapDeg(dipoleBearingRad(east[k]!, north[k]!) * 180 / Math.PI);
    const sig = bearingTimeSigmaDeg(s, dfHz, integ);
    addWrappedGaussian(acc, brgDeg, sig, s);
  }
  return {t, buoyId, fLo, fHi, energy: quantizeEnergyRow(acc)};
}

export function bearingEnergyRawBytes(buoyCount: number, durationS: number, periodS = BEARING_TIME_PERIOD_S): number {
  const n = energyRowCount(durationS, periodS);
  return Math.max(0, buoyCount) * n * BEARING_ENERGY_BINS;
}

export function energyRowCount(durationS: number, periodS = BEARING_TIME_PERIOD_S): number {
  if (!(durationS >= 0) || !(periodS > 0)) return 0;
  return Math.floor(durationS / periodS + 1e-9) + 1;
}

export function energyRowTimes(t0: number, t1: number, periodS = BEARING_TIME_PERIOD_S): number[] {
  const n = energyRowCount(t1 - t0, periodS);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(t0 + k * periodS);
  return out;
}

export class BearingEnergyBook {
  readonly periodS: number;
  readonly capacity: number;
  private readonly byBuoy = new Map<number, BearingEnergyRow[]>();
  private readonly entries: BearingTimeEntry[] = [];
  private readonly entryIndex = new Map<string, number>();
  constructor(periodS = BEARING_TIME_PERIOD_S, capacity = BEARING_ENERGY_CAPACITY) {
    this.periodS = periodS;
    this.capacity = capacity;
  }
  recordEnergy(row: BearingEnergyRow): void {
    let q = this.byBuoy.get(row.buoyId);
    if (!q) { q = []; this.byBuoy.set(row.buoyId, q); }
    for (let i = q.length - 1; i >= 0; i--) {
      if (Math.abs(q[i]!.t - row.t) <= 1e-9) { q[i] = row; return; }
      if (q[i]!.t < row.t - 1e-9) {
        q.splice(i + 1, 0, row);
        while (q.length > this.capacity) q.shift();
        return;
      }
    }
    q.unshift(row);
    while (q.length > this.capacity) q.shift();
  }
  private entryKey(e: BearingTimeEntry): string {
    const kind = e.band ? `b:${e.band[0]}:${e.band[1]}` : `f:${e.freqHz}`;
    return `${e.t.toFixed(3)}:${e.buoyId}:${kind}`;
  }
  recordEntries(list: BearingTimeEntry[]): void {
    for (const e of list) {
      const k = this.entryKey(e);
      const at = this.entryIndex.get(k);
      if (at !== undefined) { this.entries[at] = e; continue; }
      this.entryIndex.set(k, this.entries.length);
      this.entries.push(e);
    }
    const maxEntries = this.capacity * 8;
    if (this.entries.length > maxEntries) {
      const drop = this.entries.length - maxEntries;
      this.entries.splice(0, drop);
      this.entryIndex.clear();
      for (let j = 0; j < this.entries.length; j++) this.entryIndex.set(this.entryKey(this.entries[j]!), j);
    }
  }
  energy(buoyId: number, t0?: number, t1?: number): BearingEnergyRow[] {
    const q = this.byBuoy.get(buoyId) ?? [];
    return q.filter(r => (t0 === undefined || r.t >= t0 - 1e-9) && (t1 === undefined || r.t <= t1 + 1e-9))
      .map(r => ({...r, energy: r.energy.slice()}));
  }
  energyAt(buoyId: number, t: number): BearingEnergyRow | undefined {
    const q = this.byBuoy.get(buoyId) ?? [];
    const r = q.find(x => Math.abs(x.t - t) <= 1e-9);
    return r ? {...r, energy: r.energy.slice()} : undefined;
  }
  timeEntries(t0?: number, t1?: number, buoyId?: number): BearingTimeEntry[] {
    return this.entries.filter(e =>
      (buoyId === undefined || e.buoyId === buoyId)
      && (t0 === undefined || e.t >= t0 - 1e-9)
      && (t1 === undefined || e.t <= t1 + 1e-9));
  }
  clear(): void { this.byBuoy.clear(); this.entries.length = 0; this.entryIndex.clear(); }
}
