import { describe, expect, it } from 'vitest'
import {
  PLOT_LABEL_GAP, clampPlotLabel, makePlotLabelScratch, placePlotLabels, plotLabelLeaderEnd,
  plotLabelOverlaps, plotLabelSize, plotLabelTopLeft, type PlotLabelItem, type PlotLabelRect,
} from './plotLabelLayout'

describe('plotLabelLayout (shared with native PlotLabelLayout)', () => {
  it('puts an isolated label in the east slot', () => {
    const scratch = makePlotLabelScratch()
    const item: PlotLabelItem = { id: 'a', ax: 100, ay: 100, width: 20, height: 12 }
    placePlotLabels([item], [], [], 0, 0, 400, 400, scratch)
    expect(scratch.placed).toHaveLength(1)
    const p = scratch.placed[0]!
    expect(p.slot).toBe(0)
    expect(p.leader).toBe(false)
    expect(p.x).toBeCloseTo(100 + PLOT_LABEL_GAP, 9)
    expect(p.y).toBeCloseTo(100 - 6, 9)
  })

  it('moves a second label off a taken east slot and clears symbols', () => {
    const scratch = makePlotLabelScratch()
    const a: PlotLabelItem = { id: 'a', ax: 100, ay: 100, width: 40, height: 12 }
    const b: PlotLabelItem = { id: 'b', ax: 112, ay: 100, width: 40, height: 12 }
    const symbols: PlotLabelRect[] = [
      { x: 94, y: 94, w: 12, h: 12 },
      { x: 106, y: 94, w: 12, h: 12 },
    ]
    placePlotLabels([a, b], symbols, [], 0, 0, 400, 400, scratch)
    expect(scratch.placed).toHaveLength(2)
    const pa = scratch.placed[0]!, pb = scratch.placed[1]!
    const ra = { x: pa.x, y: pa.y, w: 40, h: 12 }
    const rb = { x: pb.x, y: pb.y, w: 40, h: 12 }
    expect(plotLabelOverlaps(ra, rb, 2)).toBe(false)
    for (const s of symbols) {
      expect(plotLabelOverlaps(ra, s, 2)).toBe(false)
      expect(plotLabelOverlaps(rb, s, 2)).toBe(false)
    }
    expect(pa.x).not.toBe(pb.x)
  })

  it('requests a leader when every first-ring slot is blocked', () => {
    const scratch = makePlotLabelScratch()
    const item: PlotLabelItem = { id: 'tight', ax: 80, ay: 80, width: 30, height: 12 }
    const chrome: PlotLabelRect[] = []
    for (let slot = 0; slot < 8; slot++) {
      const tl = plotLabelTopLeft(item, slot, 0)
      chrome.push({ x: tl.x - 1, y: tl.y - 1, w: 32, h: 14 })
    }
    placePlotLabels([item], [], chrome, 0, 0, 400, 400, scratch)
    const p = scratch.placed[0]!
    expect(p.leader).toBe(true)
    expect(p.slot).toBeGreaterThanOrEqual(8)
    const rect = { x: p.x, y: p.y, w: 30, h: 12 }
    for (const o of chrome) expect(plotLabelOverlaps(rect, o, 2)).toBe(false)
    const end = plotLabelLeaderEnd(p, 80, 80, 30, 12)
    expect(end.x).toBeGreaterThanOrEqual(p.x - 1e-9)
    expect(end.x).toBeLessThanOrEqual(p.x + 30 + 1e-9)
  })

  it('keeps the same slot when the anchor drifts (hysteresis)', () => {
    const scratch = makePlotLabelScratch()
    placePlotLabels([{ id: 'ship', ax: 120, ay: 150, width: 36, height: 12 }], [], [], 0, 0, 400, 400, scratch)
    expect(scratch.placed[0]!.slot).toBe(0)
    placePlotLabels([{ id: 'ship', ax: 124, ay: 153, width: 36, height: 12 }], [], [], 0, 0, 400, 400, scratch)
    expect(scratch.placed[0]!.slot).toBe(0)
    expect(scratch.placed[0]!.x).toBeCloseTo(124 + PLOT_LABEL_GAP, 9)
  })

  it('abandons a previous slot once it is blocked', () => {
    const scratch = makePlotLabelScratch()
    const item: PlotLabelItem = { id: 'ship', ax: 120, ay: 150, width: 36, height: 12 }
    placePlotLabels([item], [], [], 0, 0, 400, 400, scratch)
    expect(scratch.placed[0]!.slot).toBe(0)
    const east = plotLabelTopLeft(item, 0, 0)
    const wall = { x: east.x - 2, y: east.y - 2, w: 40, h: 16 }
    placePlotLabels([item], [], [wall], 0, 0, 400, 400, scratch)
    expect(scratch.placed[0]!.slot).not.toBe(0)
    expect(plotLabelOverlaps({ x: scratch.placed[0]!.x, y: scratch.placed[0]!.y, w: 36, h: 12 }, wall, 2)).toBe(false)
  })

  it('is deterministic and drops stale previous ids', () => {
    const scratch = makePlotLabelScratch()
    const items: PlotLabelItem[] = [
      { id: 'b', ax: 80, ay: 80, width: 20, height: 10 },
      { id: 'a', ax: 90, ay: 80, width: 20, height: 10 },
    ]
    placePlotLabels(items, [], [], 0, 0, 300, 300, scratch)
    const first = scratch.placed.map((p) => ({ ...p }))
    placePlotLabels(items, [], [], 0, 0, 300, 300, scratch)
    expect(scratch.placed).toEqual(first)
    placePlotLabels([items[1]!], [], [], 0, 0, 300, 300, scratch)
    expect(scratch.previous.has('b')).toBe(false)
    expect(scratch.placed).toHaveLength(1)
    expect(scratch.placed[0]!.id).toBe('a')
  })

  it('estimates monospace label size and clamps to the canvas', () => {
    const s = plotLabelSize('FA49W', 9)
    expect(s.w).toBeCloseTo(5 * 9 * 0.62 + 2, 9)
    expect(s.h).toBe(12)
    const c = clampPlotLabel(-20, -20, 30, 12, 0, 0, 100, 80, 2)
    expect(c.x).toBe(2)
    expect(c.y).toBe(2)
  })
})
