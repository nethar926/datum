/**
 * Lloyd's mirror striation overlay. Nulls of the surface-reflection interference sit at
 * f_n(t) = n · c · r(t) / (2 zs zr) with r(t) = sqrt(R² + v²(t − tCPA)²), i.e. hyperbolas on the LOFAR.
 * Written as f_n(t) = n · K · sqrt(1 + ((t − tCPA)/τ)²) with K = f_1 at CPA and τ = R / v.
 * Range/speed come from the CPA fit or a manual entry ("basis"); with no basis only zs/R is observable,
 * so it is reported as a relative depth ratio, never as a depth.
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
/** zs = c·R/(2·K·zr) when range is known; zs/R = c/(2·K·zr) always. */
export function lloydReadout(basis: LloydBasis, k: number, zrM: number, rCpaM: number | null, c = C): LloydReadout {
  const depthRatio = c / (2 * k * zrM)
  const zsM = basis !== 'none' && rCpaM !== null && rCpaM > 0 ? depthRatio * rCpaM : NaN
  return { basis, zsM, depthRatio }
}
