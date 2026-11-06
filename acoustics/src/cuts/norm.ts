/**
 * Cut + DEMON display NORM (split-window whitening params and helpers).
 *
 * Cut LOFAR rows are raw dB re 1 µPa²/Hz (acoustics). The FE SplitWindowNormalizer
 * (default window=24, guard=3) was tuned for live band grams; on CUT_BINS=2048 /
 * 0–2000 Hz that short window sits inside the dense low-band plant forest
 * (CFR/PSR/BR/EFR within ~0–50 Hz) and absorbs classifying lines into the
 * background (~3 dB whitened SNR). A longer window reaches quieter mid-band and
 * restores classifying-line contrast on the same 1–22 dB NORM LUT.
 *
 * DEMON rows are already median-relative dB (engine dbFloor/dbCeil = 0/30). Empty
 * bins used to hit powerToDb(1e-30) ≈ −300; a single outlier in a 24-bin window
 * collapses the local mean and paints saturated full-height low-band bars after
 * FE whitening. ClampFloor keeps physics of peaks, kills the display bomb.
 */

export interface NormParams {
  /** Bins in each side window (classic split-window / TPSW-style). */
  readonly window: number;
  /** Centre gap half-width so a tonal does not raise its own background. */
  readonly guard: number;
  /** Display LUT floor (dB above whitened background, or absolute for DEMON). */
  readonly floorDb: number;
  /** Display LUT ceiling. */
  readonly ceilDb: number;
}

export interface DemonNormParams extends NormParams {
  /** Floor applied to engine DEMON rows before FE whitening (dB re median). */
  readonly clampFloorDb: number;
}

/**
 * Cut LOFAR NORM: long split-window matched to the ~50 Hz dense plant cluster on
 * CUT Δf ≈ 0.977 Hz (window·Δf ≈ 188 Hz). Keep live NB 1–22 dB colour scale.
 * Measured on cut-brindleflux-snork @ ~176 s: w=24 → ~2–3.5 dB whitened CFR SNR;
 * w=192 → ≳ 9 dB (target 8–10).
 */
export const CUT_LOFAR_NORM: NormParams = {window: 192, guard: 3, floorDb: 1, ceilDb: 22};

/**
 * DEMON NORM: rows are median-relative; prefer absolute map with floor/ceil 0/30
 * (matches GramConfig). If FE still whitens, use these window/guard + clampFloor.
 * Do **not** reuse live NB 1–22 — blade/shaft peaks routinely exceed 22 dB.
 */
export const DEMON_NORM: DemonNormParams = {window: 24, guard: 3, floorDb: 0, ceilDb: 30, clampFloorDb: -5};

/**
 * Split-window background normalization across frequency (classic LOFAR whitening):
 * each bin minus the mean of the bins in two windows either side of it, skipping a guard gap
 * so a tonal doesn't raise its own background. Works in dB, NaN-safe (dead buoy rows stay NaN),
 * O(bins) via prefix sums, no allocation after construction.
 *
 * Same algorithm as FE `src/gram/whiten.ts`; cut/DEMON defaults live here so FE can
 * `new SplitWindowNormalizer(bins, CUT_LOFAR_NORM.window, CUT_LOFAR_NORM.guard)`.
 */
export class SplitWindowNormalizer {
  private readonly sum: Float64Array;
  private readonly cnt: Int32Array;
  constructor(readonly bins: number, readonly window = CUT_LOFAR_NORM.window, readonly guard = CUT_LOFAR_NORM.guard) {
    if(!(bins > 0) || !Number.isInteger(bins)) throw new Error('SplitWindowNormalizer bins must be a positive integer');
    if(!(window > 0) || !Number.isInteger(window)) throw new Error('window must be a positive integer');
    if(!(guard >= 0) || !Number.isInteger(guard)) throw new Error('guard must be a non-negative integer');
    this.sum = new Float64Array(bins + 1);
    this.cnt = new Int32Array(bins + 1);
  }
  apply(src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number): void {
    const n = this.bins, S = this.sum, C = this.cnt, W = this.window, G = this.guard;
    for (let i = 0; i < n; i++) {
      const v = src[srcOff + i], ok = v === v;
      S[i + 1] = S[i] + (ok ? v : 0);
      C[i + 1] = C[i] + (ok ? 1 : 0);
    }
    for (let i = 0; i < n; i++) {
      const v = src[srcOff + i];
      if (v !== v) { dst[dstOff + i] = NaN; continue; }
      const la = Math.max(0, i - G - W), lb = Math.max(0, i - G);
      const ra = Math.min(n, i + G + 1), rb = Math.min(n, i + G + 1 + W);
      const c = (C[lb] - C[la]) + (C[rb] - C[ra]);
      dst[dstOff + i] = c > 0 ? v - ((S[lb] - S[la]) + (S[rb] - S[ra])) / c : 0;
    }
  }
}

/** Whiten one CUT LOFAR row with cut-tuned window/guard. Allocates nothing beyond the normalizer. */
export function normalizeCutRow(
  src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number,
  bins = src.length - srcOff,
  params: NormParams = CUT_LOFAR_NORM,
  normalizer?: SplitWindowNormalizer,
): void {
  const nz = normalizer && normalizer.bins === bins && normalizer.window === params.window && normalizer.guard === params.guard
    ? normalizer
    : new SplitWindowNormalizer(bins, params.window, params.guard);
  nz.apply(src, srcOff, dst, dstOff);
}

/**
 * Prepare one DEMON row for display: clamp the empty-bin floor, then optional whitening.
 * Does not soft-clip peaks — FE should map with DEMON_NORM.floorDb..ceilDb (0..30).
 */
export function normalizeDemonRow(
  src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number,
  bins = 512,
  params: DemonNormParams = DEMON_NORM,
  whiten = true,
  normalizer?: SplitWindowNormalizer,
): void {
  const floor = params.clampFloorDb;
  for (let i = 0; i < bins; i++) {
    const v = src[srcOff + i];
    dst[dstOff + i] = v === v ? Math.max(floor, v) : NaN;
  }
  if (!whiten) return;
  const nz = normalizer && normalizer.bins === bins && normalizer.window === params.window && normalizer.guard === params.guard
    ? normalizer
    : new SplitWindowNormalizer(bins, params.window, params.guard);
  // Whiten in place into dst (src copy already clamped into dst).
  nz.apply(dst, dstOff, dst, dstOff);
}
