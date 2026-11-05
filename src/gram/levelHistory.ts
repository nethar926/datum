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
    return this.buf[row * this.bins + b]
  }
}
