import { describe, expect, it } from 'vitest'
import { formatZuluHms } from '../touch/scrollBack'
import {
  BT_BINS, BT_EMPTY_LABEL, BT_ENERGY_BYTES, BT_MAX_BUOYS, BT_MAX_ROWS, BT_WINDOW_S, BT_ZOOM_WINDOWS_S,
  BT_ZULU_TICK, BtRing, BtStore, applyBtSeekClear, axisFracToBearing, bearingBin, bearingRateDegPerS,
  BT_OVERLAY_MAX_SIGMA_DEG, bearingToAxisFrac, btAvailable, btAxisTickAlign, btAxisTicks, btOverlayBars,
  BT_DB_ABOVE_BG_MAX, BT_DB_ABOVE_BG_SCALE, BT_DB_ABOVE_BG_STEP, btPaletteIndex, btRowFromEngine,
  btTimeAxisMinWidthPx, fillBtRingFromHistory, formatBtBearingTick, formatBtCursor, lutForPalette,
  sigmaBarSegments, wrapBearingDeg,
} from './bt'

describe('wrap and 1° bins', () => {
  it('wraps bearings into [0, 360)', () => {
    expect(wrapBearingDeg(0)).toBe(0)
    expect(wrapBearingDeg(360)).toBe(0)
    expect(wrapBearingDeg(361)).toBe(1)
    expect(wrapBearingDeg(-10)).toBe(350)
    expect(wrapBearingDeg(359.2)).toBeCloseTo(359.2, 10)
  })
  it('maps a strong integer bearing onto that bin, including 0/360', () => {
    expect(bearingBin(47)).toBe(47)
    expect(bearingBin(0)).toBe(0)
    expect(bearingBin(360)).toBe(0)
    expect(bearingBin(359.2)).toBe(359)
    expect(bearingBin(-0.1)).toBe(359)
  })
})

describe('centred north-up axis', () => {
  it('puts 000° at the left when uncentred, 180° in the middle', () => {
    expect(bearingToAxisFrac(0, null)).toBeCloseTo(0, 10)
    expect(bearingToAxisFrac(90, null)).toBeCloseTo(0.25, 10)
    expect(bearingToAxisFrac(180, null)).toBeCloseTo(0.5, 10)
    expect(bearingToAxisFrac(270, null)).toBeCloseTo(0.75, 10)
    expect(axisFracToBearing(0, null)).toBeCloseTo(0, 10)
    expect(axisFracToBearing(0.5, null)).toBeCloseTo(180, 10)
  })
  it('centring on 000° places 0 in the middle so a north track does not wrap', () => {
    expect(bearingToAxisFrac(0, 0)).toBeCloseTo(0.5, 10)
    expect(bearingToAxisFrac(90, 0)).toBeCloseTo(0.75, 10)
    expect(bearingToAxisFrac(270, 0)).toBeCloseTo(0.25, 10)
    const a359 = bearingToAxisFrac(359, 0)
    const a1 = bearingToAxisFrac(1, 0)
    expect(a359).toBeCloseTo(0.5 - 1 / 360, 10)
    expect(a1).toBeCloseTo(0.5 + 1 / 360, 10)
    expect(Math.abs(a1 - a359)).toBeCloseTo(2 / 360, 10)
    expect(axisFracToBearing(0.5, 0)).toBeCloseTo(0, 10)
    expect(axisFracToBearing(0, 0)).toBeCloseTo(180, 10)
  })
  it('centring on an arbitrary bearing is invertible and keeps 0/360 adjacent', () => {
    const c = 47
    expect(bearingToAxisFrac(c, c)).toBeCloseTo(0.5, 10)
    for (const d of [0, 1, 47, 180, 359, 360]) {
      const f = bearingToAxisFrac(d, c)
      expect(axisFracToBearing(f, c)).toBeCloseTo(wrapBearingDeg(d), 8)
    }
  })
})

describe('btRowFromEngine', () => {
  it('copies a 360-bin uint8 engine row as-is (already max-normalised)', () => {
    const energy = new Uint8Array(BT_BINS)
    energy[12] = 200
    energy[13] = 100
    const out = new Uint8Array(BT_BINS)
    btRowFromEngine({ energy }, out)
    expect(out[12]).toBe(200)
    expect(out[13]).toBe(100)
    expect(out[14]).toBe(0)
    expect(out).not.toBe(energy)
  })
  it('a single lit engine bin at bearing X stays in bin X', () => {
    const energy = new Uint8Array(BT_BINS)
    energy[47] = 255
    const out = new Uint8Array(BT_BINS)
    btRowFromEngine({ energy }, out)
    expect(out[47]).toBe(255)
    let lit = 0
    for (let i = 0; i < BT_BINS; i++) if (out[i]) lit++
    expect(lit).toBe(1)
  })

  it('keeps max-normalised behaviour when scale is omitted (legacy Cuts)', () => {
    const energy = new Uint8Array(BT_BINS)
    energy[10] = 0
    energy[11] = 128
    energy[12] = 255
    const out = new Uint8Array(BT_BINS)
    btRowFromEngine({ energy }, out)
    expect(out[10]).toBe(0)
    expect(out[11]).toBe(128)
    expect(out[12]).toBe(255)
    expect(btPaletteIndex(0)).toBe(0)
    expect(btPaletteIndex(255)).toBe(255)
  })

  it('maps db-above-bg-0.1 linearly onto the palette (0 dB near black, 25.5 dB at the top)', () => {
    expect(BT_DB_ABOVE_BG_STEP).toBe(0.1)
    expect(BT_DB_ABOVE_BG_MAX).toBeCloseTo(255 * BT_DB_ABOVE_BG_STEP, 10)
    expect(btPaletteIndex(0, BT_DB_ABOVE_BG_SCALE)).toBe(0)
    expect(btPaletteIndex(10, BT_DB_ABOVE_BG_SCALE)).toBe(10) // 1.0 dB
    expect(btPaletteIndex(255, BT_DB_ABOVE_BG_SCALE)).toBe(255)
    const energy = new Uint8Array(BT_BINS)
    energy[0] = 0
    energy[90] = 25   // 2.5 dB
    energy[180] = 255 // 25.5 dB
    const out = new Uint8Array(BT_BINS)
    btRowFromEngine({ energy, scale: BT_DB_ABOVE_BG_SCALE }, out)
    expect(out[0]).toBe(0)
    expect(out[90]).toBe(25)
    expect(out[180]).toBe(255)
    const lut = lutForPalette('green')
    // Palette index 0 is the first stop (near black); 255 is the last stop (not black).
    const lum0 = lut[0]! + lut[1]! + lut[2]!
    const lumTop = lut[255 * 4]! + lut[255 * 4 + 1]! + lut[255 * 4 + 2]!
    expect(lum0).toBeLessThan(40)
    expect(lumTop).toBeGreaterThan(lum0)
    expect(lumTop).toBeGreaterThan(200)
  })
})

describe('BtRing push / wrap / clear', () => {
  it('pushes without allocating, wraps when full, and clear empties it', () => {
    const ring = new BtRing(4)
    const before = ring.byteLength
    const row = new Uint8Array(BT_BINS)
    row[10] = 1
    ring.push(row, 1)
    row[10] = 2
    ring.push(row, 2)
    row[10] = 3
    ring.push(row, 3)
    row[10] = 4
    ring.push(row, 4)
    expect(ring.size).toBe(4)
    expect(ring.at(0, 10)).toBe(4)
    expect(ring.timeAt(0)).toBe(4)
    expect(ring.at(3, 10)).toBe(1)
    row[10] = 5
    ring.push(row, 5)
    expect(ring.size).toBe(4)
    expect(ring.at(0, 10)).toBe(5)
    expect(ring.at(3, 10)).toBe(2)
    expect(ring.byteLength).toBe(before)
    ring.clear()
    expect(ring.size).toBe(0)
    expect(ring.at(0, 10)).toBe(0)
    expect(ring.row(0)).toBeNull()
  })
})

describe('seek / cut / new-sim clear and history refill', () => {
  it('clears on a replace seek and leaves the ring alone when replace is false', () => {
    const ring = new BtRing(8)
    const row = new Uint8Array(BT_BINS)
    row[0] = 200
    ring.push(row, 3)
    applyBtSeekClear(ring, { replace: false })
    expect(ring.size).toBe(1)
    applyBtSeekClear(ring, { replace: true })
    expect(ring.size).toBe(0)
    expect(ring.at(0, 0)).toBe(0)
  })
  it('fillBtRingFromHistory clears then loads engine rows oldest-first', () => {
    const ring = new BtRing(8)
    const scratch = new Uint8Array(BT_BINS)
    const a = new Uint8Array(BT_BINS); a[1] = 10
    const b = new Uint8Array(BT_BINS); b[1] = 20
    fillBtRingFromHistory(ring, [{ energy: a, t: 10 }, { energy: b, t: 11 }], scratch)
    expect(ring.size).toBe(2)
    expect(ring.at(0, 1)).toBe(20)
    expect(ring.timeAt(0)).toBe(11)
    expect(ring.at(1, 1)).toBe(10)
  })
  it('BtStore.clear drops every buoy, matching a new sim or cut', () => {
    const store = new BtStore(4, 8)
    const row = new Uint8Array(BT_BINS)
    row[1] = 9
    store.ringFor(11).push(row, 1)
    store.ringFor(12).push(row, 1)
    expect(store.ringFor(11).size).toBe(1)
    store.clear()
    expect(store.ringFor(11).size).toBe(0)
  })
})

describe('32-buoy 15 min memory budget', () => {
  it('preallocated energy buffers stay ~10 MB (32 × 900 × 360)', () => {
    expect(BT_ZOOM_WINDOWS_S).toEqual([300, 900])
    expect(BT_WINDOW_S).toBe(900)
    expect(BT_MAX_ROWS).toBe(900)
    expect(BT_MAX_BUOYS).toBe(32)
    expect(BT_ENERGY_BYTES).toBe(32 * 900 * 360)
    expect(BT_ENERGY_BYTES).toBe(10_368_000)
    const store = new BtStore()
    expect(store.byteLength).toBe(BT_ENERGY_BYTES)
    expect(store.byteLength).toBe(store.ringFor(1).byteLength * BT_MAX_BUOYS)
    expect(store.byteLength / 1_000_000).toBeCloseTo(10.368, 3)
    expect(store.byteLength).toBeLessThan(11_000_000)
  })
})

describe('cursor readout and bearing rate', () => {
  it('formats bearing and Zulu time, plus a rate when a second point is marked', () => {
    const origin = Date.UTC(2026, 0, 1, 2, 13, 0)
    expect(formatBtCursor(47.2, 47, origin)).toBe('047°  02:13:47z')
    expect(formatBtCursor(359.6, 0, origin, 1.25)).toBe('000°  02:13:00z  +1.25°/s')
    expect(formatBtCursor(10, 0, origin, -0.5)).toBe('010°  02:13:00z  −0.50°/s')
  })
  it('uses the shortest circular path for bearing rate (wrap at 0/360)', () => {
    const rate = bearingRateDegPerS({ bearingDeg: 350, simS: 0 }, { bearingDeg: 10, simS: 10 })
    expect(rate).not.toBeNull()
    expect(rate!).toBeCloseTo(2, 8)
    expect(bearingRateDegPerS({ bearingDeg: 0, simS: 5 }, { bearingDeg: 10, simS: 5 })).toBeNull()
  })
})


describe('BT axis labels and gutter', () => {
  it('formats the last uncentred bearing tick as 360°, not a wrapped 000°', () => {
    expect(formatBtBearingTick(0, null)).toBe('000°')
    expect(formatBtBearingTick(180, null)).toBe('180°')
    expect(formatBtBearingTick(360, null)).toBe('360°')
    expect(formatBtBearingTick(0, 0)).toBe('000°')
  })

  it('anchors end ticks inward so 000° and 360° stay inside the plot', () => {
    expect(btAxisTickAlign(0)).toBe('start')
    expect(btAxisTickAlign(1)).toBe('end')
    expect(btAxisTickAlign(0.5)).toBe('center')
    const wide = btAxisTicks(null, 800)
    const first = wide.find((t) => t.frac === 0)
    const last = wide.find((t) => t.frac === 1)
    expect(first).toMatchObject({ label: '000°', align: 'start' })
    expect(last).toMatchObject({ label: '360°', align: 'end' })
    // Mid ticks stay centred, including 180°.
    expect(wide.find((t) => t.deg === 180)?.align).toBe('center')
    // Narrow plots use 90° steps but still keep both ends.
    const narrow = btAxisTicks(null, 200)
    expect(narrow[0]).toMatchObject({ label: '000°', align: 'start' })
    expect(narrow.at(-1)).toMatchObject({ label: '360°', align: 'end', frac: 1 })
  })

  it('formats time ticks as full HH:MM:SSz and reserves a gutter that fits them', () => {
    const origin = Date.UTC(2026, 0, 1, 7, 47, 0)
    expect(formatZuluHms(0, origin)).toBe('07:47:00z')
    expect(formatZuluHms(0, origin)).not.toBe('07:47:')
    expect(BT_ZULU_TICK).toBe('00:00:00z')
    expect(BT_ZULU_TICK.length).toBe(9)
    // 9ch at 10px mono (0.6em) + 6px inset each side = 66px, wider than the old 44px gutter.
    expect(btTimeAxisMinWidthPx()).toBe(66)
    expect(btTimeAxisMinWidthPx()).toBeGreaterThan(44)
  })
})

describe('DIFAR availability and empty state', () => {
  it('gates on engine type === difar, not on kind when type is present', () => {
    expect(btAvailable({ type: 'difar', kind: 'difar' })).toBe(true)
    expect(btAvailable({ type: 'omni', kind: 'difar' })).toBe(false)
    expect(btAvailable({ type: 'dicass' })).toBe(false)
    expect(btAvailable({ type: 'bt' })).toBe(false)
    expect(btAvailable({ kind: 'difar' })).toBe(true)
    expect(btAvailable({ kind: 'omni' })).toBe(false)
    expect(btAvailable(undefined)).toBe(false)
  })
  it('names the empty state when the engine has posted no rows', () => {
    expect(BT_EMPTY_LABEL).toBe('No bearing data')
  })
})

describe('overlay σ bars', () => {
  it('keeps entries in the visible window for this buoy and records validity', () => {
    const bars = btOverlayBars([
      { t: 10, buoyId: 2, bearingDeg: 47, sigmaDeg: 3, snrDb: 8, valid: true, freqHz: 178.8 },
      { t: 11, buoyId: 2, bearingDeg: 50, sigmaDeg: 90, snrDb: -5, valid: false },
      { t: 11, buoyId: 9, bearingDeg: 10, sigmaDeg: 3, snrDb: 8, valid: true },
      { t: 0, buoyId: 2, bearingDeg: 1, sigmaDeg: 3, snrDb: 8, valid: true },
    ], { buoyId: 2, newest: 11, windowS: 5 })
    expect(bars).toHaveLength(2)
    expect(bars[0]!.valid).toBe(true)
    expect(bars[0]!.half).toBeCloseTo(3 / 360, 10)
    expect(bars[1]!.valid).toBe(false)
    // Invalid engine entries use σ = 90° (a 180° bar). Do not paint that wash.
    expect(bars[1]!.half).toBe(0)
  })
  it('clamps wide valid σ bars and drops the bar on invalid 90° entries', () => {
    const bars = btOverlayBars([
      { t: 10, buoyId: 1, bearingDeg: 47, sigmaDeg: 90, snrDb: 8, valid: true },
      { t: 10, buoyId: 1, bearingDeg: 12, sigmaDeg: 90, snrDb: -8, valid: false },
    ], { buoyId: 1, newest: 10, windowS: 5 })
    expect(bars).toHaveLength(2)
    expect(bars[0]!.half).toBeCloseTo(BT_OVERLAY_MAX_SIGMA_DEG / 360, 10)
    expect(bars[0]!.half).toBeLessThan(90 / 360)
    expect(bars[1]!.half).toBe(0)
  })
  it('splits a σ bar that wraps at 0/360 on an uncentred axis', () => {
    const segs = sigmaBarSegments(0, 10 / 360, null)
    expect(segs.length).toBe(2)
    expect(segs.some((s) => s.lo === 0)).toBe(true)
    expect(segs.some((s) => s.hi === 1)).toBe(true)
    const mid = sigmaBarSegments(180, 10 / 360, null)
    expect(mid).toHaveLength(1)
    expect(mid[0]!.lo).toBeLessThan(0.5)
    expect(mid[0]!.hi).toBeGreaterThan(0.5)
  })
})
