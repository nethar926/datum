import { describe, expect, it, beforeEach } from 'vitest'
import {
  DEFAULT_RADIUS_M, DEFAULT_RADIUS_NMI, FRAME_BUDGET_S, MAX_POINTS, MIN_POINTS, NAV_CAP, TRAIL_CAP,
  PlaneTrail, loadNavStyle, loadTrailStyle, measurePlaneFrame, planeAvoidsCrease, planeMenuFrame,
  planeNavPoints, planePose, enginePlaneSource, glyphRotationRad, DEFAULT_MAX_TURN_RATE_RAD_S, resetPlaneForTests, resetPlaneStylesForTests,
  routeIsReady, saveNavStyle, saveTrailStyle, type PlaneRouteSpec,
} from './planeRoute'

beforeEach(() => { resetPlaneForTests(); resetPlaneStylesForTests() })

function circle(t0 = 0): PlaneRouteSpec {
  return {
    mode: 'circle', speedMps: 210 * 1852 / 3600, altitudeFt: 1476, t0,
    centerX: 0, centerY: 0, radiusM: DEFAULT_RADIUS_M, phase0: 0, points: [],
  }
}
function figure8(t0 = 0): PlaneRouteSpec {
  return {
    mode: 'figure8', speedMps: 210 * 1852 / 3600, altitudeFt: 1476, t0,
    centerX: 1000, centerY: -500, radiusM: DEFAULT_RADIUS_M, phase0: 0, points: [],
  }
}
function p2p(t0 = 0): PlaneRouteSpec {
  return {
    mode: 'pointToPoint', speedMps: 210 * 1852 / 3600, altitudeFt: 1476, t0,
    centerX: 0, centerY: 0, radiusM: DEFAULT_RADIUS_M, phase0: 0,
    points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }],
  }
}

describe('plane route', () => {
  it('defaults radius in nMi and requires 2 to 10 point-to-point points', () => {
    expect(DEFAULT_RADIUS_NMI).toBe(4)
    expect(DEFAULT_RADIUS_M).toBe(4 * 1852)
    expect(MIN_POINTS).toBe(2)
    expect(MAX_POINTS).toBe(10)
    const ready = p2p()
    expect(routeIsReady(ready)).toBe(true)
    expect(routeIsReady({ ...ready, points: [{ x: 0, y: 0 }] })).toBe(false)
    expect(routeIsReady({ ...ready, points: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 })) })).toBe(false)
  })

  it('gives pose as a pure function of sim time and never integrates', () => {
    const spec = circle()
    const t = 12
    const a = planePose(spec, t)
    const b = planePose(spec, t)
    expect(a).toEqual(b)
    planePose(spec, 0)
    planePose(spec, 3)
    expect(planePose(spec, t)).toEqual(a)
  })

  it('holds continuity at 1x, 4x and 16x with 30 fps sampling', () => {
    for (const spec of [circle(), figure8(), p2p()]) {
      const t = 20
      const expected = planePose(spec, t)
      for (const rate of [1, 4, 16]) {
        const dt = rate / 30
        let steps = 0
        for (let k = 0; k * dt <= t; k++) { planePose(spec, k * dt); steps++ }
        const sampled = planePose(spec, t)
        expect(sampled.x).toBeCloseTo(expected.x, 9)
        expect(sampled.y).toBeCloseTo(expected.y, 9)
        expect(sampled.headingRad).toBeCloseTo(expected.headingRad, 9)
        expect(steps).toBeGreaterThan(10)
      }
    }
  })

  it('caps the trail ring and fades oldest-first', () => {
    const trail = new PlaneTrail(8)
    for (let i = 0; i < 20; i++) trail.push(i, i * 2)
    expect(trail.count).toBe(8)
    expect(trail.capacity).toBe(8)
    const oldest = { x: 0, y: 0 }, newest = { x: 0, y: 0 }
    trail.point(0, oldest)
    trail.point(7, newest)
    expect(oldest.x).toBe(12)
    expect(newest.x).toBe(19)
    expect(PlaneTrail.fade(0, 8)).toBe(0)
    expect(PlaneTrail.fade(7, 8)).toBe(1)
    const big = new PlaneTrail()
    for (let i = 0; i < TRAIL_CAP + 50; i++) big.push(i, 0)
    expect(big.count).toBe(TRAIL_CAP)
    const a = { x: 0, y: 0 }, b = { x: 0, y: 0 }
    big.point(0, a)
    big.point(TRAIL_CAP - 1, b)
    expect(a.x).toBe(50)
    expect(b.x).toBe(TRAIL_CAP + 49)
  })

  it('persists trail and nav styles and keeps the menu off the hinge crease', () => {
    saveTrailStyle({ pattern: 'dotted', weight: 'thick' })
    expect(loadTrailStyle()).toEqual({ pattern: 'dotted', weight: 'thick' })
    saveNavStyle({ pattern: 'solid', weight: 'thick' })
    expect(loadNavStyle()).toEqual({ pattern: 'solid', weight: 'thick' })
    const plot = { x: 0, y: 0, width: 400, height: 600 }
    const frame = planeMenuFrame(50, 50, plot)!
    expect(frame.x).toBeGreaterThanOrEqual(plot.x)
    expect(frame.x + frame.width).toBeLessThanOrEqual(plot.x + plot.width)
    const crease = { x: 300, y: 0, width: 24, height: 600 }
    const clipped = planeMenuFrame(310, 200, plot, crease)!
    expect(planeAvoidsCrease(clipped, crease)).toBe(true)
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(crease.x)
  })

  it('uses the seam to fill nav into a preallocated buffer starting at the current pose', () => {
    const spec = circle()
    const t = 5
    const a = enginePlaneSource.pose(spec, t)
    expect(a).toEqual(planePose(spec, t))
    const xs = new Float64Array(NAV_CAP)
    const ys = new Float64Array(NAV_CAP)
    const n = enginePlaneSource.navPoints(spec, t, xs, ys)
    expect(n).toBe(NAV_CAP)
    expect(xs.length).toBe(NAV_CAP)
    expect(xs[0]).toBeCloseTo(a.x, 9)
    expect(ys[0]).toBeCloseTo(a.y, 9)
  })

  it('keeps 64-buoy CPU work under the 30 fps budget at 1x, 4x and 16x with a capped trail', () => {
    for (const rate of [1, 4, 16]) {
      const r = measurePlaneFrame(64, 30, rate)
      expect(r.trailCount).toBe(TRAIL_CAP)
      expect(r.marks).toBeGreaterThan(64)
      expect(r.seconds).toBeLessThan(FRAME_BUDGET_S)
    }
  })

  it('rotates the north-pointing chevron by heading alone', () => {
    expect(glyphRotationRad(0)).toBe(0)
    expect(glyphRotationRad(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12)
    expect(DEFAULT_MAX_TURN_RATE_RAD_S).toBeCloseTo(15 * Math.PI / 180, 12)
  })

  it('matches native pose goldens at t = 20 s (Sonya 9746fda)', () => {
    const cases: [ReturnType<typeof circle>, number, number, number][] = [
      [circle(), 2130.1622536855925, 7095.1302153641345, 1.8624629934615633],
      [figure8(), 3130.1622536855925, -187.13021536413464, 1.27912966012823],
      [p2p(), 1996.8605598172558, 361.8517452642101, 0.12343043289495492],
    ]
    const speed = 210 * 1852 / 3600
    const alt = 1476 * 0.3048
    for (const [spec, x, y, hdg] of cases) {
      const p = planePose(spec, 20)
      expect(p.x).toBeCloseTo(x, 9)
      expect(p.y).toBeCloseTo(y, 9)
      expect(p.headingRad).toBeCloseTo(hdg, 9)
      expect(p.altM).toBeCloseTo(alt, 9)
      expect(p.speedMps).toBeCloseTo(speed, 9)
    }
  })
})
