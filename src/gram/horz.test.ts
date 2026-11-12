import { describe, expect, it } from 'vitest'
import { formatZuluHms, isReviewing } from '../touch/scrollBack'
import { formatZuluSec } from './timeAxis'
import { horzAtPointer, horzSimS, horzZulu, liveReadout, newestRowSimS, readoutHz } from './horz'

describe('HORZ time label', () => {
  const origin = Date.UTC(1970, 0, 1, 13, 5, 9)
  it('uses HHmmssZ at the live edge and HH:MM:SSz in scroll-back', () => {
    expect(isReviewing(0)).toBe(false)
    expect(isReviewing(1)).toBe(true)
    expect(horzZulu(61, origin, 0)).toBe('130610Z')
    expect(horzZulu(61, origin, 0)).toBe(formatZuluSec(61, origin))
    expect(horzZulu(61, origin, 12)).toBe('13:06:10z')
    expect(horzZulu(61, origin, 12)).toBe(formatZuluHms(61, origin))
  })
})

describe('live readout: HORZ reads time, Hz is the finger’s x', () => {
  it('puts Zulu alongside finger Hz, and dB when the crosshair is on', () => {
    expect(liveReadout({ hz: 123.4, fBin: 0.5, horzZulu: '130610Z', crosshair: true, db: -42.1 }))
      .toBe('130610Z  123.4 Hz · bin 247  -42.1 dB')
    expect(liveReadout({ hz: null, fBin: 0.5, horzZulu: '13:06:10z' })).toBe('13:06:10z')
    expect(liveReadout({ hz: 100, fBin: 0.5 })).toBe('100.0 Hz · bin 200')
    expect(liveReadout({ hz: null, fBin: 0.5, crosshair: true })).toBe('-- dB')
    expect(liveReadout({ hz: null, fBin: 0.5 })).toBe(null)
  })
  it('prefers finger Hz over the locked hairline', () => {
    expect(readoutHz(120, 400)).toBe(120)
    expect(readoutHz(null, 400)).toBe(400)
    expect(readoutHz(null, null)).toBe(null)
  })
})

describe('pointer: mouse hover, mouse drag, and touch drag share the same rules', () => {
  const ago = (y: number, h: number, historyS: number) => (1 - y / h) * historyS
  const hzAtX = (x: number, w: number, fMax = 512) => (x / w) * fMax

  it('touch down+move (and mouse drag) updates HORZ ago and finger Hz', () => {
    const horz = true, locked = false, cursorHz: number | null = null
    const down = horzAtPointer({
      x: 100, y: 150, w: 400, h: 300, hzAtX: hzAtX(100, 400), agoS: ago(150, 300, 1200),
      horz, locked, cursorHz,
    })
    expect(down.hoverAgo).toBeCloseTo(ago(150, 300, 1200))
    expect(down.fingerHz).toBeCloseTo(hzAtX(100, 400))
    expect(down.cursorHz).toBeCloseTo(down.fingerHz)

    const move = horzAtPointer({
      x: 123, y: 60, w: 400, h: 300, hzAtX: hzAtX(123, 400), agoS: ago(60, 300, 1200),
      horz, locked, cursorHz: down.cursorHz,
    })
    expect(move.hoverAgo).toBeCloseTo(ago(60, 300, 1200)) // HORZ line reads time at the finger's y
    expect(move.fingerHz).toBeCloseTo(hzAtX(123, 400))
    expect(move.cursorHz).toBe(move.fingerHz)
    const text = liveReadout({ hz: readoutHz(move.fingerHz, move.cursorHz), fBin: 0.5, horzZulu: horzZulu((500 - move.hoverAgo!), 0, 0) })
    expect(text).toMatch(/Z  /)
    expect(text).toMatch(/Hz/)
  })

  it('locked: hairline Hz stays, HORZ ago and the Hz readout follow the finger (touch or mouse)', () => {
    const move = horzAtPointer({
      x: 80, y: 120, w: 400, h: 300, hzAtX: hzAtX(80, 400), agoS: ago(120, 300, 1200),
      horz: true, locked: true, cursorHz: 400,
    })
    expect(move.cursorHz).toBe(400)
    expect(move.fingerHz).toBeCloseTo(hzAtX(80, 400))
    expect(move.hoverAgo).toBeCloseTo(ago(120, 300, 1200))
    expect(readoutHz(move.fingerHz, move.cursorHz)).toBe(move.fingerHz)
  })

  it('without HORZ, ago is not set (the vertical cursor still reports finger Hz when free)', () => {
    const move = horzAtPointer({
      x: 80, y: 120, w: 400, h: 300, hzAtX: hzAtX(80, 400), agoS: ago(120, 300, 1200),
      horz: false, locked: false, cursorHz: null,
    })
    expect(move.hoverAgo).toBeNull()
    expect(move.fingerHz).toBeCloseTo(hzAtX(80, 400))
    expect(move.cursorHz).toBe(move.fingerHz)
  })
})

describe('HORZ time matches the row sim time at RES 1 and RES 5', () => {
  const origin = Date.UTC(1970, 0, 1, 13, 0, 0)
  const cases = [
    { res: 1, period: 8, k: 2, newest: 48, simTime: 48 + 1.5 },
    { res: 5, period: 2, k: 3, newest: 48, simTime: 48 + 1.5 },
  ]
  for (const c of cases) {
    it(`RES ${c.res}: label on row ${c.k} back equals that row's sim time`, () => {
      const ageS = c.k * c.period
      const expectedT = c.newest - c.k * c.period
      // Without rowPhaseS: row clock is newestRowSimT − k·P, not live simTime − k·P.
      const actualT = horzSimS({ ageS, periodS: c.period, newestRowSimT: c.newest, simTime: c.simTime })
      expect(actualT).toBeCloseTo(expectedT, 9)
      expect(horzZulu(actualT, origin, 1)).toBe(horzZulu(expectedT, origin, 1))
      // The previous nowS − ago path is the mismatch this pins (RES 1: 41.5 vs 32).
      expect(c.simTime - ageS).not.toBeCloseTo(expectedT, 9)

      const phase = 0.5
      const simTime = c.newest + phase + 1.25
      const newestPhased = newestRowSimS({ periodS: c.period, rowPhaseS: phase, newestRowSimT: 0, simTime })
      expect(newestPhased).toBeCloseTo(c.newest + phase, 9)
      const expectedPhased = newestPhased - c.k * c.period
      const actualPhased = horzSimS({ ageS, periodS: c.period, rowPhaseS: phase, newestRowSimT: 99, simTime })
      expect(actualPhased).toBeCloseTo(expectedPhased, 9)
      expect(horzZulu(actualPhased, origin, 1)).toBe(horzZulu(expectedPhased, origin, 1))
    })
  }
})
