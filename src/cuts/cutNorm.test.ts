import { describe, expect, it } from 'vitest'
import { DEMON_NORM, renderCut } from '@acoustics'
import { DEMON_DISPLAY_CEIL_DB, DEMON_GRAM, makeDemonRowNormalizer } from './cutNorm'

describe('CUTDEMON absolute floor/ceil via normalizeDemonRow', () => {
  it('DEMON_GRAM uses absolute stream scale (not live NB 1–22)', () => {
    expect(DEMON_GRAM.normalized).toBe(false)
    expect(DEMON_GRAM.auto).toBe(false)
    expect(DEMON_NORM.floorDb).toBe(0)
    expect(DEMON_NORM.ceilDb).toBe(30)
    expect(DEMON_NORM.clampFloorDb).toBe(-5)
    expect(DEMON_NORM.ceilDb).toBeGreaterThan(22)
    expect(DEMON_DISPLAY_CEIL_DB).toBeGreaterThanOrEqual(50)
  })

  it('DemonRowNormalizer soft-clips whitened peaks (sat under 5% on brindleflux)', () => {
    const s = renderCut('cut-brindleflux-snork')
    const lofar = new Float32Array(s.lofar.bins), demon = new Float32Array(512)
    const nz = makeDemonRowNormalizer(512)
    const out = new Float32Array(512)
    let n = 0, sat = 0, saw = false
    while (s.simT < 180) {
      s.writeLofarRow(lofar)
      if (s.writeDemonRow(demon) < 0 || s.simT < 160) continue
      saw = true
      nz.apply(demon, 0, out, 0)
      for (let i = 0; i < 512; i++) {
        const v = out[i]
        if (v !== v) continue
        n++
        if (v >= DEMON_DISPLAY_CEIL_DB - 1e-6) sat++
        expect(v).toBeLessThanOrEqual(DEMON_DISPLAY_CEIL_DB + 1e-6)
        expect(v).toBeGreaterThanOrEqual(DEMON_NORM.floorDb - 1e-6)
      }
    }
    s.dispose()
    expect(saw).toBe(true)
    expect(sat / n).toBeLessThan(0.05)
  })
})
