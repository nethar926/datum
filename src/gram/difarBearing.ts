import type { Bearing, GramConfig, TacticalBuoy } from '../engine/contract'

export type GramMode = 'lofar' | 'difar'
export const GRAM_MODES: readonly GramMode[] = ['lofar', 'difar']
export const isGramMode = (v: unknown): v is GramMode => v === 'lofar' || v === 'difar'

/**
 * Interim per-bin bearing row until the engine streams one (gram kind 'bearing').
 * Bins within ±spread of each tracked line on this buoy get that line's bearing; every other bin is NaN
 * (drawn neutral grey, i.e. no bearing / isotropic ambient). Returns false for non-DIFAR buoys.
 * No allocation: writes into `out` (length cfg.bins).
 */
export function fillLineBearings(out: Float32Array, cfg: GramConfig, buoy: TacticalBuoy | undefined, bearings: readonly Bearing[] | undefined, spreadHz = 1.5): boolean {
  out.fill(NaN)
  if (!buoy || buoy.kind !== 'difar' || !bearings) return false
  const half = Math.max(1, Math.round(spreadHz / cfg.fBin))
  for (const b of bearings) {
    if (b.buoyId !== cfg.channel || !Number.isFinite(b.brgDeg)) continue
    const c = Math.round((b.freqHz - cfg.f0) / cfg.fBin)
    const lo = Math.max(0, c - half), hi = Math.min(cfg.bins - 1, c + half)
    const deg = ((b.brgDeg % 360) + 360) % 360
    for (let i = lo; i <= hi; i++) out[i] = deg
  }
  return true
}
