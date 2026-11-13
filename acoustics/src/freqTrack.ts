/**
 * Frequency tracker for Dorian's freq-track seam. Built on the BFI/DIFAR
 * band path: a gate follows the strongest peak inside it, bearings reuse the
 * public DIFAR noise model, and state coasts ~5 s below the SNR floor then
 * goes lost until the line returns. Fictional contacts, public physics only.
 * Deterministic in (seed, trackId, t). Tracks persist until stopFreqTrack.
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

export type FreqTrackState = 'tracking' | 'coasting' | 'lost';

export type FreqTrackBearing = {
  trackId: number;
  buoyId: number;
  freqHz: number;
  brgDeg: number;
  sigmaDeg: number;
  snrDb: number;
  /** Same definition as autoBearings: SNR in dB over ambient. */
  quality: number;
  /** True only while `state` is `'tracking'`. */
  locked: boolean;
  state: FreqTrackState;
};

export type FreqTrackSpec = {
  trackId: number;
  buoyId: number;
  /** Gate centre at start (Hz). */
  freqHz: number;
  gateHz: number;
  startedAt: number;
};

export const FREQ_TRACK_DEFAULT_GATE_HZ = 10;
export const FREQ_TRACK_COAST_S = 5;
export const FREQ_TRACK_TICK_S = 1;

export type FreqTrackContactsAt = (t: number) => ContactPose[];

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

function inGate(f: number, restHz: number, center: number, half: number): boolean {
  if (Math.abs(f - center) <= half + 1e-9) return true;
  if (Math.abs(restHz - center) <= half + 1e-9) return true;
  return false;
}

/** Strongest DIFAR peak inside the gate at `atSimTime`. */
export function observePeakInGate(args: {
  buoy: Buoy;
  buoyIndex: number;
  contacts: ContactPose[];
  environment: Environment;
  seed: number;
  trackId: number;
  atSimTime: number;
  centerHz: number;
  gateHz: number;
  dfHz?: number;
}): {freqHz: number; brgDeg: number; sigmaDeg: number; snrLinear: number; snrDb: number} | undefined {
  if (args.buoy.type !== 'difar') throw new Error('Frequency track is DIFAR only');
  if (!isFeeding(args.buoy, args.atSimTime)) return undefined;
  const dfHz = args.dfHz ?? 1;
  const env = args.environment;
  const half = Math.max(0.5, args.gateHz / 2);
  const g = createGeometry();
  const buoyId = numericBuoyId(args.buoy.id, args.buoyIndex);
  let best: {freqHz: number; snr: number; bearing: number} | undefined;
  for (const c of args.contacts) {
    if (c.active === false) continue;
    geometry(c, args.buoy, g);
    if (!(g.range > 1e-6)) continue;
    const sl = sourceLevel(c.params, c.speed, c.depth);
    const abs = c.params.tonalRefDb !== undefined;
    for (const line of tonalList(c)) {
      const f = doppler(line.hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
      if (!inGate(f, line.hz, args.centerHz, half)) continue;
      const snr = receivedSnr(line.power, f, g.range, env, dfHz, abs, sl);
      if (!best || snr > best.snr) best = {freqHz: f, snr, bearing: g.bearing};
    }
  }
  if (!best) return undefined;
  const rngSeed = mixSeedTime(mixSeedTime(args.seed, `freqtrack:${args.trackId}:${buoyId}`, args.atSimTime), 'f', best.freqHz);
  const nb = noisyBearing(best.bearing, best.snr, rngSeed);
  const snrDb = powerToDb(Math.max(1e-30, best.snr));
  return {freqHz: best.freqHz, brgDeg: nb.brgDeg, sigmaDeg: nb.sigmaDeg, snrLinear: best.snr, snrDb};
}

type Live = {
  centerHz: number;
  state: FreqTrackState;
  coastS: number;
  freqHz: number;
  brgDeg: number;
  sigmaDeg: number;
  snrDb: number;
};

function applyObs(live: Live, obs: {freqHz: number; brgDeg: number; sigmaDeg: number; snrLinear: number; snrDb: number} | undefined, dt: number): void {
  const above = !!(obs && obs.snrLinear >= BEARING_SNR_FLOOR);
  if (above && obs) {
    live.state = 'tracking';
    live.coastS = 0;
    live.centerHz = obs.freqHz;
    live.freqHz = obs.freqHz;
    live.brgDeg = obs.brgDeg;
    live.sigmaDeg = obs.sigmaDeg;
    live.snrDb = obs.snrDb;
    return;
  }
  if (obs) {
    live.snrDb = obs.snrDb;
    live.sigmaDeg = obs.sigmaDeg;
  } else {
    live.snrDb = powerToDb(1e-30);
    live.sigmaDeg = 90;
  }
  if (live.state === 'lost') return;
  // The sample at which the line drops starts the coast clock at zero.
  if (live.state === 'tracking') {
    live.state = 'coasting';
    live.coastS = 0;
    return;
  }
  live.coastS += dt;
  if (live.coastS >= FREQ_TRACK_COAST_S - 1e-12) live.state = 'lost';
  else live.state = 'coasting';
}

function findBuoy(buoys: Buoy[], buoyId: number): {buoy: Buoy; index: number} {
  const i = buoys.findIndex((b, idx) => numericBuoyId(b.id, idx) === buoyId);
  if (i < 0) throw new Error('Unknown buoyId');
  return {buoy: buoys[i]!, index: i};
}

function reportOf(spec: FreqTrackSpec, live: Live): FreqTrackBearing {
  const locked = live.state === 'tracking';
  return {
    trackId: spec.trackId,
    buoyId: spec.buoyId,
    freqHz: live.freqHz,
    brgDeg: live.brgDeg,
    sigmaDeg: live.sigmaDeg,
    snrDb: live.snrDb,
    quality: live.snrDb,
    locked,
    state: live.state,
  };
}

/**
 * Evaluate persisted tracks at `atSimTime` by stepping the gate from each
 * track's start time (tick = 1 s). Pure in the contact poses given at each t.
 */
export function freqTrackBearingsFromState(args: {
  tracks: readonly FreqTrackSpec[];
  buoys: Buoy[];
  contacts?: ContactPose[];
  contactsAt?: FreqTrackContactsAt;
  environment: Environment;
  seed: number;
  atSimTime: number;
  dfHz?: number;
}): FreqTrackBearing[] {
  const contactsAt = args.contactsAt ?? ((_t: number) => args.contacts ?? []);
  const out: FreqTrackBearing[] = [];
  const tracks = args.tracks.slice().sort((a, b) => a.trackId - b.trackId);
  for (const spec of tracks) {
    if (args.atSimTime + 1e-12 < spec.startedAt) continue;
    const {buoy, index} = findBuoy(args.buoys, spec.buoyId);
    const observe = (t: number, centerHz: number) => observePeakInGate({
      buoy, buoyIndex: index, contacts: contactsAt(t), environment: args.environment,
      seed: args.seed, trackId: spec.trackId, atSimTime: t, centerHz, gateHz: spec.gateHz, dfHz: args.dfHz,
    });
    const live: Live = {
      centerHz: spec.freqHz,
      state: 'coasting',
      coastS: 0,
      freqHz: spec.freqHz,
      brgDeg: 0,
      sigmaDeg: 90,
      snrDb: powerToDb(1e-30),
    };
    // First look at startedAt with dt = 0 so a lock is immediate and a miss
    // begins coasting without eating into the 5 s budget.
    applyObs(live, observe(spec.startedAt, live.centerHz), 0);
    let t = spec.startedAt;
    while (t < args.atSimTime - 1e-12) {
      const next = Math.min(t + FREQ_TRACK_TICK_S, args.atSimTime);
      const dt = next - t;
      t = next;
      applyObs(live, observe(t, live.centerHz), dt);
    }
    out.push(reportOf(spec, live));
  }
  return out;
}

function normalizeGate(gateHz?: number): number {
  if (gateHz === undefined || !Number.isFinite(gateHz) || !(gateHz > 0)) return FREQ_TRACK_DEFAULT_GATE_HZ;
  return gateHz;
}

/** Started-track book. `start` / `stop` mutate the set; bearings reconstruct state in t. */
export class FreqTrackBook {
  private nextId = 1;
  private readonly byId = new Map<number, FreqTrackSpec>();

  specs(): FreqTrackSpec[] {
    return [...this.byId.values()].sort((a, b) => a.trackId - b.trackId);
  }

  start(buoyId: number, freqHz: number, gateHz: number | undefined, startedAt: number, buoys: Buoy[]): number {
    const {buoy} = findBuoy(buoys, buoyId);
    if (buoy.type !== 'difar') throw new Error('Frequency track is DIFAR only');
    if (!Number.isFinite(freqHz) || !(freqHz > 0)) throw new Error('Invalid frequency');
    if (!Number.isFinite(startedAt)) throw new Error('Invalid frequency-track time');
    const trackId = this.nextId++;
    this.byId.set(trackId, {trackId, buoyId, freqHz, gateHz: normalizeGate(gateHz), startedAt});
    return trackId;
  }

  stop(trackId: number): void {
    if (!this.byId.delete(trackId)) throw new Error('Unknown trackId');
  }
}
