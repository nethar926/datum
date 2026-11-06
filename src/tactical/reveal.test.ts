import { describe, expect, it } from 'vitest'
import {
  REVEAL_SHAPE_BY_KIND,
  assignRevealTags,
  placeRevealTags,
  revealRangeBrg,
  revealShapeForCategory,
  revealTagPrefix,
} from './reveal'

describe('reveal shape-by-category', () => {
  it('maps subsurface → triangle and surface → circle', () => {
    expect(revealShapeForCategory('subsurface')).toBe('triangle')
    expect(revealShapeForCategory('surface')).toBe('circle')
    expect(revealShapeForCategory(undefined)).toBeNull()
    expect(revealShapeForCategory('warship')).toBeNull()
  })

  it('keeps a warship → square hook without inventing the kind on the wire', () => {
    expect(REVEAL_SHAPE_BY_KIND.warship).toBe('square')
    expect(REVEAL_SHAPE_BY_KIND.subsurface).toBe('triangle')
    expect(REVEAL_SHAPE_BY_KIND.surface).toBe('circle')
  })

  it('tags S for subsurface and M for surface commercial', () => {
    expect(revealTagPrefix('subsurface')).toBe('S')
    expect(revealTagPrefix('surface')).toBe('M')
    expect(assignRevealTags([
      { category: 'subsurface' },
      { category: 'surface' },
      { category: 'subsurface', active: false },
      { category: 'surface' },
      { category: 'subsurface' },
      { category: 'unknown' },
    ])).toEqual(['S1', 'M1', null, 'M2', 'S2', null])
  })
})

describe('reveal tag placement (no overlap)', () => {
  it('keeps tags off each other and off buoy/chrome obstacles', () => {
    const marks = [
      { ax: 100, ay: 100, w: 20, h: 12 },
      { ax: 108, ay: 100, w: 20, h: 12 }, // almost on top of the first
      { ax: 200, ay: 200, w: 20, h: 12 },
    ]
    const obstacles = [
      { x: 110, y: 96, w: 14, h: 12 }, // buoy label beside mark 0/1
      { x: 0, y: 0, w: 300, h: 28 },   // top chrome
    ]
    const placed = placeRevealTags(marks, obstacles, 300, 300)
    expect(placed).toHaveLength(3)
    const rects = placed.map((p, i) => ({ x: p.x, y: p.y, w: marks[i].w, h: marks[i].h }))
    const overlap = (a: typeof rects[0], b: typeof rects[0]) =>
      !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
    for (let i = 0; i < rects.length; i++) {
      for (const o of obstacles) expect(overlap(rects[i], o), `tag ${i} hit obstacle`).toBe(false)
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `tag ${i} vs ${j}`).toBe(false)
      expect(rects[i].x).toBeGreaterThanOrEqual(0)
      expect(rects[i].y).toBeGreaterThanOrEqual(0)
      expect(rects[i].x + rects[i].w).toBeLessThanOrEqual(300)
      expect(rects[i].y + rects[i].h).toBeLessThanOrEqual(300)
    }
  })

  it('stays clear of the bottom toolbar band', () => {
    const marks = [{ ax: 150, ay: 270, w: 24, h: 12 }]
    const obstacles = [{ x: 0, y: 260, w: 300, h: 40 }] // toolbar / glass
    const [p] = placeRevealTags(marks, obstacles, 300, 300)
    expect(p.y + 12).toBeLessThanOrEqual(260)
  })
})

describe('reveal range/bearing', () => {
  it('returns null without a buoy and north = 0°', () => {
    expect(revealRangeBrg(null, { x: 1, y: 1 })).toBeNull()
    const n = revealRangeBrg({ x: 0, y: 0 }, { x: 0, y: 1000 })!
    expect(n.brgDeg).toBeCloseTo(0, 5)
    expect(n.rngM).toBeCloseTo(1000, 5)
    const e = revealRangeBrg({ x: 0, y: 0 }, { x: 1000, y: 0 })!
    expect(e.brgDeg).toBeCloseTo(90, 5)
  })
})
