/** Per-stream auto display range from a low percentile of each row (strided sample), exponentially smoothed. Allocation-free. */
export class AutoLevel {
  private readonly floor: Float32Array
  private readonly seen: Uint8Array
  private readonly scratch = new Float32Array(128)
  constructor(streams: number, private readonly alpha = 0.15, private readonly pct = 0.3) {
    this.floor = new Float32Array(streams); this.seen = new Uint8Array(streams)
  }
  update(s: number, row: Float32Array, offset: number, bins: number): void {
    const n = this.scratch.length, step = Math.max(1, Math.floor(bins / n))
    let m = 0
    for (let i = 0; i < n && i * step < bins; i++) { const v = row[offset + i * step]; if (v === v) this.scratch[m++] = v }
    if (m < 8) return
    const view = this.scratch.subarray(0, m)
    view.sort()
    const est = view[Math.floor(m * this.pct)]
    this.floor[s] = this.seen[s] ? this.floor[s] + (est - this.floor[s]) * this.alpha : est
    this.seen[s] = 1
  }
  /** Returns the floor estimate or NaN before any data. */
  get(s: number): number { return this.seen[s] ? this.floor[s] : NaN }
}
