import { describe, expect, it } from 'vitest'
import {
  ALI_WINDOW_S, aliAvailable, aliEdgeIsTop, aliLabel, aliRowCount, aliSpanS,
  integrateAli, integrateFromHistory,
} from './ali'
import { LevelHistory } from './levelHistory'

const RES1_HZ = 1 / 8
const RES5_HZ = 1 / 2
// RES 1 LSTI: T=32, hop=8, K=8 → 32+7*8=88. RES 5 LSTI: T=2, hop=0.5, K=32 → 2+31*0.5=17.5.
// Hardcoded: web has no LSTI fields until the post-deploy sync.
const RES1_LSTI_SPAN_S = 88
const RES5_LSTI_SPAN_S = 17.5

describe('ALI Automatic Line Integration', () => {
  it('defaults the window to 30 s, as a parameter', () => {
    expect(ALI_WINDOW_S).toBe(30)
    expect(aliRowCount(0.5, 10)).toBe(5)
    expect(aliRowCount(0.01)).toBe(1)
  })

  it('uses whole rows and labels the real span at RES 1 and RES 5', () => {
    expect(aliRowCount(RES1_HZ)).toBe(4)
    expect(aliSpanS(RES1_HZ)).toBe(32)
    expect(aliLabel(RES1_HZ)).toBe('ALI 32 s')

    expect(aliRowCount(RES5_HZ)).toBe(15)
    expect(aliSpanS(RES5_HZ)).toBe(30)
    expect(aliLabel(RES5_HZ)).toBe('ALI 30 s')
  })

  it('keeps working in LSTI and labels the row span at RES 1 and RES 5', () => {
    // integrationMode defaults to 'sti' — no LSTI clause.
    expect(aliLabel(RES1_HZ)).toBe('ALI 32 s')
    expect(aliLabel(RES1_HZ, ALI_WINDOW_S, 'lsti', RES1_LSTI_SPAN_S)).toBe('ALI 32 s (LSTI 88 s)')
    expect(aliLabel(RES5_HZ, ALI_WINDOW_S, 'lsti', RES5_LSTI_SPAN_S)).toBe('ALI 30 s (LSTI 17.5 s)')
    // Still available, still a linear-power mean — not greyed out or disabled.
    expect(aliAvailable(true)).toBe(true)
    expect(integrateAli([[20], [20]], RES1_HZ)[0]).toBe(20)
    expect(integrateAli([[20], [40]], RES5_HZ)[0]).toBeCloseTo(10 * Math.log10((10 ** 2 + 10 ** 4) / 2), 5)
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
    expect([...integrateAli([a, a], RES5_HZ)]).toEqual(a)
    const mixed = integrateAli([[20], [40]], RES5_HZ)
    expect(mixed[0]).toBeCloseTo(10 * Math.log10((10 ** 2 + 10 ** 4) / 2), 5)
    const gapped = integrateAli([[NaN, 10, -1e38], [20, 10, 30]], RES5_HZ)
    expect(gapped[0]).toBe(20)
    expect(gapped[1]).toBe(10)
    expect(gapped[2]).toBe(30)
    expect(integrateAli([], RES5_HZ).length).toBe(0)
  })

  it('limits integration to the window and reads LevelHistory newest-first', () => {
    const newest = integrateAli([[10], [40]], RES5_HZ, 2)
    expect(newest[0]).toBe(10)
    const hist = new LevelHistory(8, 1)
    const a = new Float32Array([40]), b = new Float32Array([10])
    hist.push(a, 0) // older
    hist.push(b, 0) // newest
    const fromHist = integrateFromHistory(hist, RES5_HZ, 2)
    expect(fromHist[0]).toBe(10)
  })
})
