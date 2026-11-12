/**
 * CPU copy of the last `rows` gram rows for ONE stream (the one on screen), for the cross cursor's
 * level readout. Preallocated once; push copies into the ring, no per-row allocation.
 */
export class LevelHistory {
  private readonly buf: Float32Array
  private head = 0 // next write row
  private count = 0
  constructor(readonly rows: number, readonly bins: number) { this.buf = new Float32Array(rows * bins) }
  clear(): void { this.head = 0; this.count = 0 }
  /** Seed `n` filling slots (oldest first). Cursor reads treat the sentinel as no value. */
  seedFilling(n = this.rows): void {
    this.buf.fill(1e10)
    const c = Math.max(0, Math.min(this.rows, n))
    this.count = c
    this.head = c % this.rows
  }
  writeAge(age: number, src: Float32Array, off = 0): void {
    const a = Math.round(age)
    if (a < 0 || a >= this.count) return
    const row = (this.head - 1 - a + this.rows * 2) % this.rows
    this.buf.set(src.subarray(off, off + this.bins), row * this.bins)
  }
  push(src: Float32Array, off: number): void {
    this.buf.set(src.subarray(off, off + this.bins), this.head * this.bins)
    this.head = (this.head + 1) % this.rows
    if (this.count < this.rows) this.count++
  }
  get size(): number { return this.count }
  /** dB at `ago` rows before the newest row (0 = newest) and bin; NaN when out of range or not yet recorded. */
  at(ago: number, bin: number): number {
    const a = Math.round(ago), b = Math.round(bin)
    if (a < 0 || a >= this.count || b < 0 || b >= this.bins) return NaN
    const row = (this.head - 1 - a + this.rows * 2) % this.rows
    const v = this.buf[row * this.bins + b]!
    return Number.isFinite(v) && v > 1e9 ? NaN : v
  }
  /** Copy one history row into dest (must be ≥ bins). Returns false if unavailable. */
  copyRow(ago: number, dest: Float32Array): boolean {
    const a = Math.round(ago)
    if (a < 0 || a >= this.count || dest.length < this.bins) return false
    const row = (this.head - 1 - a + this.rows * 2) % this.rows
    dest.set(this.buf.subarray(row * this.bins, row * this.bins + this.bins))
    return true
  }
}
