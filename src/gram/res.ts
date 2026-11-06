import type { GramConfig } from '../engine/contract'
import type { FreqView } from './axis'

/** RES ladder ends (m3-res: Δf = 0.03125·2^(n−1) Hz, 1024 bins). */
export const RES_MIN = 1, RES_MAX = 9, RES_DEFAULT = 5

/** Hz with just enough digits for the RES ladder: 0.031, 0.063, 0.13, 0.25, 0.5, 1, 2, 512, 1024. */
export function fmtHz(hz: number): string {
  if (!Number.isFinite(hz)) return '—'
  if (hz >= 1) return Number.isInteger(hz) ? String(hz) : hz.toFixed(1)
  return String(Number(hz.toPrecision(2)))
}

/** Header readout, numbers straight from gramConfig. Compact drops the band (phone layouts). */
export function resReadout(c: GramConfig | undefined, compact = false): string {
  if (!c || c.res === undefined) return 'RES —'
  // Compact (phone): short chip so −/RES/＋ stays whole in a 390 px head (fBin still on the stream).
  const head = compact ? `RES ${c.res}` : `RES ${c.res} · ${fmtHz(c.fBin)} Hz`
  return compact || c.bandHz === undefined ? head : `${head} · ${fmtHz(c.bandHz)} Hz band`
}

export const vernierLabel = (c: GramConfig | undefined): string | null =>
  c?.fcHz === undefined ? null : `VERNIER ${c.fcHz.toFixed(c.fBin < 0.1 ? 3 : 2)} Hz`

/** Whole displayed span of a stream (includes any BAND LIMIT dead span). */
export const fullView = (c: GramConfig): FreqView => ({ lo: c.f0, hi: c.f0 + (c.bins - 1) * c.fBin })

/** Narrowest zoom: 32 bins on RES grams (sub-Hz at fine RES), 10 Hz on legacy grams. */
export const minSpanOf = (c: GramConfig | undefined): number =>
  c?.res === undefined ? 10 : Math.max(32 * c.fBin, 0.5)

/** First frequency past the simulated top (dead span starts here), or null when the whole band is live. */
export function bandLimitHz(c: GramConfig | undefined): number | null {
  if (!c?.bandLimited || c.liveBins === undefined || c.liveBins >= c.bins) return null
  return c.f0 + c.liveBins * c.fBin
}

/** Geometry key: a change means old rows are on a different grid, so the ring and history restart. */
export const geometryKey = (cs: GramConfig[]): string =>
  cs.map((c) => `${c.streamId}:${c.bins}:${c.f0}:${c.fBin}:${c.rowRateHz}:${c.filter ?? ''}`).join(',')

export const clampRes = (n: number): number => Math.max(RES_MIN, Math.min(RES_MAX, Math.round(n)))
