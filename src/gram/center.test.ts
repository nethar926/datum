import { describe, expect, it } from 'vitest'
import { centerView, ctrLabel, parseHz, planCenter, resFBin, vernierBand, RES_BINS, RES_CENTER_BIN } from './center'
import type { GramConfig } from '../engine/contract'

const cfg = (p: Partial<GramConfig> = {}): GramConfig => ({
  v: 1, type: 'gramConfig', streamId: 1, kind: 'lofar', channel: 11,
  bins: 1024, f0: 0, fBin: 0.5, rowRateHz: 0.5, dbFloor: 0, dbCeil: 30,
  res: 5, filter: 'NB', bandHz: 512, bandLimited: false, liveBins: 1024, ...p,
})

describe('center math', () => {
  it('places the vernier band the way the engine does (fc at bin 512, slid into [0, simTop])', () => {
    expect(resFBin(5)).toBe(0.5)
    expect(RES_BINS).toBe(1024)
    expect(RES_CENTER_BIN).toBe(512)
    // Mid-band at RES 5: 200 − 256 would go negative, so f0 pins at 0 (engine slide).
    const mid = vernierBand(5, 200, 1000)
    expect(mid.f0).toBe(0)
    expect(mid.hi).toBeCloseTo(1023 * 0.5)
    // A centre that keeps the full window inside [0, simTop].
    const roomy = vernierBand(5, 400, 1000)
    expect(roomy.f0).toBeCloseTo(400 - 512 * 0.5)
    expect(roomy.hi).toBeCloseTo(roomy.f0 + 1023 * 0.5)
    // Near the top: slides down so hi = simTop.
    const edge = vernierBand(5, 900, 1000)
    expect(edge.hi).toBeCloseTo(1000)
    expect(edge.f0).toBeCloseTo(1000 - 1023 * 0.5)
    // Near zero: pinned at 0.
    const lo = vernierBand(5, 10, 1000)
    expect(lo.f0).toBe(0)
  })

  it('pans the view inside the current band when the centred window fits (RES)', () => {
    const c = cfg({ f0: 0, fBin: 0.5, bandHz: 512 })
    const view = { lo: 0, hi: 200 }
    const p = planCenter({ hz: 100, cfg: c, view, bandOn: false, res: 5, simTopHz: 1000 })
    expect(p.kind).toBe('view')
    expect(p.gram).toBeNull()
    expect(p.hz).toBe(100)
    expect(p.view.lo).toBeCloseTo(0)
    expect(p.view.hi).toBeCloseTo(200)
    // Near the band edge with a window that still fits → view-only pan (clamped).
    const edge = planCenter({ hz: 450, cfg: c, view: { lo: 400, hi: 500 }, bandOn: false, res: 5, simTopHz: 1000 })
    expect(edge.kind).toBe('view')
    expect(edge.gram).toBeNull()
    expect(edge.view.lo).toBeGreaterThanOrEqual(0)
    expect(edge.view.hi).toBeLessThanOrEqual(c.f0 + 1023 * 0.5 + 1e-6)
  })

  it('retunes the vernier through a handoff when the window cannot fit the current band', () => {
    // Vernier already on ~50 Hz (f0≈0 at RES 2 would be different); use a narrow vernier window away from target.
    const c = cfg({ res: 5, f0: 0, fBin: 0.5, bandHz: 512, fcHz: 256 })
    const p = planCenter({ hz: 700, cfg: c, view: { lo: 100, hi: 200 }, bandOn: false, res: 5, simTopHz: 1000 })
    expect(p.kind).toBe('vernier')
    expect(p.gram).toEqual({ res: 5, vernierHz: 700 })
    const b = vernierBand(5, 700, 1000)
    expect(p.view.lo).toBeGreaterThanOrEqual(b.f0 - 1e-6)
    expect(p.view.hi).toBeLessThanOrEqual(b.hi + 1e-6)
  })

  it('leaves a band-preset gram for RES at the saved level with the vernier on hz', () => {
    const c = cfg({ res: undefined, bandPreset: 'LF', fBin: 500 / 2048, bins: 2048, f0: 0, bandHz: undefined })
    const p = planCenter({ hz: 123.4, cfg: c, view: { lo: 0, hi: 500 }, bandOn: true, res: 5, simTopHz: 1000 })
    expect(p.kind).toBe('band→res')
    expect(p.gram).toEqual({ res: 5, vernierHz: 123.4, band: null })
    expect(p.hz).toBe(123.4)
  })

  it('clamps junk and empty configs to a no-op', () => {
    expect(planCenter({ hz: NaN, cfg: cfg(), view: { lo: 0, hi: 100 }, bandOn: false, res: 5, simTopHz: 1000 }).kind).toBe('none')
    expect(planCenter({ hz: 50, cfg: undefined, view: { lo: 0, hi: 100 }, bandOn: false, res: 5, simTopHz: 1000 }).kind).toBe('none')
    expect(planCenter({ hz: -20, cfg: cfg(), view: { lo: 0, hi: 100 }, bandOn: false, res: 5, simTopHz: 1000 }).hz).toBe(0)
    expect(planCenter({ hz: 5000, cfg: cfg(), view: { lo: 0, hi: 100 }, bandOn: false, res: 5, simTopHz: 1000 }).hz).toBe(1000)
  })

  it('formats CTR and parses typed Hz', () => {
    expect(ctrLabel(123.4, 0.5)).toBe('CTR 123.4 Hz')
    expect(ctrLabel(12.34, 0.05)).toMatch(/^CTR 12\.34 Hz$/)
    expect(ctrLabel(NaN)).toBe('CTR —')
    expect(parseHz('123.4')).toBe(123.4)
    expect(parseHz('1.2k')).toBe(1200)
    expect(parseHz(' 50 Hz ')).toBe(50)
    expect(parseHz('nope')).toBeNaN()
  })

  it('centers a window of the given span inside [lo, hi]', () => {
    expect(centerView(50, 20, 0, 100)).toEqual({ lo: 40, hi: 60 })
    expect(centerView(5, 20, 0, 100)).toEqual({ lo: 0, hi: 20 })
  })
})
