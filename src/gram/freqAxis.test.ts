import { describe, expect, it } from 'vitest'
import { niceTicks } from './axis'
import { estimateFreqLabelWidth, placeFreqAxisTicks } from './freqAxis'

function labelsAt(lo: number, hi: number, width: number, unit = 'Hz') {
  const target = Math.max(3, Math.floor(width / 90))
  const ticks = niceTicks(lo, hi, target)
  return { ticks, labels: placeFreqAxisTicks(ticks, { lo, hi }, width, unit) }
}

function assertInside(labels: ReturnType<typeof placeFreqAxisTicks>, width: number) {
  for (const t of labels) {
    const half = estimateFreqLabelWidth(t.label) / 2
    expect(t.left - half).toBeGreaterThanOrEqual(1.5)
    expect(t.left + half).toBeLessThanOrEqual(width - 1.5)
  }
}

function assertNoOverlap(labels: ReturnType<typeof placeFreqAxisTicks>) {
  for (let i = 1; i < labels.length; i++) {
    const a = labels[i - 1]!, b = labels[i]!
    const ha = estimateFreqLabelWidth(a.label) / 2, hb = estimateFreqLabelWidth(b.label) / 2
    // Allow the forced first+last pair on an ultra-narrow axis to share an edge.
    if (labels.length === 2 && i === 1) continue
    expect(Math.abs(b.left - a.left)).toBeGreaterThanOrEqual(ha + hb - 0.5)
  }
}

describe('placeFreqAxisTicks', () => {
  it('stamps the unit on the last tick only', () => {
    const labels = placeFreqAxisTicks([0, 100, 200, 300, 400, 500], { lo: 0, hi: 500 }, 800, 'Hz')
    expect(labels.at(-1)?.label).toBe('500 Hz')
    expect(labels.slice(0, -1).every((t) => !/Hz/.test(t.label))).toBe(true)
    expect(labels[0]?.label).toBe('0')
  })

  it('always keeps first (0) and last (unit) ticks', () => {
    for (const w of [160, 240, 340, 600, 980]) {
      const { labels } = labelsAt(0, 2000, w)
      expect(labels[0]?.label).toBe('0')
      expect(labels.at(-1)?.label).toMatch(/Hz$/)
      expect(labels.at(-1)?.f).toBe(2000)
    }
  })

  it('keeps labels fully inside the axis and non-overlapping', () => {
    const w = 400
    const labels = placeFreqAxisTicks([0, 100, 200, 300, 400, 500], { lo: 0, hi: 500 }, w, 'Hz')
    assertInside(labels, w)
    assertNoOverlap(labels)
  })

  it('drops interior ticks that would collide; aims for ≥3 labels on a phone-width 0–2000 axis', () => {
    const { labels } = labelsAt(0, 2000, 340)
    expect(labels[0]?.label).toBe('0')
    expect(labels.at(-1)?.label).toBe('2000 Hz')
    expect(labels.length).toBeGreaterThanOrEqual(3)
  })

  it('covers 0–512, 0–2000 and zoomed ranges at 340 / 600 / 980 px', () => {
    const cases: Array<{ lo: number; hi: number }> = [
      { lo: 0, hi: 512 },
      { lo: 0, hi: 2000 },
      { lo: 0, hi: 200 },
      { lo: 40, hi: 240 },
      { lo: 100, hi: 400 },
    ]
    for (const { lo, hi } of cases) {
      for (const w of [340, 600, 980]) {
        const { labels } = labelsAt(lo, hi, w)
        expect(labels.length).toBeGreaterThanOrEqual(2)
        expect(labels[0]?.f).toBe(labelsAt(lo, hi, w).ticks[0])
        expect(labels.at(-1)?.label).toMatch(/Hz$/)
        expect(labels.at(-1)?.f).toBe(labelsAt(lo, hi, w).ticks.at(-1))
        assertInside(labels, w)
        if (labels.length > 2) assertNoOverlap(labels)
      }
    }
  })

  it('live-gram phone 0–400 and desktop 0–500 keep 0 and the unit end tick', () => {
    const phone = labelsAt(0, 400, 340)
    expect(phone.labels.map((l) => l.label)).toEqual(['0', '200', '400 Hz'])
    const desk = labelsAt(0, 500, 980)
    expect(desk.labels[0]?.label).toBe('0')
    expect(desk.labels.at(-1)?.label).toBe('500 Hz')
    expect(desk.labels.length).toBeGreaterThanOrEqual(5)
  })

  it('returns empty for bad input', () => {
    expect(placeFreqAxisTicks([], { lo: 0, hi: 500 }, 400)).toEqual([])
    expect(placeFreqAxisTicks([0, 500], { lo: 0, hi: 500 }, 0)).toEqual([])
  })
})
