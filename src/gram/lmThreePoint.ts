/**
 * 3-point Lloyd's mirror cursor (Wilson / Lead):
 *   1. Fringe turning point (hyperbola vertex — CPA of the fringe for an ideal pass)
 *   2. Next closest peak along the fringe
 *   3. Shallower region further from CPA
 * Then a slide adjustment aligns the fitted ideal-pass curve.
 *
 * Assumption (shown in the UI): turning point = CPA only for a straight, constant-speed,
 * constant-depth pass. Fit quality uses operator-visible residual + fringe deviation only —
 * never contact truth. Poor quality → warning instead of range/depth/speed.
 *
 * Prefer acoustics' fitLloydsMirror (read-only via acousticsV11) when available; otherwise a
 * frontend ideal-pass fit marked as FE_IDEAL_PASS.
 */
import { acousticsV11 } from '../scenarios/acousticsApi'
import { C } from '@acoustics'
import { striationHz, type Striation } from './lloyds'

export const LM_ASSUMPTION =
  'Turning point = CPA only for a straight, constant-speed, constant-depth pass.'

export type LmFitSource = 'acoustics' | 'fe_ideal_pass'

export interface LmPoint { tS: number; fHz: number }

export interface LmThreePointState {
  /** 0..3 placed points (p1 turning, p2 peak, p3 shallow). */
  points: LmPoint[]
  /** Slide adjustment: additive ΔK (Hz at CPA) after the geometric fit. */
  slideK: number
  /** Slide adjustment: additive ΔtCPA (s). */
  slideTCpaS: number
}

export interface LmFitResult {
  ok: boolean
  source: LmFitSource
  /** First-null Hz at CPA after slide. */
  k: number
  tCpaS: number
  tauS: number
  /** Operator-visible RMS of (model − point) Hz at the three marks. */
  residualRms: number
  /** Max |model − point| / model at the marks (fringe deviation fraction). */
  fringeDeviation: number
  /** Absolute estimates — only shown when quality is good. */
  zsM: number
  rCpaM: number
  speedMps: number
  depthRatio: number
  warn: boolean
  warning: string | null
}

export const emptyLmThreePoint = (): LmThreePointState => ({ points: [], slideK: 0, slideTCpaS: 0 })

export const LM_RESIDUAL_WARN_HZ = 8
export const LM_FRINGE_DEV_WARN = 0.18

/** Quality gate: poor fit → warn and withhold range/depth/speed. Never uses contact truth. */
export function lmFitWarns(residualRms: number, fringeDeviation: number): boolean {
  if (!Number.isFinite(residualRms) || !Number.isFinite(fringeDeviation)) return true
  return residualRms > LM_RESIDUAL_WARN_HZ || fringeDeviation > LM_FRINGE_DEV_WARN
}

/**
 * Ideal-pass fringe: f(t) = K √(1 + ((t − tCPA)/τ)²).
 * With three marks, take p1 as the turning point (tCPA, K·n for null index n≈1),
 * then solve τ from p2 and refine K from all three under a fixed tCPA.
 */
export function fitIdealPass(points: readonly LmPoint[]): {
  k: number; tCpaS: number; tauS: number; residualRms: number; fringeDeviation: number
} | null {
  if (points.length < 3) return null
  const [p1, p2, p3] = points
  if (!p1 || !p2 || !p3) return null
  if (!(p1.fHz > 0 && p2.fHz > 0 && p3.fHz > 0)) return null
  const tCpaS = p1.tS
  const k = p1.fHz // n = 1 fringe at CPA
  // τ from p2: f2 = K √(1 + ((t2−tCPA)/τ)²) → τ = |t2−tCPA| / √((f2/K)² − 1)
  const r2 = (p2.fHz / k) ** 2
  if (!(r2 > 1.0001)) return null
  let tauS = Math.abs(p2.tS - tCpaS) / Math.sqrt(r2 - 1)
  if (!(tauS > 0.5) || !Number.isFinite(tauS)) return null
  // Optional refine τ with p3 if it is further from CPA.
  const r3 = (p3.fHz / k) ** 2
  if (r3 > 1.0001 && Math.abs(p3.tS - tCpaS) > Math.abs(p2.tS - tCpaS)) {
    const tau3 = Math.abs(p3.tS - tCpaS) / Math.sqrt(r3 - 1)
    if (Number.isFinite(tau3) && tau3 > 0.5) tauS = 0.5 * (tauS + tau3)
  }
  const s: Striation = { k, tCpaS, tauS }
  let err = 0, maxDev = 0
  for (const p of points) {
    const model = striationHz(s, 1, p.tS)
    const d = p.fHz - model
    err += d * d
    const frac = Math.abs(d) / Math.max(1e-6, model)
    if (frac > maxDev) maxDev = frac
  }
  return { k, tCpaS, tauS, residualRms: Math.sqrt(err / points.length), fringeDeviation: maxDev }
}

/** Apply slide knobs onto a geometric fit. */
export function applySlide(
  geo: { k: number; tCpaS: number; tauS: number },
  slideK: number,
  slideTCpaS: number,
): Striation {
  return {
    k: Math.max(0.05, geo.k + slideK),
    tCpaS: geo.tCpaS + slideTCpaS,
    tauS: Math.max(0.5, geo.tauS),
  }
}

/** Spacing samples for acoustics fitLloydsMirror from an ideal-pass striation. */
export function spacingFromStriation(s: Striation, t0: number, t1: number, n = 24): { simT: number; spacingHz: number }[] {
  const out: { simT: number; spacingHz: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1)
    out.push({ simT: t, spacingHz: striationHz(s, 2, t) - striationHz(s, 1, t) })
  }
  return out
}

export function evaluateLmThreePoint(
  st: LmThreePointState,
  opts: { zrM: number | null; rCpaM?: number | null; speedMps?: number | null; c?: number },
): LmFitResult {
  const bad = (source: LmFitSource, warning: string): LmFitResult => ({
    ok: false, source, k: NaN, tCpaS: NaN, tauS: NaN, residualRms: NaN, fringeDeviation: NaN,
    zsM: NaN, rCpaM: NaN, speedMps: NaN, depthRatio: NaN, warn: true, warning,
  })
  if (st.points.length < 3) return bad('fe_ideal_pass', 'Place 3 fringe points (turning · peak · shallow)')
  const geo = fitIdealPass(st.points)
  if (!geo) return bad('fe_ideal_pass', 'Could not fit ideal-pass fringe to the 3 points')
  const s = applySlide(geo, st.slideK, st.slideTCpaS)
  // Recompute residual after slide against the three marks.
  let err = 0, maxDev = 0
  for (const p of st.points) {
    const model = striationHz(s, 1, p.tS)
    const d = p.fHz - model
    err += d * d
    const frac = Math.abs(d) / Math.max(1e-6, model)
    if (frac > maxDev) maxDev = frac
  }
  const residualRms = Math.sqrt(err / st.points.length)
  const fringeDeviation = maxDev
  const warn = lmFitWarns(residualRms, fringeDeviation)

  const zrM = opts.zrM
  const c = opts.c ?? C
  let source: LmFitSource = 'fe_ideal_pass'
  let depthRatio = (2 * s.k * (zrM ?? 40)) / c
  let zsM = NaN
  let rCpaM = opts.rCpaM ?? NaN
  let speedMps = opts.speedMps ?? (Number.isFinite(rCpaM) && s.tauS > 0 ? rCpaM / s.tauS : NaN)

  const fit = acousticsV11.fitLloydsMirror
  if (fit && zrM && zrM > 0) {
    const t0 = Math.min(...st.points.map((p) => p.tS))
    const t1 = Math.max(...st.points.map((p) => p.tS))
    const rangeSource = Number.isFinite(rCpaM) && rCpaM! > 0 && Number.isFinite(speedMps) && speedMps! >= 0
      ? { kind: 'manual' as const, rCPA: rCpaM!, speed: speedMps!, tCPA: s.tCpaS }
      : 'none' as const
    try {
      const r = fit(spacingFromStriation(s, t0, t1), { zrM, rangeSource })
      if (r && Number.isFinite(r.residualRms)) {
        source = 'acoustics'
        depthRatio = r.depthRatio
        if (Number.isFinite(r.zs)) zsM = r.zs
        if (Number.isFinite(r.rCPA)) rCpaM = r.rCPA
        if (Number.isFinite(r.speed)) speedMps = r.speed
      }
    } catch { /* keep FE fit */ }
  } else if (Number.isFinite(rCpaM) && rCpaM! > 0 && depthRatio > 0) {
    zsM = rCpaM! / depthRatio
  }

  if (warn) {
    return {
      ok: true, source, k: s.k, tCpaS: s.tCpaS, tauS: s.tauS, residualRms, fringeDeviation,
      zsM: NaN, rCpaM: NaN, speedMps: NaN, depthRatio: NaN, warn: true,
      warning: `LM FIT POOR  residual ${residualRms.toFixed(1)} Hz · fringe ${(fringeDeviation * 100).toFixed(0)}% — range/depth/speed withheld`,
    }
  }
  return {
    ok: true, source, k: s.k, tCpaS: s.tCpaS, tauS: s.tauS, residualRms, fringeDeviation,
    zsM, rCpaM, speedMps, depthRatio, warn: false, warning: null,
  }
}

/** Readout string for the LM panel (assumption always stated). */
export function lmThreePointText(fit: LmFitResult): string {
  const src = fit.source === 'acoustics' ? 'AC' : 'FE'
  const assump = `ASSUME ${LM_ASSUMPTION}`
  if (fit.warn || !fit.ok) {
    return `LM3 ${src}  ${fit.warning ?? 'FIT WARN'}  ·  ${assump}`
  }
  const zs = Number.isFinite(fit.zsM) ? `ZS ${fit.zsM.toFixed(0)} M` : 'ZS —'
  const r = Number.isFinite(fit.rCpaM) ? `R ${fit.rCpaM.toFixed(0)} M` : ''
  const v = Number.isFinite(fit.speedMps) ? `V ${(fit.speedMps * 1.943844).toFixed(1)} KT` : ''
  const ratio = Number.isFinite(fit.depthRatio) ? `R/zs ${fit.depthRatio.toFixed(1)}` : ''
  return `LM3 ${src}  ${zs}  ${r}  ${v}  ${ratio}  ·  ${assump}`.replace(/  +/g, ' ').trim()
}

/** Place or replace the next point (max 3); returns a new state. */
export function placeLmPoint(st: LmThreePointState, p: LmPoint): LmThreePointState {
  if (st.points.length >= 3) {
    // Restart cycle with a new turning point.
    return { points: [p], slideK: 0, slideTCpaS: 0 }
  }
  return { ...st, points: [...st.points, p] }
}

/** Role label for the next point the operator should place. */
export function nextLmPointRole(nPlaced: number): 'turning' | 'peak' | 'shallow' | 'slide' {
  if (nPlaced <= 0) return 'turning'
  if (nPlaced === 1) return 'peak'
  if (nPlaced === 2) return 'shallow'
  return 'slide'
}
