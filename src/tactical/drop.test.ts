import { describe, expect, it } from 'vitest'
import { planPattern } from '@acoustics'
import {
  AUTO_LINE_M, AUTO_RING_M, COUNT_RANGE, DEFAULT_COUNT, DEFAULT_EXTENT_M, DROP_PATTERNS, EXTENT_RANGE_M, autoPlacement, bearingDeg,
  gesturePlacement, planDrop, planReadout, snapDeg, snapM, snapPt, type DropPlan, type Pt,
} from './drop'
import { AUTO_COOLDOWN_S, AUTO_GAP_M, MAX_BUOYS, autoShouldLay, dropCapturesPlot, dropHint, dropHintShort, dropReducer, initialDrop, type DropState } from './fieldMode'

const pts = (p: DropPlan): Pt[] => Array.from({ length: p.n }, (_, i) => ({ x: p.xy[2 * i], y: p.xy[2 * i + 1] }))
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const centroid = (ps: Pt[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length })
/** Drag end at a bearing/range from a start. */
const at = (s: Pt, brg: number, r: number): Pt => ({ x: s.x + r * Math.sin((brg * Math.PI) / 180), y: s.y + r * Math.cos((brg * Math.PI) / 180) })

describe('snapping', () => {
  it('snaps position to 100 m, bearing to 5° (0..360) and extent to 100 m', () => {
    expect(snapPt({ x: 1234, y: -1260 })).toEqual({ x: 1200, y: -1300 })
    expect(snapDeg(92.4)).toBe(90); expect(snapDeg(357.6)).toBe(0); expect(snapDeg(-2.6)).toBe(355); expect(snapDeg(47.5)).toBe(50)
    expect(snapM(3149)).toBe(3100); expect(snapM(3150)).toBe(3200)
  })
  it('a drag snaps the gesture: start on the grid, bearing and extent quantised, clamped to the extent range', () => {
    const p = gesturePlacement('circle', { x: 1033, y: 970 }, at({ x: 1000, y: 1000 }, 61.7, 2530))
    expect(p.center).toEqual({ x: 1000, y: 1000 }); expect(p.bearingDeg).toBe(60); expect(p.extentM).toBe(2500); expect(p.dragged).toBe(true)
    expect(gesturePlacement('line', { x: 0, y: 0 }, { x: 0, y: 50 }).extentM).toBe(EXTENT_RANGE_M[0])
    expect(gesturePlacement('line', { x: 0, y: 0 }, { x: 0, y: 90000 }).extentM).toBe(EXTENT_RANGE_M[1])
  })
})

describe('pattern geometry (planPattern + gesture transform)', () => {
  it('uses the engine planner counts and receiver types for each pattern', () => {
    for (const pat of DROP_PATTERNS) {
      const plan = planDrop(gesturePlacement(pat, { x: 0, y: 0 }, null))
      expect(plan.n).toBe(DEFAULT_COUNT[pat])
      expect(plan.kinds).toHaveLength(plan.n); expect(plan.channels).toHaveLength(plan.n)
      expect(plan.kinds.every((k) => k === (pat === 'circle' || pat === 'field' ? 'omni' : 'difar'))).toBe(true)
    }
    expect([DEFAULT_COUNT.line, DEFAULT_COUNT.circle, DEFAULT_COUNT.field, DEFAULT_COUNT.wedge, DEFAULT_COUNT.single]).toEqual([5, 6, 9, 5, 1])
  })

  it('line: drawn end to end, evenly spaced along the drag bearing; tap = 8 km east–west, centred', () => {
    const s = { x: -2000, y: 1000 }, plan = planDrop(gesturePlacement('line', s, at(s, 32, 6000)))
    const p = pts(plan)
    expect(plan.bearingDeg).toBe(30); expect(plan.extentM).toBe(6000); expect(plan.spacingM).toBeCloseTo(1500, 6)
    const ends = [p[0], p[p.length - 1]].sort((a, b) => dist(a, s) - dist(b, s))
    expect(dist(ends[0], s)).toBeLessThan(1e-6)
    expect(dist(ends[1], at(s, 30, 6000))).toBeLessThan(1e-6)
    for (let i = 1; i < p.length; i++) { expect(dist(p[i], p[i - 1])).toBeCloseTo(1500, 6); expect(Math.abs(bearingDeg(p[i - 1], p[i]) - 30) % 180).toBeLessThan(1e-6) }
    const tap = pts(planDrop(gesturePlacement('line', { x: 0, y: 0 }, null)))
    expect(centroid(tap).x).toBeCloseTo(0, 6); expect(tap.every((q) => Math.abs(q.y) < 1e-6)).toBe(true)
    expect(Math.max(...tap.map((q) => q.x)) - Math.min(...tap.map((q) => q.x))).toBeCloseTo(DEFAULT_EXTENT_M.line, 6)
  })

  it('circle: centre at the press, radius = drag, first buoy under the finger, even arcs', () => {
    const c = { x: 500, y: -500 }, plan = planDrop(gesturePlacement('circle', c, at(c, 135, 4000)), 8)
    const p = pts(plan)
    expect(plan.n).toBe(8)
    for (const q of p) expect(dist(q, c)).toBeCloseTo(4000, 6)
    expect(dist(p[0], at(c, 135, 4000))).toBeLessThan(1e-6)
    for (let i = 1; i < p.length; i++) expect(dist(p[i], p[i - 1])).toBeCloseTo(plan.spacingM, 6)
    expect(plan.spacingM).toBeCloseTo(2 * 4000 * Math.sin(Math.PI / 8), 6)
    // The planner's minimum ring (never fewer than ceil(2π/1.5) = 5).
    expect(planDrop(gesturePlacement('circle', c, null), 2).n).toBe(COUNT_RANGE.circle[0])
  })

  it('field: square grid centred on the press, corner buoy under the finger, rotation follows the drag', () => {
    const c = { x: 0, y: 0 }, plan = planDrop(gesturePlacement('field', c, at(c, 75, 4243)))
    const p = pts(plan)
    expect(plan.n).toBe(9)
    expect(centroid(p).x).toBeCloseTo(0, 6); expect(centroid(p).y).toBeCloseTo(0, 6)
    const far = p.reduce((a, b) => (dist(b, c) > dist(a, c) ? b : a))
    expect(dist(far, c)).toBeCloseTo(4200, 6)
    expect(p.some((q) => dist(q, at(c, 75, 4200)) < 1e-6)).toBe(true)
    // Nearest-neighbour spacing = reported grid spacing = corner / √2.
    for (const q of p) expect(Math.min(...p.filter((r) => r !== q).map((r) => dist(q, r)))).toBeCloseTo(plan.spacingM, 6)
    expect(plan.spacingM).toBeCloseTo(4200 / Math.SQRT2, 6)
  })

  it('wedge: apex at the press, opens along the drag, symmetric ±30° legs, depth = drag', () => {
    const a = { x: 1000, y: 2000 }, plan = planDrop(gesturePlacement('wedge', a, at(a, 200, 5000)), 7)
    const p = pts(plan)
    expect(plan.n).toBe(7)
    expect(dist(p[0], a)).toBeLessThan(1e-6)
    const ux = Math.sin((200 * Math.PI) / 180), uy = Math.cos((200 * Math.PI) / 180)
    const along = (q: Pt) => (q.x - a.x) * ux + (q.y - a.y) * uy, across = (q: Pt) => (q.x - a.x) * uy - (q.y - a.y) * ux
    expect(Math.max(...p.map(along))).toBeCloseTo(5000, 6)
    for (const q of p.slice(1)) { expect(along(q)).toBeGreaterThan(0); expect(Math.abs(across(q)) / along(q)).toBeCloseTo(Math.tan(Math.PI / 6), 6) }
    // Alternating legs, mirror images.
    for (let i = 1; i + 1 < p.length; i += 2) { expect(across(p[i]) + across(p[i + 1])).toBeCloseTo(0, 6); expect(along(p[i])).toBeCloseTo(along(p[i + 1]), 6) }
    // Same leg spacing as the planner's, scaled.
    expect(dist(p[1], p[3])).toBeCloseTo(plan.spacingM, 6)
  })

  it('single: one DIFAR at the tap; a drag moves it with the finger (no extent)', () => {
    const plan = planDrop(gesturePlacement('single', { x: 1234, y: 5678 }, null))
    expect(plan.n).toBe(1); expect(pts(plan)[0]).toEqual({ x: 1200, y: 5700 }); expect(plan.kinds).toEqual(['difar'])
    const moved = planDrop(gesturePlacement('single', { x: 0, y: 0 }, { x: 3020, y: -40 }))
    expect(pts(moved)[0]).toEqual({ x: 3000, y: 0 }); expect(moved.extentM).toBe(0)
  })

  it('shapes match the engine planner exactly up to a similarity transform', () => {
    for (const pat of ['line', 'circle', 'field', 'wedge'] as const) {
      const plan = planDrop(gesturePlacement(pat, { x: 0, y: 0 }, null))
      const kind = { line: 'barrier', circle: 'ring', field: 'grid', wedge: 'wedge' }[pat] as 'barrier'
      const ref = planPattern({ kind, center: { x: 0, y: 0 }, axisDeg: 0, count: plan.n }).points
      // Tap orientations map to planner axis 0 for each; pairwise distance ratios are preserved.
      const p = pts(plan), r0 = dist(p[0], p[1]) / dist(ref[0], ref[1])
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(dist(p[i], p[j])).toBeCloseTo(dist(ref[i], ref[j]) * r0, 4)
    }
  })

  it('counts clamp to each pattern range and readouts state kind, count, size and orientation', () => {
    expect(planDrop(gesturePlacement('line', { x: 0, y: 0 }, null), 99).n).toBe(COUNT_RANGE.line[1])
    expect(planDrop(gesturePlacement('field', { x: 0, y: 0 }, null), 1).n).toBe(COUNT_RANGE.field[0])
    expect(planReadout(planDrop(gesturePlacement('line', { x: 0, y: 0 }, null)))).toBe('LINE · 5 DIFAR · 8.0 km · 090°')
    expect(planReadout(planDrop(gesturePlacement('circle', { x: 0, y: 0 }, null)))).toBe('CIRCLE · 6 OMNI · r 3.0 km')
    expect(planReadout(planDrop(gesturePlacement('wedge', { x: 0, y: 0 }, at({ x: 0, y: 0 }, 270, 3000))))).toBe('WEDGE · 5 DIFAR · 3.0 km · opens 270°')
    expect(planReadout(planDrop(gesturePlacement('single', { x: 1500, y: -2000 }, null)))).toBe('SINGLE · 1 DIFAR · 1.5E -2.0N')
  })
})

describe('AUTO lay (planner auto kind)', () => {
  const field = [{ x: -2000, y: 2000 }, { x: 2000, y: 2000 }, { x: -2000, y: -2000 }, { x: 2000, y: -2000 }]
  it('no fix: a ring round the field centroid', () => {
    const p = autoPlacement(null, field)
    expect(p).toMatchObject({ pattern: 'circle', center: { x: 0, y: 0 }, extentM: AUTO_RING_M })
  })
  it('a fix gives a barrier centred on it, across the threat axis from the field', () => {
    const p = autoPlacement({ x: 6000, y: 0 }, field)
    expect(p).toMatchObject({ pattern: 'line', center: { x: 6000, y: 0 }, extentM: AUTO_LINE_M })
    expect(p.bearingDeg % 180).toBe(0) // threat axis 090 → line runs north–south
  })
  it('re-lays only for a fix outside the field, after the cooldown, under the cap', () => {
    const live = field
    expect(autoShouldLay({ lastLayS: null }, 0, null, live, 6, true)).toBe(true)
    expect(autoShouldLay({ lastLayS: 0 }, 10, { x: 9000, y: 0 }, live, 6, false)).toBe(false)
    expect(autoShouldLay({ lastLayS: 0 }, AUTO_COOLDOWN_S, { x: 9000, y: 0 }, live, 6, false)).toBe(true)
    expect(autoShouldLay({ lastLayS: 0 }, AUTO_COOLDOWN_S, { x: 2000 + AUTO_GAP_M - 1, y: 2000 }, live, 6, false)).toBe(false)
    expect(autoShouldLay({ lastLayS: null }, 0, null, live, MAX_BUOYS, true)).toBe(false)
  })
})

describe('drop tool / field mode state', () => {
  const run = (s: DropState, ...as: Parameters<typeof dropReducer>[1][]) => as.reduce(dropReducer, s)
  it('starts in PREPLAN with nothing armed; mode switches never touch the drop tool', () => {
    const s = initialDrop()
    expect(s).toMatchObject({ mode: 'preplan', phase: 'idle', pattern: null }); expect(dropCapturesPlot(s)).toBe(false)
    const armed = run(s, { type: 'arm', pattern: 'line' }, { type: 'mode', mode: 'auto' })
    expect(armed).toMatchObject({ mode: 'auto', phase: 'armed', pattern: 'line', count: 5 }); expect(dropCapturesPlot(armed)).toBe(true)
  })
  it('tap: arm → press → release = preview of the default pattern; confirm in PREPLAN/AUTO disarms', () => {
    for (const mode of ['preplan', 'auto'] as const) {
      const p = run(initialDrop(mode), { type: 'arm', pattern: 'circle' }, { type: 'press', at: { x: 1000, y: 0 } }, { type: 'release' })
      expect(p.phase).toBe('preview'); expect(p.placement).toMatchObject({ pattern: 'circle', center: { x: 1000, y: 0 }, dragged: false })
      expect(run(p, { type: 'confirm' })).toMatchObject({ mode, phase: 'idle', pattern: null, placement: null })
    }
  })
  it('drag updates the ghost; MANUAL stays armed after confirm; cancel steps back', () => {
    let s = run(initialDrop('manual'), { type: 'arm', pattern: 'wedge' }, { type: 'press', at: { x: 0, y: 0 } }, { type: 'drag', at: { x: 0, y: 3000 } })
    expect(s.phase).toBe('placing'); expect(s.placement).toMatchObject({ bearingDeg: 0, extentM: 3000, dragged: true })
    s = run(s, { type: 'drag', at: { x: 4000, y: 0 } }); expect(s.placement).toMatchObject({ bearingDeg: 90, extentM: 4000 })
    s = run(s, { type: 'release' }); expect(s.phase).toBe('preview')
    expect(run(s, { type: 'confirm' })).toMatchObject({ phase: 'armed', pattern: 'wedge', placement: null })
    expect(run(s, { type: 'cancel' })).toMatchObject({ phase: 'armed', pattern: 'wedge', placement: null })
    expect(run(s, { type: 'cancel' }, { type: 'cancel' })).toMatchObject({ phase: 'idle', pattern: null })
  })
  it('pressing again in preview re-places; re-tapping the armed pattern puts it away; count steps clamp', () => {
    let s = run(initialDrop(), { type: 'arm', pattern: 'line' }, { type: 'press', at: { x: 0, y: 0 } }, { type: 'release' }, { type: 'press', at: { x: 5000, y: 0 } }, { type: 'release' })
    expect(s.placement?.center).toEqual({ x: 5000, y: 0 })
    s = run(s, { type: 'count', delta: 100 }); expect(s.count).toBe(COUNT_RANGE.line[1])
    s = run(s, { type: 'count', delta: -100 }); expect(s.count).toBe(COUNT_RANGE.line[0])
    expect(run(initialDrop(), { type: 'arm', pattern: 'field' }, { type: 'arm', pattern: 'field' })).toMatchObject({ phase: 'idle', pattern: null })
    expect(run(initialDrop(), { type: 'arm', pattern: 'field' }, { type: 'arm', pattern: 'single' })).toMatchObject({ phase: 'armed', pattern: 'single', count: 1 })
  })
  it('ignores presses with nothing armed and drags outside a press', () => {
    const s = initialDrop()
    expect(run(s, { type: 'press', at: { x: 0, y: 0 } })).toBe(s)
    const a = run(s, { type: 'arm', pattern: 'line' })
    expect(run(a, { type: 'drag', at: { x: 1, y: 1 } })).toBe(a)
    expect(run(a, { type: 'confirm' })).toBe(a)
  })
  it('the hint always says what the tool is doing', () => {
    expect(dropHint(initialDrop(), false)).toBe('Pick a pattern to drop')
    expect(dropHintShort(initialDrop(), false)).toBe('Pick a pattern')
    expect(dropHintShort(initialDrop(), true)).toBe('Field full')
    expect(dropHint(initialDrop('auto'), false)).toMatch(/^AUTO/)
    expect(dropHint(run(initialDrop(), { type: 'arm', pattern: 'single' }), false)).toBe('Tap the plot to place one buoy')
    expect(dropHint(run(initialDrop(), { type: 'arm', pattern: 'line' }), false)).toMatch(/drag to orient and size/)
    expect(dropHint(initialDrop(), true)).toBe('Field full')
  })
})
