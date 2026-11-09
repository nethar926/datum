import { describe, expect, it } from 'vitest'
import { DEMON_CARRIER_BAND, DEMON_DISPLAY_DB, DEMON_NORM, getCutSeed, renderCut } from '@acoustics'
import {
  DEMON_DISPLAY, DEMON_DISPLAY_CEIL_DB, DEMON_GRAM, makeDemonRowNormalizer,
  CUT_DEMON_NO_CAV_HINT, LIVE_DEMON_HINT, liveDemonHint,
} from './cutNorm'
import {
  cutsDemonHintForCut, cutsDemonHintFromExpectation, expectationForCut,
} from './demonExpectationUi'

describe('CUTDEMON absolute floor/ceil via normalizeDemonRow', () => {
  it('DEMON_GRAM uses absolute stream scale; FE mirrors acoustics LUT/band/NORM', () => {
    expect(DEMON_GRAM.normalized).toBe(false)
    expect(DEMON_GRAM.auto).toBe(false)
    expect(DEMON_DISPLAY.window).toBe(DEMON_NORM.window)
    expect(DEMON_DISPLAY.guard).toBe(DEMON_NORM.guard)
    expect(DEMON_DISPLAY.clampFloorDb).toBe(DEMON_NORM.clampFloorDb)
    expect(DEMON_DISPLAY.floorDb).toBe(DEMON_DISPLAY_DB.floorDb)
    expect(DEMON_DISPLAY.ceilDb).toBe(DEMON_DISPLAY_DB.ceilDb)
    expect(DEMON_DISPLAY_CEIL_DB).toBe(DEMON_DISPLAY_DB.ceilDb)
    expect(DEMON_DISPLAY.ceilDb).toBe(20)
    expect([...DEMON_CARRIER_BAND]).toEqual([1000, 4000])
  })

  it('DemonRowNormalizer soft-clips to DEMON_DISPLAY_DB on brindleflux', () => {
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
        if (v >= DEMON_DISPLAY.ceilDb - 1e-6) sat++
        expect(v).toBeLessThanOrEqual(DEMON_DISPLAY.ceilDb + 1e-6)
        expect(v).toBeGreaterThanOrEqual(DEMON_DISPLAY.floorDb - 1e-6)
      }
    }
    s.dispose()
    expect(saw).toBe(true)
    expect(n).toBeGreaterThan(0)
    expect(sat / n).toBeLessThan(0.5)
  })
})

describe('DEMON hint adapters', () => {
  it('live hint is fixed copy (identical regardless of contact cavitation)', () => {
    const cav = [{ params: { cavitationPower: 0.3 } }]
    const quiet = [{ params: { cavitationPower: 0 } }]
    expect(liveDemonHint(cav)).toBe(LIVE_DEMON_HINT)
    expect(liveDemonHint(quiet)).toBe(LIVE_DEMON_HINT)
    expect(liveDemonHint(cav)).toBe(liveDemonHint(quiet))
    expect(LIVE_DEMON_HINT).toBe('DEMON shows propulsion only from cavitating contacts.')
  })

  it('cuts adapter uses cutDemonExpectation; shows Sonya wording only when not cavitating', () => {
    expect(cutsDemonHintFromExpectation(undefined)).toBeNull()
    expect(cutsDemonHintFromExpectation({ demonExpected: true, demonReason: 'cavitating' })).toBeNull()
    expect(cutsDemonHintFromExpectation({ demonExpected: false, demonReason: 'not-cavitating' })).toBe(CUT_DEMON_NO_CAV_HINT)
    expect(CUT_DEMON_NO_CAV_HINT).toBe('no cavitation, no DEMON lines expected')

    const mist = getCutSeed('cut-mistacorn-batt')!
    const quiet = expectationForCut(mist)
    expect(quiet.demonExpected).toBe(false)
    expect(quiet.demonReason).toBe('not-cavitating')
    expect(cutsDemonHintForCut(mist)).toBe(CUT_DEMON_NO_CAV_HINT)

    const cavCut = getCutSeed('cut-cinderlilt-cav')!
    const cav = expectationForCut(cavCut)
    expect(cav.demonExpected).toBe(true)
    expect(cav.demonReason).toBe('cavitating')
    expect(cutsDemonHintForCut(cavCut)).toBeNull()
  })
})
