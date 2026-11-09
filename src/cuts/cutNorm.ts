/**
 * CUTDEMON — DEMON display contract for cuts and live DemonPane.
 *
 * Whitening + colour params live in `src/gram/demonConfig.ts` (shared with live) so
 * Sonya's retunes of DEMON_NORM / DEMON_CARRIER_BAND / DEMON_DISPLAY_DB drop in.
 * Cuts/reveal answer-key UI is `cuts answer-key UI.ts` (not re-exported here — keeps
 * the live import graph free of reveal helpers).
 */
import {
  DEMON_NORM, normalizeDemonRow,
  SplitWindowNormalizer as AcousticsSplitWindowNormalizer,
} from '@acoustics'
import { DEMON_DISPLAY, DEMON_GRAM } from '../gram/demonConfig'

export { DEMON_NORM, DEMON_GRAM, DEMON_DISPLAY }
export {
  DEMON_CARRIER_BAND, DEMON_DISPLAY_DB, DEMON_HISTORY_ROWS, DEMON_STREAM,
  LIVE_DEMON_HINT, liveDemonHint, CUT_DEMON_NO_CAV_HINT,
} from '../gram/demonConfig'

/** @deprecated Prefer DEMON_DISPLAY.ceilDb — alias to acoustics DEMON_DISPLAY_DB.ceilDb. */
export const DEMON_DISPLAY_CEIL_DB = DEMON_DISPLAY.ceilDb

/**
 * Preallocated DEMON row prep: clamp empty-bin floor then whiten (normalizeDemonRow).
 * Soft-clips to DEMON_DISPLAY_DB (0–20). Output goes to the raw ring with normalized={false}.
 */
export class DemonRowNormalizer {
  readonly bins: number
  private readonly nz: AcousticsSplitWindowNormalizer
  constructor(bins = 512) {
    this.bins = bins
    this.nz = new AcousticsSplitWindowNormalizer(bins, DEMON_DISPLAY.window, DEMON_DISPLAY.guard)
  }
  apply(src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number): void {
    normalizeDemonRow(src, srcOff, dst, dstOff, this.bins, DEMON_NORM, true, this.nz)
    const ceil = DEMON_DISPLAY.ceilDb, floor = DEMON_DISPLAY.floorDb
    for (let i = 0; i < this.bins; i++) {
      const v = dst[dstOff + i]
      if (v !== v) continue
      dst[dstOff + i] = v > ceil ? ceil : v < floor ? floor : v
    }
  }
}

export function makeDemonRowNormalizer(bins = 512): DemonRowNormalizer {
  return new DemonRowNormalizer(bins)
}
