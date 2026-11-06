import type { GramConfig } from '../engine/contract'
import { clampView, type FreqView } from './axis'
import { clampRes, fmtHz } from './res'

/**
 * m3-fe-center: "center on a frequency". Pure planning, no I/O. The visible window recentres on `hz` at the current
 * RES and zoom span:
 *  - RES / vernier gram whose current band can hold the centred window → view-only pan (no handoff, instant);
 *  - otherwise (window would run off the band) → retune the vernier to `hz` through the gram handoff, then show the
 *    same span centred on `hz` once the new grid is on screen;
 *  - band-preset gram (RES off) → back to RES at the current RES level with the vernier on `hz` (handoff; the band
 *    preset stays armed in the picker, as RES −/+ already does).
 * The engine slides the vernier band to stay inside [0, simTop], so near the edges the window clamps (CTR still
 * reports the requested, clamped frequency).
 */
export const RES_BINS = 1024, RES_CENTER_BIN = 512
/** RES ladder Δf (m3-res: 0.03125·2^(n−1) Hz). */
export const resFBin = (res: number): number => 0.03125 * 2 ** (clampRes(res) - 1)

/** Engine vernier placement (mirrors acoustics resBand): f0 = fc − 512Δf, slid into [0, simTop]. */
export function vernierBand(res: number, hz: number, simTopHz: number): { f0: number; hi: number } {
  const fBin = resFBin(res)
  let f0 = hz - RES_CENTER_BIN * fBin
  if (f0 + (RES_BINS - 1) * fBin > simTopHz) f0 = simTopHz - (RES_BINS - 1) * fBin
  if (f0 < 0) f0 = 0
  return { f0, hi: f0 + (RES_BINS - 1) * fBin }
}

/** Window of `span` Hz centred on hz inside [lo, hi] (clamped, keeps the span when it fits). */
export function centerView(hz: number, span: number, lo: number, hi: number, minSpan = 0): FreqView {
  return clampView({ lo: hz - span / 2, hi: hz + span / 2 }, hi, minSpan, lo)
}

export interface CenterInput {
  hz: number
  /** Displayed LOFAR stream (undefined before the first streams: nothing to do). */
  cfg: GramConfig | undefined
  /** Visible window now. */
  view: FreqView
  /** Band-preset gram on screen / requested (RES off). */
  bandOn: boolean
  /** Requested RES level (st.gram.res): the level RES −/+ steps from, kept while a band preset is on. */
  res: number
  /** Simulated top frequency (1000 / 2000 Hz). */
  simTopHz: number
  /** Narrowest zoom of the target grid (Hz). */
  minSpan?: number
}
export interface CenterPlan {
  /** Requested centre after clamping to [0, simTop]. */
  hz: number
  /** Window to show (now for 'view', after the swap for 'vernier' / 'band→res'). */
  view: FreqView
  /** Engine change, or null for a view-only pan. Goes to client.setGram (which runs the handoff). */
  gram: null | { res: number; vernierHz: number | null; band?: null }
  kind: 'view' | 'vernier' | 'band→res' | 'none'
}

const EPS = 1e-6

export function planCenter(i: CenterInput): CenterPlan {
  const { cfg, view } = i
  const top = Math.max(1, i.simTopHz)
  const hz = Number.isFinite(i.hz) ? Math.max(0, Math.min(top, i.hz)) : NaN
  if (!cfg || !Number.isFinite(hz)) return { hz: Number.isFinite(hz) ? hz : 0, view, gram: null, kind: 'none' }
  const span0 = Math.max(EPS, view.hi - view.lo)
  if (i.bandOn || cfg.res === undefined) {
    // Band preset (or legacy) gram → RES at the saved level, vernier on hz (unless the RES band already covers the sim).
    const res = clampRes(i.res), fBin = resFBin(res), bandHz = RES_BINS * fBin
    const vernier = bandHz < top
    const b = vernier ? vernierBand(res, hz, top) : { f0: 0, hi: (RES_BINS - 1) * fBin }
    const span = Math.min(span0, b.hi - b.f0)
    if (!i.bandOn) {
      // Legacy 4 Hz gram (no RES streams): view-only.
      const full = { lo: cfg.f0, hi: cfg.f0 + (cfg.bins - 1) * cfg.fBin }
      return { hz, view: centerView(hz, span0, full.lo, full.hi, i.minSpan), gram: null, kind: 'view' }
    }
    return { hz, view: centerView(hz, span, b.f0, b.hi, Math.min(i.minSpan ?? 0, b.hi - b.f0)), gram: { res, vernierHz: vernier ? hz : null, band: null }, kind: 'band→res' }
  }
  // RES / vernier gram.
  const lo = cfg.f0, hi = cfg.f0 + (cfg.bins - 1) * cfg.fBin
  const span = Math.min(span0, hi - lo)
  const want = { lo: hz - span / 2, hi: hz + span / 2 }
  const fits = want.lo >= lo - EPS && want.hi <= hi + EPS
  const bandHz = cfg.bandHz ?? cfg.bins * cfg.fBin
  // A band that already covers the whole sim (RES 9 at 1 kHz) can't move: pan only.
  if (fits || bandHz >= top) return { hz, view: centerView(hz, span, lo, hi, i.minSpan), gram: null, kind: 'view' }
  const res = cfg.res ?? clampRes(i.res)
  const b = vernierBand(res, hz, top)
  // Engine band would not move (already pinned at an edge): pan within it instead of a no-op handoff.
  if (Math.abs(b.f0 - lo) < cfg.fBin * 0.5) return { hz, view: centerView(hz, span, lo, hi, i.minSpan), gram: null, kind: 'view' }
  return { hz, view: centerView(hz, span, b.f0, b.hi, i.minSpan), gram: { res, vernierHz: hz }, kind: 'vernier' }
}

/** Header readout, e.g. "CTR 123.4 Hz" (more digits at fine RES). */
export function ctrLabel(hz: number, fBin = 1): string {
  if (!Number.isFinite(hz)) return 'CTR —'
  return `CTR ${fBin < 0.1 ? hz.toFixed(2) : hz >= 100 || fBin >= 1 ? hz.toFixed(1) : fmtHz(Math.round(hz * 100) / 100)} Hz`
}

/** Typed entry ("123.4", "123.4 hz", "1.2k"): Hz or NaN. */
export function parseHz(s: string): number {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(k)?\s*(hz)?\s*$/i.exec(s)
  if (!m) return NaN
  return Number(m[1]) * (m[2] ? 1000 : 1)
}
