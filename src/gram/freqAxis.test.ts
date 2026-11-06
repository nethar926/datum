import { describe, expect, it } from 'vitest'
import { estimateFreqLabelWidth, placeFreqAxisTicks } from './freqAxis'

describe('placeFreqAxisTicks', () => {
  it('stamps the unit on the last tick only', () => {
    const labels = placeFreqAxisTicks([0, 100, 200, 300, 400, 500], { lo: 0, hi: 500 }, 800, 'Hz')
    expect(labels.at(-1)?.label).toBe('500 Hz')
    expect(labels.slice(0, -1).every((t) => !/Hz/.test(t.label))).toBe(true)
    expect(labels[0]?.label).toBe('0')
  })

  it('keeps the first and last labels fully inside the axis', () => {
    const w = 400
    const labels = placeFreqAxisTicks([0, 100, 200, 300, 400, 500], { lo: 0, hi: 500 }, w, 'Hz')
    for (const t of labels) {
      const half = estimateFreqLabelWidth(t.label) / 2
      expect(t.left - half).toBeGreaterThanOrEqual(1.5)
      expect(t.left + half).toBeLessThanOrEqual(w - 1.5)
    }
    // No pairwise overlap.
    for (let i = 1; i < labels.length; i++) {
      const a = labels[i - 1]!, b = labels[i]!
      const ha = estimateFreqLabelWidth(a.label) / 2, hb = estimateFreqLabelWidth(b.label) / 2
      expect(Math.abs(b.left - a.left)).toBeGreaterThanOrEqual(ha + hb)
    }
  })

  it('drops interior ticks that would collide with the unit tick on a narrow axis', () => {
    const labels = placeFreqAxisTicks([0, 100, 200, 300, 400, 500], { lo: 0, hi: 500 }, 160, 'Hz')
    expect(labels.at(-1)?.label).toBe('500 Hz')
    expect(labels[0]?.label).toBe('0')
    // Narrow: far fewer than the input set.
    expect(labels.length).toBeLessThan(6)
    expect(labels.length).toBeGreaterThanOrEqual(2)
  })

  it('returns empty for bad input', () => {
    expect(placeFreqAxisTicks([], { lo: 0, hi: 500 }, 400)).toEqual([])
    expect(placeFreqAxisTicks([0, 500], { lo: 0, hi: 500 }, 0)).toEqual([])
  })
})
