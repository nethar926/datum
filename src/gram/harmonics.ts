/** Harmonic-cursor maths for DEMON (and LOFAR harmonic families). Pure functions. */

/** n·f0 for n = 1.. while ≤ fMax (capped at maxN). */
export function harmonicSeries(f0: number, fMax: number, maxN = 24): number[] {
  const out: number[] = []
  if (!(f0 > 0) || !(fMax > 0)) return out
  for (let n = 1; n <= maxN && n * f0 <= fMax + 1e-9; n++) out.push(n * f0)
  return out
}

export interface BladeReadout {
  shaftHz: number; rpm: number
  bladeHz: number | null; blades: number | null
  /** |blade/shaft − nearest integer|; above BLADE_TOL the blade count is not trusted. */
  ratioErr: number | null
}
export const BLADE_TOL = 0.15
export const MAX_BLADES = 12

/** Shaft rate → RPM, and blade line → blade count (blade-rate = shaft-rate × blades). */
export function bladeReadout(shaftHz: number, bladeHz: number | null): BladeReadout {
  const r: BladeReadout = { shaftHz, rpm: shaftHz * 60, bladeHz, blades: null, ratioErr: null }
  if (bladeHz === null || !(shaftHz > 0) || !(bladeHz > 0)) return r
  const ratio = bladeHz / shaftHz, n = Math.round(ratio)
  r.ratioErr = Math.abs(ratio - n)
  if (n >= 2 && n <= MAX_BLADES && r.ratioErr <= BLADE_TOL) r.blades = n
  return r
}
