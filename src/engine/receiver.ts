/**
 * Generic sonobuoy receiver front end applied to each spectrum row (dB per bin). Generic public behaviour, no
 * real equipment specs: a finite dynamic range (quantisation floor DR dB below full scale), an AGC that holds the
 * total in-band power near the level it settled to on the first rows (fast attack, slow release), and clipping
 * when a bin exceeds full scale before the AGC catches up. Effects the operator sees:
 *  - banding/pumping: whole-row level steps while the gain moves (visible in Raw view);
 *  - drowning: weak lines fall below the floor when a loud source pulls the gain down;
 *  - overload splatter: clipped rows get a broadband floor rise.
 * Output is post-gain dB relative to the settled gain (identical to input while g = 0 and nothing clips/drowns).
 * In place on the caller's row; no allocation per row.
 */
export interface ReceiverParams { dynamicRangeDb: number; headroomDb: number; attackS: number; releaseS: number; minGainDb: number; maxGainDb: number; splatterDbPerDb: number }
export const DEFAULT_RECEIVER: ReceiverParams = { dynamicRangeDb: 60, headroomDb: 6, attackS: 0.5, releaseS: 8, minGainDb: -40, maxGainDb: 10, splatterDbPerDb: 0.5 }

export class Receiver {
  gainDb = 0
  overload = false
  private refDb = NaN
  constructor(readonly p: ReceiverParams = DEFAULT_RECEIVER) {}
  reset(): void { this.gainDb = 0; this.overload = false; this.refDb = NaN }

  /** Process `bins` values of `row` from `off`, `dt` seconds after the previous row. */
  process(row: Float32Array, off: number, bins: number, dt: number): void {
    const p = this.p
    let lin = 0
    for (let i = 0; i < bins; i++) { const v = row[off + i]; if (Number.isFinite(v)) lin += 10 ** (v / 10) }
    if (!(lin > 0)) return
    const totDb = 10 * Math.log10(lin)
    if (!Number.isFinite(this.refDb)) this.refDb = totDb // settle on the first live row
    const want = Math.min(p.maxGainDb, Math.max(p.minGainDb, this.refDb - totDb))
    const tau = want < this.gainDb ? p.attackS : p.releaseS
    this.gainDb += (want - this.gainDb) * (1 - Math.exp(-dt / Math.max(1e-3, tau)))
    const fs = this.refDb + p.headroomDb, floor = fs - p.dynamicRangeDb, g = this.gainDb
    let excess = 0
    for (let i = 0; i < bins; i++) {
      const v = row[off + i] + g
      if (v > fs) { excess = Math.max(excess, v - fs); row[off + i] = fs } else row[off + i] = v
    }
    this.overload = excess > 0
    const raise = excess * p.splatterDbPerDb
    for (let i = 0; i < bins; i++) {
      let v = row[off + i]
      if (raise > 0) v = 10 * Math.log10(10 ** (v / 10) + 10 ** ((floor + raise) / 10))
      row[off + i] = v < floor ? floor : v
    }
  }
}
