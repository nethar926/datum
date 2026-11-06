import { describe, expect, it } from 'vitest'
import { doppler, fitCpaFromDoppler } from '@acoustics'
import {
  C_MPS, KNEE, MAX_SPEED_MPS, MIN_DT_S, MPS_TO_KT, RulerStore, clampOff, dragF1, dragF2, emptyRuler, fitRuler, halfGeom, kneeDfHz,
  mirror, moveF0, passHz, placeRuler, relink, rulerGeom, rulerHz, rulerText, sampleRuler,
} from './dopplerRuler'

const KT10 = 10 / MPS_TO_KT
/** Exact Urick received frequency for a straight pass (stationary receiver), the closed form the engine uses. */
const urickPass = (fs: number, v: number, r: number, tc: number, t: number) => {
  const along = v * (t - tc), d = Math.hypot(r, along)
  return doppler(fs, d > 0 ? (-v * along) / d : 0)
}
/** Ruler placed from a known pass: f0 at CPA, f1 at the knee time on the approach leg. */
const rulerFor = (fs: number, v: number, r: number, tc: number) => {
  const tau = r / v, dt = (tau * KNEE) / Math.sqrt(1 - KNEE * KNEE)
  return placeRuler(emptyRuler(), fs, tc, passHz(fs, tc, v, tau, tc - dt) - fs, dt)
}

describe('Doppler ruler curve (Urick, first order in v/c)', () => {
  it('is antisymmetric about (tCPA, f0)', () => {
    const s = rulerFor(100, KT10, 1200, 600)
    for (const d of [1, 10, 60, 300, 3000]) expect(rulerHz(s, 600 + d) - 100).toBeCloseTo(-(rulerHz(s, 600 - d) - 100), 12)
    expect(rulerHz(s, 600)).toBe(100)
  })
  it('asymptotes to f0(1 ± v/c): ~±0.34 Hz for a 100 Hz line at 10 kt (no exaggeration)', () => {
    const s = rulerFor(100, KT10, 1200, 600)
    const up = rulerHz(s, 600 - 1e6) - 100, dn = rulerHz(s, 600 + 1e6) - 100
    expect(up).toBeCloseTo((100 * KT10) / C_MPS, 6)
    expect(up).toBeCloseTo(0.343, 3)
    expect(dn).toBeCloseTo(-0.343, 3)
    expect(rulerGeom(s).dfAsymHz).toBeCloseTo(0.343, 3)
  })
  it('is monotonic (falls through CPA) and steepest at CPA with slope f0·v²/(c·R)', () => {
    const s = rulerFor(200, 6, 900, 300), n = 101, t = new Float64Array(n), f = new Float64Array(n)
    expect(sampleRuler(s, 0, 600, t, f)).toBe(n)
    for (let k = 1; k < n; k++) expect(f[k]).toBeLessThan(f[k - 1])
    const h = 0.01, slope = (rulerHz(s, 300 + h) - rulerHz(s, 300 - h)) / (2 * h)
    expect(slope).toBeCloseTo((-200 * 6 * 6) / (C_MPS * 900), 8)
  })
  it('stays within second order of the exact Urick form', () => {
    const s = rulerFor(150, 8, 2000, 500)
    let worst = 0
    for (let t = 0; t <= 1000; t += 5) worst = Math.max(worst, Math.abs(rulerHz(s, t) - urickPass(150, 8, 2000, 500, t)))
    expect(worst).toBeLessThan(150 * (8 / C_MPS) ** 2 * 1.5)
  })
})

describe('handles', () => {
  it('v = c·Δf/(KNEE·f0) ≈ c·Δf/f0 and R = v·Δt·√(1−K²)/K', () => {
    const df = kneeDfHz(100, KT10)
    const g = halfGeom(100, df, 40)
    expect(g.speedMps).toBeCloseTo(KT10, 10)
    expect(g.speedMps / ((C_MPS * df) / 100)).toBeCloseTo(1 / KNEE, 10)
    expect(g.rCpaM).toBeCloseTo((KT10 * 40 * Math.sqrt(1 - KNEE ** 2)) / KNEE, 8)
  })
  it('f2 mirrors f1 about f0 (same Δf below, same Δt after) and the curve passes through all three', () => {
    const s = placeRuler(emptyRuler(), 120, 400, 0.3, 50)
    dragF1(s, 120.25, 330)
    expect(s.f2Hz).toBeCloseTo(120 - 0.25, 12); expect(s.t2S).toBeCloseTo(470, 12)
    expect(rulerHz(s, s.t1S)).toBeCloseTo(s.f1Hz, 10)
    expect(rulerHz(s, s.t2S)).toBeCloseTo(s.f2Hz, 10)
    expect(rulerHz(s, s.tCpaS)).toBeCloseTo(s.f0Hz, 12)
    moveF0(s, 121, 410)
    expect([s.f1Hz, s.t1S, s.f2Hz, s.t2S].map((x) => +x.toFixed(9))).toEqual([121.25, 340, 120.75, 480])
  })
  it('f1 drags freely in both axes; f2 is the point-mirror through (f0, tCPA)', () => {
    // Drag f1 by (−0.2 Hz, +30 s) relative to centre → f2 at (+0.2 Hz, −30 s).
    const s = placeRuler(emptyRuler(), 100, 400, 0.3, 50)
    dragF1(s, 100 - 0.2, 400 + 30)
    expect(s.f1Hz - s.f0Hz).toBeCloseTo(-0.2, 12)
    expect(s.t1S - s.tCpaS).toBeCloseTo(30, 12)
    expect(s.f2Hz - s.f0Hz).toBeCloseTo(+0.2, 12)
    expect(s.t2S - s.tCpaS).toBeCloseTo(-30, 12)
    expect(s.linked).toBe(true)
    // Geometry uses |Δf| / |Δt|, so the readout matches the approach-side seed of the same magnitudes.
    const g = rulerGeom(s)
    expect(g.speedMps).toBeCloseTo(halfGeom(100, 0.2, 30).speedMps, 12)
    expect(g.rCpaM).toBeCloseTo(halfGeom(100, 0.2, 30).rCpaM, 12)
  })
  it('dragging f2 mirrors f1 (and the readout does not depend on which handle moved)', () => {
    const a = placeRuler(emptyRuler(), 100, 400, 0.25, 40)
    const b = placeRuler(emptyRuler(), 100, 400, 0.25, 40)
    dragF1(a, 100 + 0.4, 400 - 60)
    dragF2(b, 100 - 0.4, 400 + 60) // the point-mirror of a's f1
    expect(b.linked).toBe(true)
    expect(b.f1Hz).toBeCloseTo(a.f1Hz, 12); expect(b.t1S).toBeCloseTo(a.t1S, 12)
    expect(b.f2Hz).toBeCloseTo(a.f2Hz, 12); expect(b.t2S).toBeCloseTo(a.t2S, 12)
    expect(rulerGeom(a).speedMps).toBeCloseTo(rulerGeom(b).speedMps, 12)
    expect(rulerGeom(a).rCpaM).toBeCloseTo(rulerGeom(b).rCpaM, 12)
    expect(rulerText(true, rulerGeom(a), true, 0.0625)).toBe(rulerText(true, rulerGeom(b), true, 0.0625))
  })
  it('clamps |Δf| to MAX_SPEED and |Δt| to MIN_DT_S on either side of the centre', () => {
    const s = placeRuler(emptyRuler(), 100, 400, 0.3, 50)
    dragF1(s, 100, 400) // dead centre → pushed out to min |Δf| / |Δt|
    expect(Math.abs(s.f1Hz - 100)).toBeGreaterThan(0)
    expect(Math.abs(s.t1S - 400)).toBe(MIN_DT_S)
    dragF1(s, 150, 300)
    expect(halfGeom(100, s.f1Hz - 100, s.t1S - 400).speedMps).toBeCloseTo(MAX_SPEED_MPS, 8)
    // Legacy unlink path still re-links via relink().
    s.linked = false; s.f2Hz = 99.5; s.t2S = 480
    relink(s)
    expect(s.linked).toBe(true); expect(s.f2Hz).toBeCloseTo(2 * 100 - s.f1Hz, 12)
    expect(mirror({ ...s }).f2Hz).toBeCloseTo(s.f2Hz, 12)
  })
})

describe('fit', () => {
  it('handles laid on a synthetic Urick pass read back the known speed, CPA time and range', () => {
    for (const [fs, v, r, tc] of [[100, KT10, 1500, 600], [240, 3, 800, 200], [60, 9, 4000, 1000]]) {
      const s = rulerFor(fs, v, r, tc), g = rulerGeom(s)
      expect(g.speedMps).toBeCloseTo(v, 9); expect(g.rCpaM).toBeCloseTo(r, 6); expect(g.tCpaS).toBe(tc)
    }
  })
  it('fitCpaFromDoppler on the exact Urick pass and on the drawn ruler agree with the truth', () => {
    const fs = 100, v = KT10, r = 1500, tc = 600
    const smp = Array.from({ length: 41 }, (_, k) => ({ tS: k * 30, fHz: urickPass(fs, v, r, tc, k * 30) }))
    const truthFit = fitCpaFromDoppler(smp)
    expect(truthFit.ok).toBe(true)
    expect(truthFit.speed).toBeCloseTo(v, 1); expect(Math.abs(truthFit.tCPA - tc)).toBeLessThan(2); expect(Math.abs(truthFit.rCPA - r) / r).toBeLessThan(0.03)
    const fr = fitRuler(rulerFor(fs, v, r, tc), fitCpaFromDoppler)!
    expect(fr.ok).toBe(true)
    expect(Math.abs(fr.speedMps - v) / v).toBeLessThan(0.02); expect(Math.abs(fr.tCpaS - tc)).toBeLessThan(2); expect(Math.abs(fr.rCpaM - r) / r).toBeLessThan(0.05)
  })
  it('readout shows f0, Δf, speed in kt, CPA time and range', () => {
    const s = rulerFor(100, KT10, 1500, 754)
    const t = rulerText(true, rulerGeom(s), true, 0.0625)
    expect(t).toBe('DOP F0 100.00 HZ  ΔF ±0.343 HZ  10.0 KT  CPA T+12:34  R≈1.50 KM')
    expect(rulerText(false, rulerGeom(s), true, 1)).toMatch(/PLACE F0/)
  })
})

describe('RulerStore', () => {
  it('tap places f0 with f1 seeded at ~10 kt, a second tap moves the ruler, nudge and clear work', () => {
    const st = new RulerStore(fitCpaFromDoppler)
    st.m = { ...st.m, heightPx: 400, historyS: 300, hzPerPx: 0.01, fBin: 0.0625 }
    st.tap(100, 500)
    expect(st.placed).toBe(true); expect(st.sel).toBe('f1')
    expect(st.geom.speedMps * MPS_TO_KT).toBeCloseTo(10, 6)
    expect(st.s.tCpaS - st.s.t1S).toBeCloseTo(45, 6) // 60 px of a 400 px / 300 s gram (> 12 % of history)
    st.tap(101, 520)
    expect(st.s.f0Hz).toBe(101); expect(st.s.f1Hz - st.s.f0Hz).toBeCloseTo(kneeDfHz(100, KT10), 9)
    const f1 = st.s.f1Hz
    st.nudge(10, 0)
    expect(st.s.f1Hz).toBeCloseTo(f1 + 0.1, 9); expect(st.s.f2Hz).toBeCloseTo(2 * 101 - st.s.f1Hz, 9)
    // Nudging f2 by −10 px mirrors onto f1 (+10 px) and stays linked; |Δf| (hence speed) is unchanged when the
    // opposite handle is moved by the same pixel amount the other way from a symmetric start — here we just
    // check linkage and that f1 moved as the mirror of f2.
    const f2 = st.s.f2Hz
    st.select('f2'); st.nudge(-10, 0)
    expect(st.s.linked).toBe(true)
    expect(st.s.f2Hz).toBeCloseTo(f2 - 0.1, 9)
    expect(st.s.f1Hz).toBeCloseTo(2 * 101 - st.s.f2Hz, 9)
    st.clear(); expect(st.placed).toBe(false)
  })
})
