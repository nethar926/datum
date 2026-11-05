/**
 * Split-window background normalization across frequency (classic LOFAR whitening):
 * each bin minus the mean of the bins in two windows either side of it, skipping a guard gap
 * so a tonal doesn't raise its own background. Works in dB, NaN-safe (dead buoy rows stay NaN),
 * O(bins) via prefix sums, no allocation after construction.
 */
export class SplitWindowNormalizer {
  private readonly sum: Float64Array
  private readonly cnt: Int32Array
  constructor(readonly bins: number, readonly window = 24, readonly guard = 3) {
    this.sum = new Float64Array(bins + 1); this.cnt = new Int32Array(bins + 1)
  }
  apply(src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number): void {
    const n = this.bins, S = this.sum, C = this.cnt, W = this.window, G = this.guard
    for (let i = 0; i < n; i++) {
      const v = src[srcOff + i], ok = v === v
      S[i + 1] = S[i] + (ok ? v : 0); C[i + 1] = C[i] + (ok ? 1 : 0)
    }
    for (let i = 0; i < n; i++) {
      const v = src[srcOff + i]
      if (v !== v) { dst[dstOff + i] = NaN; continue }
      const la = Math.max(0, i - G - W), lb = Math.max(0, i - G)
      const ra = Math.min(n, i + G + 1), rb = Math.min(n, i + G + 1 + W)
      const c = (C[lb] - C[la]) + (C[rb] - C[ra])
      dst[dstOff + i] = c > 0 ? v - ((S[lb] - S[la]) + (S[rb] - S[ra])) / c : 0
    }
  }
}
