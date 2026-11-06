/**
 * Doppler ruler (m3-fe-doppler): the operator places f0 on a tonal at CPA, drags f1 onto the approach leg (higher
 * frequency, earlier), and f2 mirrors on the receding leg (same Δf below, same Δt after). One continuous S-curve is
 * drawn through f1–f0–f2 so it can be laid over the trace. Pure maths, no DOM, no per-call allocation in the hot paths.
 *
 * Model (Urick, Principles of Underwater Sound, moving-source Doppler; first order in v/c): a fixed receiver, a source
 * on a straight line at constant speed v, closest approach range R at time tCPA:
 *
 *   f(t) = f0 · (1 + (v/c) · cosθ(t)),   cosθ(t) = −u / √(1 + u²),   u = (t − tCPA) / τ,   τ = R / v
 *
 * i.e. a tanh-like curve, antisymmetric about (tCPA, f0), with asymptotes f0(1 ± v/c) and a steepness at CPA of
 * f0·v/(c·τ) = f0·v²/(c·R). c = 1500 m/s (nominal sea water).
 *
 * Handle convention: f1 and f2 are point-mirrors about the CPA centre (f0, tCPA). Either handle drags freely in both
 * axes (X = signed Δf from f0, Y = signed Δt from tCPA); the other follows. |Δf| and |Δt| set the pass:
 *   v = c·|Δf| / (KNEE · f0),   R = v·|Δt| · √(1 − KNEE²) / KNEE
 * (KNEE = 95 % of the asymptotic shift). Moving a handle out in frequency raises the speed; out in time softens the
 * curve (longer range). Seeding still places f1 on the approach side (Δf > 0, Δt < 0).
 */
import { C } from '@acoustics'

export const C_MPS = C
export const KNEE = 0.95
const KNEE_R = Math.sqrt(1 - KNEE * KNEE) / KNEE
export const MPS_TO_KT = 1.943844
/** Clamp on the implied speed (m/s, ~58 kt) so a stray drag can't produce nonsense. */
export const MAX_SPEED_MPS = 30
/** Smallest handle time offset (s). */
export const MIN_DT_S = 2

export interface RulerState {
  /** f0 handle: CPA point (Hz, sim seconds). */
  f0Hz: number; tCpaS: number
  /** f1 handle: free 2-axis offset from (f0, tCPA); seeded on the approach side. */
  f1Hz: number; t1S: number
  /** f2 handle: point-mirror of f1 about (f0, tCPA) while linked. */
  f2Hz: number; t2S: number
  linked: boolean
}
export interface HalfGeom { speedMps: number; rCpaM: number; tauS: number }
export interface PassGeom extends HalfGeom { f0: number; tCpaS: number; dfAsymHz: number }

export function emptyRuler(): RulerState { return { f0Hz: 0, tCpaS: 0, f1Hz: 0, t1S: 0, f2Hz: 0, t2S: 0, linked: true } }

/** f2 = mirror of f1 about f0 (same Δf below, same Δt after). Mutates and returns s. */
export function mirror(s: RulerState): RulerState {
  s.f2Hz = 2 * s.f0Hz - s.f1Hz; s.t2S = 2 * s.tCpaS - s.t1S
  return s
}

/** Speed, range and τ from one half: Δf (Hz, > 0) and Δt (s, > 0) of its handle from f0. */
export function halfGeom(f0: number, dfHz: number, dtS: number, c = C_MPS, out: HalfGeom = { speedMps: 0, rCpaM: 0, tauS: 0 }): HalfGeom {
  const v = f0 > 0 ? (c * Math.abs(dfHz)) / (KNEE * f0) : 0
  const dt = Math.abs(dtS)
  out.speedMps = v; out.tauS = dt * KNEE_R; out.rCpaM = v * out.tauS
  return out
}

/** Δf (Hz) for a given speed on f0 at the knee: the inverse of halfGeom's speed. */
export const kneeDfHz = (f0: number, speedMps: number, c = C_MPS): number => (f0 * KNEE * speedMps) / c

/** Received frequency on a straight constant-speed pass (first order in v/c). */
export function passHz(f0: number, tCpaS: number, speedMps: number, tauS: number, tS: number, c = C_MPS): number {
  const u = (tS - tCpaS) / Math.max(1e-6, tauS)
  return f0 * (1 - (speedMps / c) * (u / Math.sqrt(1 + u * u)))
}

/**
 * Ruler curve at time t. Linked: one pass through f1–f0–f2. Unlinked: the approach half follows f1 and the receding
 * half follows f2 (both pass through f0 at tCPA, so the curve stays continuous).
 */
export function rulerHz(s: RulerState, tS: number, c = C_MPS): number {
  const before = tS <= s.tCpaS
  const df = before || s.linked ? s.f1Hz - s.f0Hz : s.f0Hz - s.f2Hz
  const dt = before || s.linked ? s.tCpaS - s.t1S : s.t2S - s.tCpaS
  const v = s.f0Hz > 0 ? (c * Math.abs(df)) / (KNEE * s.f0Hz) : 0
  return passHz(s.f0Hz, s.tCpaS, v, Math.abs(dt) * KNEE_R, tS, c)
}

/** Fill tOut/fOut (same length n ≥ 2) with the curve sampled evenly over [t0, t1]. Allocation-free. */
export function sampleRuler(s: RulerState, t0: number, t1: number, tOut: Float64Array, fOut: Float64Array, c = C_MPS): number {
  const n = Math.min(tOut.length, fOut.length)
  for (let k = 0; k < n; k++) { const t = t0 + ((t1 - t0) * k) / (n - 1); tOut[k] = t; fOut[k] = rulerHz(s, t, c) }
  return n
}

/** Pass geometry read off the handles. Unlinked: the mean of the two halves. Writes into out (no allocation). */
export function rulerGeom(s: RulerState, c = C_MPS, out: PassGeom = { f0: 0, tCpaS: 0, speedMps: 0, rCpaM: 0, tauS: 0, dfAsymHz: 0 }): PassGeom {
  const a = halfGeom(s.f0Hz, s.f1Hz - s.f0Hz, s.tCpaS - s.t1S, c)
  let v = a.speedMps, tau = a.tauS
  if (!s.linked) { const b = halfGeom(s.f0Hz, s.f0Hz - s.f2Hz, s.t2S - s.tCpaS, c); v = (v + b.speedMps) / 2; tau = (tau + b.tauS) / 2 }
  out.f0 = s.f0Hz; out.tCpaS = s.tCpaS; out.speedMps = v; out.tauS = tau; out.rCpaM = v * tau; out.dfAsymHz = (s.f0Hz * v) / c
  return out
}

/** Place f0 at (hz, t) and seed f1 at (hz + dfHz, t − dtS); f2 mirrors. Mutates s. */
export function placeRuler(s: RulerState, hz: number, tS: number, dfHz: number, dtS: number): RulerState {
  s.f0Hz = hz; s.tCpaS = tS; s.f1Hz = hz + Math.abs(dfHz); s.t1S = tS - Math.max(MIN_DT_S, Math.abs(dtS)); s.linked = true
  return mirror(s)
}

/** Move f0 and carry the other handles with it (keeps the offsets). */
export function moveF0(s: RulerState, hz: number, tS: number): RulerState {
  const df = hz - s.f0Hz, dt = tS - s.tCpaS
  s.f0Hz = hz; s.tCpaS = tS; s.f1Hz += df; s.t1S += dt; s.f2Hz += df; s.t2S += dt
  return s
}

/**
 * Clamp a signed offset from the CPA centre: |Δf| ∈ [minDf, maxDf(MAX_SPEED)], |Δt| ≥ MIN_DT_S.
 * Preserves the sign of each axis so a handle can sit on either side of (f0, tCPA).
 */
export function clampOff(f0: number, df: number, dt: number, minDf: number, c: number = C_MPS): [number, number] {
  const maxDf = kneeDfHz(f0, MAX_SPEED_MPS, c)
  const adf = Math.min(maxDf, Math.max(Math.min(minDf, maxDf), Math.abs(df)))
  const adt = Math.max(MIN_DT_S, Math.abs(dt))
  const sf = df < 0 ? -1 : 1 // df === 0 keeps the approach-side default (+)
  const st = dt < 0 ? -1 : 1 // dt === 0 keeps the "after CPA" default (+)
  return [sf * adf, st * adt]
}

/** Drag f1 to (hz, t) in both axes; f2 point-mirrors about (f0, tCPA) while linked. */
export function dragF1(s: RulerState, hz: number, tS: number, minDfHz = 1e-4, c = C_MPS): RulerState {
  const [df, dt] = clampOff(s.f0Hz, hz - s.f0Hz, tS - s.tCpaS, minDfHz, c)
  s.f1Hz = s.f0Hz + df; s.t1S = s.tCpaS + dt
  return s.linked ? mirror(s) : s
}

/** Drag f2 to (hz, t) in both axes; f1 point-mirrors about (f0, tCPA). Keeps the handles linked. */
export function dragF2(s: RulerState, hz: number, tS: number, minDfHz = 1e-4, c = C_MPS): RulerState {
  const [df, dt] = clampOff(s.f0Hz, hz - s.f0Hz, tS - s.tCpaS, minDfHz, c)
  s.f2Hz = s.f0Hz + df; s.t2S = s.tCpaS + dt
  // Point-mirror through the centre onto f1 (and stay linked).
  s.f1Hz = 2 * s.f0Hz - s.f2Hz; s.t1S = 2 * s.tCpaS - s.t2S; s.linked = true
  return s
}

export const relink = (s: RulerState): RulerState => { s.linked = true; return mirror(s) }

const clock = (t: number) => { const x = Math.abs(t); return `${t < 0 ? '-' : '+'}${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')}` }
/** Digits for Hz at this bin width. */
const hzDigits = (fBin: number) => (fBin < 0.05 ? 3 : fBin < 0.5 ? 2 : 1)

/** Ruler readout: f0, Δf (asymptotic ±), speed, CPA time, range; `fit` when the acoustics fit agrees. */
export function rulerText(placed: boolean, g: PassGeom, linked: boolean, fBin: number, fit?: { speedMps: number; rCpaM: number; tCpaS: number } | null): string {
  if (!placed) return 'DOP  TAP A LINE AT CPA TO PLACE F0'
  const d = hzDigits(fBin)
  let t = `DOP F0 ${g.f0.toFixed(d)} HZ  ΔF ±${g.dfAsymHz.toFixed(d + 1)} HZ  ${(g.speedMps * MPS_TO_KT).toFixed(1)} KT  CPA T${clock(g.tCpaS)}  R≈${(g.rCpaM / 1000).toFixed(2)} KM`
  if (!linked) t += '  F2 UNLINKED'
  if (fit) t += `  FIT ${(fit.speedMps * MPS_TO_KT).toFixed(1)} KT ${(fit.rCpaM / 1000).toFixed(2)} KM`
  return t
}

export interface FitResult { ok: boolean; speedMps: number; rCpaM: number; tCpaS: number; f0: number }
export type DopplerFitter = (samples: { tS: number; fHz: number }[]) => { ok: boolean; f0: number; speed: number; tCPA: number; rCPA: number }
export const FIT_SAMPLES = 25

/**
 * Cross-check the drawn curve with the acoustics CPA fit (fitCpaFromDoppler, exact Urick form): sample the ruler over
 * tCPA ± 4τ and fit one straight pass. Used for the unlinked readout (one best pass through both halves). Not per frame.
 */
export function fitRuler(s: RulerState, fitter: DopplerFitter | null, c = C_MPS): FitResult | null {
  if (!fitter || !(s.f0Hz > 0)) return null
  const span = 4 * Math.max(s.tCpaS - s.t1S, s.linked ? 0 : s.t2S - s.tCpaS, MIN_DT_S) * KNEE_R
  const smp: { tS: number; fHz: number }[] = []
  for (let k = 0; k < FIT_SAMPLES; k++) { const t = s.tCpaS - span + (2 * span * k) / (FIT_SAMPLES - 1); smp.push({ tS: t, fHz: rulerHz(s, t, c) }) }
  try {
    const r = fitter(smp)
    return { ok: r.ok, speedMps: r.speed, rCpaM: r.rCPA, tCpaS: r.tCPA, f0: r.f0 }
  } catch { return null }
}

/** Mutable ruler shared by the overlay (drawn every frame from it) and the readout. */
export type Handle = 'f0' | 'f1' | 'f2'
export class RulerStore {
  readonly s = emptyRuler()
  placed = false
  sel: Handle | null = null
  /** Bumped on every change (drag moves too); `committed` only on place / drag end / clear / relink. */
  version = 0
  committed = 0
  readonly geom: PassGeom = { f0: 0, tCpaS: 0, speedMps: 0, rCpaM: 0, tauS: 0, dfAsymHz: 0 }
  fit: FitResult | null = null
  /** Layout metrics the overlay keeps current (for placement defaults and key nudges). */
  m = { heightPx: 300, historyS: 300, hzPerPx: 1, fBin: 1 }
  private ls = new Set<() => void>()
  constructor(private fitter: DopplerFitter | null = null) {}
  subscribe = (f: () => void) => { this.ls.add(f); return () => { this.ls.delete(f) } }
  getVersion = () => this.version
  getCommitted = () => this.committed
  changed(commit = false) {
    rulerGeom(this.s, C_MPS, this.geom)
    this.version++
    if (commit) { this.committed++; this.fit = this.s.linked ? null : fitRuler(this.s, this.fitter) }
    for (const f of this.ls) f()
  }
  /** Tap on the gram: place f0 there (first time, with f1 seeded at ~10 kt) or move the whole ruler. */
  tap(hz: number, tS: number) {
    if (this.placed) moveF0(this.s, hz, tS)
    else {
      // Seed f1 ~60 px below f0 (handles never stack), but within 30 % of a short phone gram so f1 / f2 stay on screen.
      const h = Math.max(1, this.m.heightPx), dt = Math.max(0.12 * this.m.historyS, (Math.min(60, 0.3 * h) / h) * this.m.historyS)
      placeRuler(this.s, hz, tS, kneeDfHz(hz, 10 / MPS_TO_KT), dt)
      this.placed = true; this.sel = 'f1'
    }
    this.changed(true)
  }
  clear() { this.placed = false; this.sel = null; this.s.linked = true; this.fit = null; this.changed(true) }
  select(h: Handle | null) { if (this.sel !== h) { this.sel = h; this.changed() } }
  drag(h: Handle, hz: number, tS: number) {
    const minDf = Math.max(1e-4, this.m.fBin * 0.01)
    if (h === 'f0') moveF0(this.s, hz, tS)
    else if (h === 'f1') dragF1(this.s, hz, tS, minDf)
    else dragF2(this.s, hz, tS, minDf)
    this.changed()
  }
  relink() { relink(this.s); this.changed(true) }
  /** Arrow-key nudge of the selected handle: dx in px of frequency, dt in seconds (+ = later). */
  nudge(dxPx: number, dtS: number) {
    if (!this.placed) return false
    const h = this.sel ?? 'f1'; this.sel = h
    const x = h === 'f0' ? this.s.f0Hz : h === 'f1' ? this.s.f1Hz : this.s.f2Hz
    const t = h === 'f0' ? this.s.tCpaS : h === 'f1' ? this.s.t1S : this.s.t2S
    this.drag(h, x + dxPx * this.m.hzPerPx, t + dtS)
    this.changed(true)
    return true
  }
}
