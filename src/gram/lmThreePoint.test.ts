import { describe, expect, it } from 'vitest'
import { striationHz } from './lloyds'
import {
  LM_ASSUMPTION, applySlide, emptyLmThreePoint, evaluateLmThreePoint, fitIdealPass,
  lmFitWarns, lmThreePointText, nextLmPointRole, placeLmPoint,
} from './lmThreePoint'

describe('ideal-pass 3-point fit', () => {
  const k = 40, tCpa = 100, tau = 200
  const s = { k, tCpaS: tCpa, tauS: tau }
  const p1 = { tS: tCpa, fHz: striationHz(s, 1, tCpa) }
  const p2 = { tS: tCpa + 80, fHz: striationHz(s, 1, tCpa + 80) }
  const p3 = { tS: tCpa + 160, fHz: striationHz(s, 1, tCpa + 160) }

  it('recovers K, tCPA, τ from three ideal points', () => {
    const geo = fitIdealPass([p1, p2, p3])!
    expect(geo.k).toBeCloseTo(k, 6)
    expect(geo.tCpaS).toBeCloseTo(tCpa, 6)
    expect(geo.tauS).toBeCloseTo(tau, 0) // refined with p3 average
    expect(geo.residualRms).toBeLessThan(0.05)
    expect(geo.fringeDeviation).toBeLessThan(0.01)
  })

  it('slide adjusts K and tCPA', () => {
    const slid = applySlide({ k, tCpaS: tCpa, tauS: tau }, 2, -5)
    expect(slid.k).toBeCloseTo(42)
    expect(slid.tCpaS).toBeCloseTo(95)
  })

  it('good fit exposes estimates; assumption string present', () => {
    const st = { points: [p1, p2, p3], slideK: 0, slideTCpaS: 0 }
    const fit = evaluateLmThreePoint(st, { zrM: 40, rCpaM: 2000, speedMps: 10 })
    expect(fit.ok).toBe(true)
    expect(fit.warn).toBe(false)
    expect(fit.warning).toBeNull()
    expect(Number.isFinite(fit.depthRatio) || Number.isFinite(fit.zsM)).toBe(true)
    expect(lmThreePointText(fit)).toContain(LM_ASSUMPTION)
  })

  it('poor fit warns and withholds range/depth/speed (no truth)', () => {
    // Scramble point 3 so residual / deviation blow the gates.
    const bad = { points: [p1, p2, { tS: tCpa + 160, fHz: p3.fHz * 3 }], slideK: 0, slideTCpaS: 0 }
    const fit = evaluateLmThreePoint(bad, { zrM: 40, rCpaM: 2000, speedMps: 10 })
    expect(fit.warn).toBe(true)
    expect(fit.warning).toMatch(/POOR|withheld/i)
    expect(Number.isFinite(fit.zsM)).toBe(false)
    expect(Number.isFinite(fit.rCpaM)).toBe(false)
    expect(Number.isFinite(fit.speedMps)).toBe(false)
    expect(lmThreePointText(fit)).toContain(LM_ASSUMPTION)
  })
})

describe('lmFitWarns gating', () => {
  it('trips on residual or fringe deviation only', () => {
    expect(lmFitWarns(0.5, 0.01)).toBe(false)
    expect(lmFitWarns(20, 0.01)).toBe(true)
    expect(lmFitWarns(0.5, 0.5)).toBe(true)
    expect(lmFitWarns(NaN, 0)).toBe(true)
  })
})

describe('placement helpers', () => {
  it('places up to 3 then restarts', () => {
    let st = emptyLmThreePoint()
    st = placeLmPoint(st, { tS: 1, fHz: 10 })
    st = placeLmPoint(st, { tS: 2, fHz: 12 })
    st = placeLmPoint(st, { tS: 3, fHz: 14 })
    expect(st.points).toHaveLength(3)
    st = placeLmPoint(st, { tS: 9, fHz: 20 })
    expect(st.points).toEqual([{ tS: 9, fHz: 20 }])
  })
  it('roles follow turning → peak → shallow → slide', () => {
    expect(nextLmPointRole(0)).toBe('turning')
    expect(nextLmPointRole(1)).toBe('peak')
    expect(nextLmPointRole(2)).toBe('shallow')
    expect(nextLmPointRole(3)).toBe('slide')
  })
})
