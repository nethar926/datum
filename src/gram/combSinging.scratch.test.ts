/**
 * Scratch-only: when Sonya's singing-prop acoustics (m3-acoustics-src-swath) can be
 * imported, recover COMB spacing vs drawn PSR. Skips cleanly otherwise — m3-fe-comb
 * does not depend on that branch.
 */
import { describe, expect, it } from 'vitest'
import { combSeries, nearestCombOrder, spacingFromDrag } from './comb'

const SWATH = '/workspace/sonar-sim-m3-src-swath/acoustics/src/singingPropPhysics.ts'

async function loadSinging(): Promise<{ singingCombHz: (f0: number, psr: number, n: number) => { n: number; hz: number }[] } | null> {
  try {
    return await import(/* @vite-ignore */ SWATH) as { singingCombHz: (f0: number, psr: number, n: number) => { n: number; hz: number }[] }
  } catch {
    return null
  }
}

describe('COMB vs singing-prop (scratch merge only)', () => {
  it('recovers spacing equal to drawn PSR from centre ± sidebands when swath tip is present', async () => {
    const mod = await loadSinging()
    if (!mod?.singingCombHz) {
      expect(mod).toBeNull()
      return
    }
    const f0 = 120
    const psr = 7.5
    const sidebands = 5
    const drawn = mod.singingCombHz(f0, psr, sidebands)
    expect(drawn.some((c) => c.n === 0 && Math.abs(c.hz - f0) < 1e-9)).toBe(true)
    const plus3 = drawn.find((c) => c.n === 3)!
    expect(nearestCombOrder(f0, null, plus3.hz)).toBe(1)
    const recovered = spacingFromDrag(f0, 3, plus3.hz)
    expect(recovered).toBeCloseTo(psr, 10)
    const series = combSeries(f0, recovered, sidebands, 0, 500)
    for (const c of drawn) {
      expect(series.find((x) => x.n === c.n)?.hz).toBeCloseTo(c.hz, 10)
    }
  })
})
