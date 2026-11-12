import { describe, it, expect } from 'vitest'
import { AcousticEngine, cpaScenario } from '@acoustics'
import {
  HistoryDrain, drainKind, drainKindAge, isFillingValue, FILLING_SENTINEL, seedFillingRing, applyLandedToRing,
} from './historyDrain'

function primed(res: 5 = 5, n = 16) {
  const s = cpaScenario()
  s.buoys = [{ ...s.buoys[0]!, id: 'buoy-1', rfChannel: 1, x: 0, y: 0, deployedAt: 0 }]
  const e = new AcousticEngine(s)
  const c = e.subscribe({ channel: 1, res })
  const out = new Float32Array(c.bins)
  for (let i = 0; i < n; i++) { e.advance(2); e.writeRow(c.streamId, out) }
  return { e, id: c.streamId, bins: c.bins }
}

describe('historyDrain filling', () => {
  it('first chunk covers visible rows', () => {
    const { e, id } = primed()
    const d = new HistoryDrain(e)
    const ev = d.start(id, 3, 16, 8)
    expect(ev).toBeTruthy()
    expect(d.state).toBe('running')
    expect(ev!.totalRows).toBe(16)
    expect(ev!.filledFrom).toBe(8)
    expect(ev!.fromRow).toBe(8)
    expect(ev!.toRow).toBe(15)
    expect(ev!.data.length).toBe(8 * ev!.bins)
    for (let k = 0; k < 8; k++) expect(drainKind(k, ev!.filledFrom)).toBe('filling')
    for (let k = 8; k < 16; k++) expect(drainKind(k, ev!.filledFrom)).toBe('ready')
    // Ready payload is real dB, not filling / not an all-NaN row.
    const row0 = ev!.data.subarray(0, ev!.bins)
    expect(row0.every(Number.isNaN)).toBe(false)
    expect(row0.some(isFillingValue)).toBe(false)
  })

  it('unfilled rows render as filling (keyed off filledFrom, not NaN)', () => {
    const { e, id } = primed()
    const d = new HistoryDrain(e)
    const ev = d.start(id, 5, 16, 4)!
    const ring = seedFillingRing(16, ev.bins)
    applyLandedToRing(ring, 16, ev.bins, ev)
    for (let age = 0; age < 16; age++) {
      const kind = drainKindAge(age, ev.totalRows, ev.filledFrom)
      const destRow = 16 - 1 - age
      const row = ring.subarray(destRow * ev.bins, destRow * ev.bins + ev.bins)
      if (kind === 'filling') {
        expect(row.every(isFillingValue)).toBe(true)
        expect(row.some(Number.isNaN)).toBe(false)
      } else {
        expect(row.every(isFillingValue)).toBe(false)
      }
    }
    // A real-looking value in an unfilled slot must still be treated as filling.
    expect(drainKind(3, ev.filledFrom)).toBe('filling')
    expect(isFillingValue(12)).toBe(false)
    expect(isFillingValue(Number.NaN)).toBe(false)
    expect(isFillingValue(FILLING_SENTINEL)).toBe(true)
  })

  it('cancel on switch-back freezes and a new handle starts clean (no mixed rows)', () => {
    const { e, id } = primed()
    const d = new HistoryDrain(e)
    const first = d.start(id, 3, 16, 4)!
    const firstId = first.handleId
    expect(d.state).toBe('running')
    const second = d.start(id, 5, 16, 8)!
    expect(second.handleId).not.toBe(firstId)
    expect(second.filledFrom).toBe(8)
    expect(second.data.length).toBe(8 * second.bins)
    expect(drainKind(7, second.filledFrom)).toBe('filling')
    expect(drainKind(8, second.filledFrom)).toBe('ready')
    // New buffer is only the new handle's first chunk — no leftover ready window from the cancelled drain.
    expect(second.filledFrom).not.toBe(first.filledFrom)
  })

  it('handle and listener are released (no leak)', () => {
    const { e, id } = primed()
    const box = { calls: 0, evs: [] as number[] }
    const d = new HistoryDrain(e)
    d.start(id, 3, 16, 4, 0, (ev) => { box.calls++; box.evs.push(ev.handleId) })
    expect(box.calls).toBeGreaterThan(0)
    const calls = box.calls
    d.release()
    expect(d.handleId).toBeUndefined()
    expect(d.state).toBeUndefined()
    d.pump({ budgetMs: 16 })
    expect(box.calls).toBe(calls)
  })
})
