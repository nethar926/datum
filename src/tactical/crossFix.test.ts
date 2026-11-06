import { describe, expect, it } from 'vitest'
import {
  BEARING_SIGMA_DEG, MIN_CROSS_DEG, covarianceEllipse, crossingAngleDeg, fitLeg, freshRays,
  intersect2, leastSquaresFix, parallelRejectMessage,
} from './crossFix'

describe('crossingAngleDeg', () => {
  it('returns the acute angle between bearings', () => {
    expect(crossingAngleDeg(0, 90)).toBe(90)
    expect(crossingAngleDeg(10, 40)).toBe(30)
    expect(crossingAngleDeg(0, 170)).toBe(10)
    expect(crossingAngleDeg(350, 10)).toBe(20)
  })
})

describe('intersect2', () => {
  it('matches a hand-calc cross of E-bound and N-bound rays', () => {
    // Buoy A at (0,0) looking 090° (east); buoy B at (1000,1000) looking 180° (south).
    // Intersection at (1000, 0).
    const a = { buoyId: 1, x: 0, y: 0, brgDeg: 90 }
    const b = { buoyId: 2, x: 1000, y: 1000, brgDeg: 180 }
    const r = intersect2(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.x).toBeCloseTo(1000, 6)
    expect(r.y).toBeCloseTo(0, 6)
    expect(r.crossDeg).toBeCloseTo(90, 6)
  })

  it('rejects near-parallel cuts under ~15°', () => {
    const a = { buoyId: 1, x: 0, y: 0, brgDeg: 45 }
    const b = { buoyId: 2, x: 100, y: 0, brgDeg: 45 + (MIN_CROSS_DEG - 1) }
    const r = intersect2(a, b)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('parallel')
    expect(r.crossDeg).toBeLessThan(MIN_CROSS_DEG)
    expect(parallelRejectMessage(r.crossDeg)).toMatch(/too shallow/i)
  })

  it('rejects an intersection behind a buoy', () => {
    // A looks north; B looks west — geometric cross sits south of A (behind its ray).
    const a = { buoyId: 1, x: 0, y: 0, brgDeg: 0 }
    const b = { buoyId: 2, x: 1000, y: -500, brgDeg: 270 }
    const r = intersect2(a, b)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('behind')
  })
})

describe('leastSquaresFix', () => {
  it('recovers a known point from three noisy bearings', () => {
    // Geometry keeps every pairwise cut well above MIN_CROSS_DEG.
    const truth = { x: 2000, y: 2000 }
    const buoys = [
      { buoyId: 1, x: 0, y: 0 },
      { buoyId: 2, x: 4000, y: 0 },
      { buoyId: 3, x: 2000, y: -2000 },
    ]
    const noise = [0.4, -0.3, 0.2] // deg
    const rays = buoys.map((b, i) => {
      const dx = truth.x - b.x, dy = truth.y - b.y
      const trueBrg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
      return { ...b, brgDeg: trueBrg + noise[i] }
    })
    const r = leastSquaresFix(rays)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.fix.x - truth.x)).toBeLessThan(30)
    expect(Math.abs(r.fix.y - truth.y)).toBeLessThan(30)
    expect(r.fix.n).toBe(3)
    expect(r.fix.residualM).toBeLessThan(50)
  })

  it('rejects parallel groups', () => {
    const rays = [
      { buoyId: 1, x: 0, y: 0, brgDeg: 30 },
      { buoyId: 2, x: 500, y: 100, brgDeg: 35 },
    ]
    const r = leastSquaresFix(rays)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('parallel')
  })
})

describe('covarianceEllipse', () => {
  it('returns major ≥ minor and a finite orientation', () => {
    const fix = { x: 2000, y: 1000 }
    const rays = [
      { buoyId: 1, x: 0, y: 0, brgDeg: 63.43, sigmaDeg: BEARING_SIGMA_DEG },
      { buoyId: 2, x: 4000, y: 0, brgDeg: 333.43, sigmaDeg: BEARING_SIGMA_DEG },
    ]
    const e = covarianceEllipse(rays, fix)
    expect(e).not.toBeNull()
    if (!e) return
    expect(e.semiMajorM).toBeGreaterThanOrEqual(e.semiMinorM)
    expect(e.semiMajorM).toBeGreaterThan(10)
    expect(e.semiMinorM).toBeGreaterThan(1)
    expect(e.orientDeg).toBeGreaterThanOrEqual(0)
    expect(e.orientDeg).toBeLessThan(360)
  })

  it('grows the major axis when the cut is shallower', () => {
    const fix = { x: 3000, y: 0 }
    const steep = covarianceEllipse([
      { buoyId: 1, x: 0, y: -2000, brgDeg: 56.31 },
      { buoyId: 2, x: 0, y: 2000, brgDeg: 123.69 },
    ], fix)!
    const shallow = covarianceEllipse([
      { buoyId: 1, x: 0, y: -500, brgDeg: 9.46 },
      { buoyId: 2, x: 0, y: 500, brgDeg: 170.54 },
    ], fix)!
    expect(shallow.semiMajorM).toBeGreaterThan(steep.semiMajorM)
  })
})

describe('fitLeg', () => {
  it('recovers a known CSE/SPD within tolerance', () => {
    // Contact steaming 045°T at 8 kt ≈ 4.1156 m/s. Start at (0,0) at t=0.
    const cse = 45, spdKts = 8
    const spdMps = spdKts * 1852 / 3600
    const vx = Math.sin(cse * Math.PI / 180) * spdMps
    const vy = Math.cos(cse * Math.PI / 180) * spdMps
    const fixes = [0, 60, 120, 180].map((tS) => ({ x: vx * tS, y: vy * tS, tS }))
    const leg = fitLeg(fixes)
    expect(leg).not.toBeNull()
    if (!leg) return
    expect(leg.cseDeg).toBeCloseTo(cse, 0) // within 0.5°
    expect(leg.spdKts).toBeCloseTo(spdKts, 1) // within 0.05 kt via digits
    expect(Math.abs(leg.spdKts - spdKts)).toBeLessThan(0.1)
    expect(leg.n).toBe(4)
  })

  it('needs at least two distinct times', () => {
    expect(fitLeg([{ x: 0, y: 0, tS: 10 }])).toBeNull()
    expect(fitLeg([{ x: 0, y: 0, tS: 10 }, { x: 0, y: 0, tS: 10 }])).toBeNull()
  })
})

describe('freshRays', () => {
  it('keeps only live DIFAR bearings inside the freshness window', () => {
    const buoys = [
      { id: 1, x: 0, y: 0, kind: 'difar', state: 'live' },
      { id: 2, x: 1, y: 0, kind: 'difar', state: 'live' },
      { id: 3, x: 2, y: 0, kind: 'omni', state: 'live' },
      { id: 4, x: 3, y: 0, kind: 'difar', state: 'dead' },
    ]
    const manual = { 1: 90, 2: 180, 3: 10, 4: 45 }
    const ages = { 1: 100, 2: 50, 3: 100, 4: 100 } // simT=200 → #2 is stale at window 120
    const rays = freshRays(manual, ages, buoys, 200, 120)
    expect(rays.map((r) => r.buoyId)).toEqual([1])
    const rays2 = freshRays(manual, { 1: 100, 2: 150 }, buoys, 200, 120)
    expect(rays2.map((r) => r.buoyId).sort()).toEqual([1, 2])
  })
})
