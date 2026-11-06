import { describe, expect, it } from 'vitest'
import { applyScore, emptySessionScore, nearestMark, scoreCut } from './scoring'
import { getCutSeed, listCutSeeds } from './api'

describe('nearestMark', () => {
  it('picks the closest mark within tol', () => {
    expect(nearestMark(100, [99.2, 101.5, 50], 1.5)?.hz).toBe(99.2)
    expect(nearestMark(100, [102, 50], 1.5)).toBeNull()
  })
})

describe('scoreCut', () => {
  const cut = getCutSeed('cut-pebblewisp-demon')!
  it('marks correct class and HYDP giveaway hit', () => {
    const hydp = cut.classifyingLines.find((l) => l.lineFamily === 'HYDP')!.nominalHz!
    const r = scoreCut(cut, { classId: cut.classId, confidence: 'high' }, { harmF0Hz: hydp, probeHz: null })
    expect(r.correct).toBe(true)
    expect(r.giveawaysTotal).toBe(1)
    expect(r.giveawaysHit).toBe(1)
    expect(r.lines.find((l) => l.line.giveaway)!.hit).toBe(true)
    expect(r.lookalike?.differOn).toBe('HYDP')
    expect(r.lookalike?.otherClassId).toBe('red-dorhan-mistacorn')
    expect(r.identifiedBy?.lineFamily).toBe('HYDP')
    expect(r.identifiedBy?.wasHarmonic).toBe(false)
  })
  it('names a harmonic giveaway as the identifying line', () => {
    const base = getCutSeed('cut-brindleflux-snork')!
    const harmonic = {
      ...base,
      classifyingLines: [
        { lineFamily: 'BR', label: '5-blade H5', nominalHz: 2.0, giveaway: true, harmonicOf: 'PSR', n: 5, behaviour: 'unstable' as const },
      ],
    }
    const r = scoreCut(harmonic, { classId: base.classId }, { harmF0Hz: 10.0, probeHz: null }) // 2*5
    expect(r.identifiedBy?.wasHarmonic).toBe(true)
    expect(r.identifiedBy?.n).toBe(5)
    expect(r.identifiedBy?.harmonicOf).toBe('PSR')
    expect(r.lines[0].hit).toBe(true)
  })
  it('wrong class with miss on giveaway', () => {
    const r = scoreCut(cut, { classId: 'blue-brindleflux' }, { harmF0Hz: null, probeHz: null })
    expect(r.correct).toBe(false)
    expect(r.giveawaysHit).toBe(0)
  })
  it('probe can hit a classifying line', () => {
    const hydp = cut.classifyingLines.find((l) => l.lineFamily === 'HYDP')!.nominalHz!
    const r = scoreCut(cut, { classId: cut.classId }, { harmF0Hz: 40, probeHz: hydp + 0.4 })
    expect(r.lines.find((l) => l.line.lineFamily === 'HYDP')!.hit).toBe(true)
  })
})

describe('session score', () => {
  it('tallies and allows resubmit flip', () => {
    const cuts = listCutSeeds()
    let s = emptySessionScore()
    const a = scoreCut(cuts[0], { classId: cuts[0].classId }, { harmF0Hz: null, probeHz: null })
    s = applyScore(s, cuts[0].id, a)
    expect(s).toMatchObject({ correct: 1, wrong: 0, total: 1 })
    const b = scoreCut(cuts[0], { classId: 'nope' }, { harmF0Hz: null, probeHz: null })
    s = applyScore(s, cuts[0].id, b)
    expect(s).toMatchObject({ correct: 0, wrong: 1, total: 1 })
  })
})
