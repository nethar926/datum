import { describe, expect, it } from 'vitest'
import {
  ALTITUDE_FEET_OPTIONS, DEFAULT_SEQUENCE_PREFS, DESCENT_DURATION_S, DESCENT_RATE_MPS,
  DETUNED_LABEL, DROP_ALTITUDE_M, FRAME_BUDGET_S, FRAME_BUOY_COUNT, GRAM_PHASE_LABEL,
  GRAM_PHASE_ORDER, INTEGRATION_TIME_S_DEFAULT, INTEGRATION_TIME_S_RANGE,
  engineStartOptions, clampIntegrationTimeS, clock, effectiveDropRun,
  fromEngine, loadSequencePrefs, mapEngineReading, measurePlotFrame, metresFromFeet,
  phaseDetail, phaseFill, phaseLabel, preferredAltitudeFeet, preparePlotFrame,
  derivedGramPhase, sampleFrameBuoys, saveSequencePrefs, symbolFill, type MappedGramPhase, type StorageLike,
} from './buoySequence'

function mem(): StorageLike {
  const m = new Map<string, string>()
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v) },
    removeItem: (k) => { m.delete(k) },
  }
}

describe('buoy sequence labels and symbol fill', () => {
  it('uses Wilson Nov 10 title-case full words, never all-caps or short forms', () => {
    expect(GRAM_PHASE_ORDER.map((n) => GRAM_PHASE_LABEL[n])).toEqual([
      'Buoy Loaded', 'Buoy Deployed', 'Descending', 'Integrating', 'Tuned',
    ])
    expect(DETUNED_LABEL).toBe('Detuned')
    for (const l of Object.values(GRAM_PHASE_LABEL)) {
      expect(l).not.toMatch(/^[A-Z]{2,}$/)
      expect(l).not.toBe('DEPLOYED')
      expect(l).not.toBe('LIVE')
      expect(l).not.toBe('TUNED')
    }
  })

  it('steps symbolFill with the five phases and does not invent a countdown', () => {
    const loaded: MappedGramPhase = { name: 'loaded' }
    const deployed: MappedGramPhase = { name: 'deployed' }
    const descending: MappedGramPhase = { name: 'descending' }
    const integrating0: MappedGramPhase = { name: 'integrating', rows: 0, needed: 100 }
    const integrating1: MappedGramPhase = { name: 'integrating', rows: 100, needed: 100 }
    const tuned: MappedGramPhase = { name: 'tuned' }
    expect(symbolFill(loaded)).toBe(0)
    expect(symbolFill(deployed)).toBeCloseTo(0.25, 12)
    expect(symbolFill(descending)).toBeCloseTo(0.5, 12)
    expect(symbolFill({ name: 'descending', etaS: 20, fill: 0.4 })).toBeCloseTo(0.25 + 0.25 * 0.4, 12)
    expect(symbolFill(integrating0)).toBeCloseTo(0.55, 12)
    expect(symbolFill(integrating1)).toBeCloseTo(0.95, 12)
    expect(symbolFill(tuned)).toBe(1)
    expect(phaseFill(loaded)).toBe(0)
    expect(phaseFill({ name: 'integrating', rows: 120, needed: 288 })).toBeCloseTo(120 / 288, 9)
    expect(phaseDetail(descending)).toBeNull()
    expect(phaseDetail({ name: 'descending', etaS: 50 }, 1, true)).toBe('~0:50')
    expect(phaseDetail({ name: 'descending', etaS: 51 }, 1, true)).toBe('~0:51')
    expect(phaseDetail({ name: 'descending', etaS: 50 }, 1, false)).toBe('paused')
    expect(phaseLabel(loaded)).toBe('Buoy Loaded')
    expect(phaseLabel(tuned)).toBe('Tuned')
  })
})

describe('fromEngine seam', () => {
  it('passes Sonya names and gates descending on engine eta', () => {
    expect(DROP_ALTITUDE_M).toBe(457.2)
    expect(DESCENT_RATE_MPS).toBe(9)
    expect(INTEGRATION_TIME_S_DEFAULT).toBe(5)
    expect(INTEGRATION_TIME_S_RANGE).toEqual([5, 10])
    expect(clampIntegrationTimeS(3)).toBe(5)
    expect(clampIntegrationTimeS(12)).toBe(10)
    expect(clampIntegrationTimeS(7)).toBe(7)
    expect(DESCENT_DURATION_S).toBeCloseTo(457.2 / 9, 12)
    expect(metresFromFeet(1500)).toBeCloseTo(457.2, 12)

    const r = fromEngine('descending', 0, 40, 100, 105)
    expect(r?.phase).toBe('descending')
    expect(r?.splashTime).toBe(100)
    expect(r?.liveTime).toBe(105)
    expect(mapEngineReading(r!)).toEqual({ name: 'descending', etaS: 40, fill: null })
    expect(phaseDetail(mapEngineReading(r!), 1)).toBe('~0:40')
    expect(fromEngine('unknown', 0, 0)).toBeNull()
    expect(fromEngine('deployed', 0, 10)?.phase).toBe('deployed')
    expect(fromEngine('integrating', 0.5, 20)?.phase).toBe('integrating')

    const integ = mapEngineReading(fromEngine('integrating', 0.2, 130)!, 600)
    expect(integ).toEqual({ name: 'integrating', rows: 120, needed: 600, etaS: 130 })
    expect(phaseDetail(integ, 1)).toBe('20% · ~2:10')
    expect(phaseDetail(integ, 16)).toBe('20% · ~0:09')
    expect(phaseFill(integ)).toBeCloseTo(0.2, 9)
    expect(mapEngineReading(fromEngine('descending', 0, 0)!).name === 'descending'
      && phaseDetail(mapEngineReading(fromEngine('descending', 0, 0)!)) === null).toBe(true)
  })
})

describe('start-mode prefs', () => {
  it('defaults to Placed, 1500 ft, 5 s, and clamps integration', () => {
    const s = mem()
    const p = loadSequencePrefs(s)
    expect(p).toEqual(DEFAULT_SEQUENCE_PREFS)
    expect(p.startMode).toBe('placed')
    expect(preferredAltitudeFeet(p)).toBe(1500)
    const next = { ...p, startMode: 'unplaced' as const, unplacedLayout: 'manual' as const,
      dropAltitudeM: metresFromFeet(2000), integrationTimeS: clampIntegrationTimeS(12) }
    expect(next.integrationTimeS).toBe(10)
    saveSequencePrefs({ ...next, integrationTimeS: 8 }, s)
    const loaded = loadSequencePrefs(s)
    expect(loaded.startMode).toBe('unplaced')
    expect(loaded.unplacedLayout).toBe('manual')
    expect(preferredAltitudeFeet(loaded)).toBe(2000)
    expect(loaded.integrationTimeS).toBe(8)
    expect(effectiveDropRun(undefined, p)).toBe(false)
    expect(effectiveDropRun(true, p)).toBe(true)
  })

  it('engineStartOptions wires buoyStartMode and autoDropPattern', () => {
    const placed = engineStartOptions({ ...DEFAULT_SEQUENCE_PREFS, startMode: 'placed' })
    expect(placed.buoyStartMode).toBe('placed')
    expect(placed.autoDropPattern).toBe(false)
    const manual = engineStartOptions({ ...DEFAULT_SEQUENCE_PREFS, startMode: 'unplaced', unplacedLayout: 'manual' })
    expect(manual.buoyStartMode).toBe('unplaced')
    expect(manual.autoDropPattern).toBe(false)
    const pattern = engineStartOptions({ ...DEFAULT_SEQUENCE_PREFS, startMode: 'unplaced', unplacedLayout: 'pattern' })
    expect(pattern.autoDropPattern).toBe(true)
    expect(pattern.dropAltitudeM).toBe(457.2)
    expect(pattern.descentRateMps).toBe(9)
    expect(pattern.integrationTimeS).toBe(5)
  })
})

describe('plot frame budget', () => {
  it('keeps 64-buoy CPU work under the 30 fps budget', () => {
    expect(FRAME_BUOY_COUNT).toBe(64)
    expect(FRAME_BUDGET_S).toBeCloseTo(1 / 30, 12)
    const buoys = sampleFrameBuoys(64)
    expect(buoys).toHaveLength(64)
    const r = measurePlotFrame(64, 30)
    expect(r.marks).toBeGreaterThan(64)
    expect(r.seconds).toBeLessThan(FRAME_BUDGET_S)
    const n = preparePlotFrame(buoys, [], { spanM: 18000, cx: 0, cy: 0 }, 390, 844, 1)
    expect(n).toBe(64)
  })
})

describe('clock', () => {
  it('rounds up to m:ss and h:mm:ss', () => {
    expect(clock(50)).toBe('0:50')
    expect(clock(64.5)).toBe('1:05')
    expect(clock(3725)).toBe('1:02:05')
  })
})

describe('derivedGramPhase', () => {
  it('follows loaded → deployed → integrating → tuned and never invents descending', () => {
    const d = (t: number, extra: Partial<Parameters<typeof derivedGramPhase>[0]> = {}) =>
      derivedGramPhase({ simTime: t, deployedAt: 100, feeding: true, rowRateHz: 2, rowsNeeded: 100, ...extra })
    expect(d(0).name).toBe('loaded')
    expect(d(99.9).name).toBe('loaded')
    expect(d(100).name).toBe('deployed')
    expect(d(100.4).name).toBe('deployed')
    expect(d(100.5)).toEqual({ name: 'integrating', rows: 1, needed: 100 })
    expect(d(150).name).toBe('tuned')
    expect(d(300, { feeding: false }).name).toBe('deployed')
  })
})
