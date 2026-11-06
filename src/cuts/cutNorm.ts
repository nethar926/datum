/**
 * CUTDEMON — DEMON display contract for cuts (and live DemonPane).
 *
 * Engine DEMON rows are median-relative but routinely exceed the advertised 0/30
 * (brindleflux raw p95≳78). normalizeDemonRow clamps the empty-bin floor then
 * whitens; colour with DEMON_NORM.floorDb..DEMON_DISPLAY_CEIL_DB (never live NB 1–22).
 *
 * Cut LOFAR is unchanged from main (Physicist holds the cut-LOFAR tip).
 */
import {
  DEMON_NORM, normalizeDemonRow,
  SplitWindowNormalizer as AcousticsSplitWindowNormalizer,
} from '@acoustics'

export { DEMON_NORM }

/** Colour-map ceiling for whitened DEMON (stream still says 0/30; whitened p99≈59, max≈68). */
export const DEMON_DISPLAY_CEIL_DB = 65

/**
 * Preallocated DEMON row prep: clamp empty-bin floor then whiten (normalizeDemonRow).
 * Output is pushed to the raw ring with normalized={false} auto={false}.
 */
export class DemonRowNormalizer {
  readonly bins: number
  private readonly nz: AcousticsSplitWindowNormalizer
  constructor(bins = 512) {
    this.bins = bins
    this.nz = new AcousticsSplitWindowNormalizer(bins, DEMON_NORM.window, DEMON_NORM.guard)
  }
  apply(src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number): void {
    normalizeDemonRow(src, srcOff, dst, dstOff, this.bins, DEMON_NORM, true, this.nz)
    const ceil = DEMON_DISPLAY_CEIL_DB, floor = DEMON_NORM.floorDb
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

/** DemonPane: absolute colour map after normalizeDemonRow (not live NB 1–22). */
export const DEMON_GRAM = {
  normalized: false as const,
  auto: false as const,
}
