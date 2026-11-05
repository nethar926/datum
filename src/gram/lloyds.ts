/**
 * Lloyd's mirror striation overlay. Nulls of the surface-reflection interference sit at
 * f_n(t) = n · c · r(t) / (2 zs zr) with r(t) = sqrt(R² + v²(t − tCPA)²), i.e. hyperbolas on the LOFAR.
 * Written as f_n(t) = n · K · sqrt(1 + ((t − tCPA)/τ)²) with K = f_1 at CPA and τ = R / v.
 * Range/speed come from the CPA fit or a manual entry ("basis"); with no basis only the ratio R/zs is
 * observable (acoustics' depthRatio = rCPA/zs), so it is reported as a relative ratio, never as a depth.
 */
import { C, nullRange } from '@acoustics'

export type LloydBasis = 'cpaFit' | 'manual' | 'none'
export const BASIS_LABEL: Record<LloydBasis, string> = { cpaFit: 'CPA FIT', manual: 'MANUAL', none: 'NONE' }

export interface Striation { k: number; tCpaS: number; tauS: number }

/** n-th null frequency at time t. */
export const striationHz = (s: Striation, n: number, tS: number) => n * s.k * Math.sqrt(1 + ((tS - s.tCpaS) / s.tauS) ** 2)

/** K for a known geometry: first-null frequency at CPA range (uses acoustics' nullRange inversion). */
export const kFromGeometry = (rCpaM: number, zsM: number, zrM: number) => rCpaM / nullRange(1, zsM, zrM, 1)

/** Re-scale K so null number n passes through (tS, fHz). */
export function kThrough(s: Striation, n: number, tS: number, fHz: number): number {
  return fHz / (n * Math.sqrt(1 + ((tS - s.tCpaS) / s.tauS) ** 2))
}
/** Nearest null index to a point (≥1). */
export function nearestNull(s: Striation, tS: number, fHz: number): number {
  return Math.max(1, Math.round(fHz / striationHz(s, 1, tS)))
}

export interface LloydReadout { basis: LloydBasis; zsM: number; depthRatio: number }
/** depthRatio = R/zs = 2·K·zr/c always (matches acoustics); zs = R / depthRatio when range is known. */
export function lloydReadout(basis: LloydBasis, k: number, zrM: number, rCpaM: number | null, c = C): LloydReadout {
  const depthRatio = (2 * k * zrM) / c
  const zsM = basis !== 'none' && rCpaM !== null && rCpaM > 0 ? rCpaM / depthRatio : NaN
  return { basis, zsM, depthRatio }
}

/** Null-to-null spacing Δf(t) = f_{n+1} − f_n = f_1, sampled off the overlay curve (what fitLloydsMirror expects, not null frequencies). */
export function overlaySpacingSamples(s: Striation, t0: number, t1: number, n = 24): { simT: number; spacingHz: number }[] {
  const out: { simT: number; spacingHz: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1)
    out.push({ simT: t, spacingHz: striationHz(s, 2, t) - striationHz(s, 1, t) })
  }
  return out
}
