import { describe, expect, it } from 'vitest'
import { ALI_WINDOW_S, aliAvailable, aliEdgeIsTop, aliRowCount, integrateAli, integrateFromHistory } from './ali'
import { LevelHistory } from './levelHistory'

describe('ALI Automatic Line Integration', () => {
  it('defaults the window to 30 s, as a parameter', () => {
    expect(ALI_WINDOW_S).toBe(30)
    expect(aliRowCount(2)).toBe(15)
    expect(aliRowCount(8)).toBe(4) // RES 1 (P=8 s) still covers 30 s
    expect(aliRowCount(2, 10)).toBe(5)
    expect(aliRowCount(100)).toBe(1)
  })

  it('sits at the newest-data edge: top when cascading downward, bottom when upward', () => {
    expect(aliEdgeIsTop(false)).toBe(true)  // newest at top (downward cascade)
    expect(aliEdgeIsTop(true)).toBe(false) // newest at bottom (app default)
  })

  it('is available on LOFAR only', () => {
    expect(aliAvailable(true)).toBe(true)
    expect(aliAvailable(false)).toBe(false)
  })

  it('integrates as a per-bin mean of linear power and skips gaps', () => {
    const a = [30, 40, 50]
    expect([...integrateAli([a, a], 2)]).toEqual(a)
    const mixed = integrateAli([[20], [40]], 2)
    expect(mixed[0]).toBeCloseTo(10 * Math.log10((10 ** 2 + 10 ** 4) / 2), 5)
    const gapped = integrateAli([[NaN, 10, -1e38], [20, 10, 30]], 2)
    expect(gapped[0]).toBe(20)
    expect(gapped[1]).toBe(10)
    expect(gapped[2]).toBe(30)
    expect(integrateAli([], 2).length).toBe(0)
  })

  it('limits integration to the window and reads LevelHistory newest-first', () => {
    const newest = integrateAli([[10], [40]], 2, 2)
    expect(newest[0]).toBe(10)
    const hist = new LevelHistory(8, 1)
    const a = new Float32Array([40]), b = new Float32Array([10])
    hist.push(a, 0) // older
    hist.push(b, 0) // newest
    const fromHist = integrateFromHistory(hist, 2, 2)
    expect(fromHist[0]).toBe(10)
  })
})
