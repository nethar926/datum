import { describe, expect, it } from 'vitest'
import { HandoffMachine, handoffLabel, type HandoffEvent } from './handoff'
import type { GramConfig } from '../engine/contract'

const cfgs = (ids: number[], res = 1): GramConfig[] => ids.map((streamId, i) => ({ v: 1, type: 'gramConfig', streamId, kind: 'lofar', channel: i + 1, bins: 1024, f0: 0, fBin: 0.03125 * 2 ** (res - 1), rowRateHz: 0.5, dbFloor: 0, dbCeil: 30, res, filter: 'NB' }))
const D = { res: 2, filter: 'NB' as const }

describe('gram handoff state machine', () => {
  it('pending → ready → promote once every pending stream has fillRows rows', () => {
    const m = new HandoffMachine(4, 3000)
    const ev = m.begin(D, { res: 1, filter: 'NB' }, 0)
    expect(ev).toEqual([{ type: 'subscribe', gen: 1, target: { res: 1, filter: 'NB' } }])
    expect(m.phase).toBe('pending')
    expect(m.tick(10)).toBeNull() // not announced yet
    expect(m.announce(1, cfgs([7, 8]))).toBe(true)
    for (let k = 0; k < 4; k++) m.row(7)
    for (let k = 0; k < 3; k++) m.row(8)
    expect(m.ready()).toBe(false); expect(m.progress()).toBeCloseTo(0.75)
    expect(m.tick(100)).toBeNull()
    m.row(99) // not a pending stream: ignored
    m.row(8)
    expect(m.ready()).toBe(true)
    const p = m.tick(200) as Extract<HandoffEvent, { type: 'promote' }>
    expect(p.type).toBe('promote'); expect(p.gen).toBe(1); expect(p.configs.map((c) => c.streamId)).toEqual([7, 8])
    expect(m.phase).toBe('idle'); expect(m.live.size).toBe(0)
    expect(m.tick(300)).toBeNull()
  })

  it('timeout fallback promotes with too few rows (slow RES or paused sim cannot hang)', () => {
    const m = new HandoffMachine(600, 3000)
    m.begin(D, { res: 1, filter: 'NB' }, 1000)
    m.announce(1, cfgs([7, 8])); m.row(7)
    expect(m.tick(3999)).toBeNull()
    expect(m.tick(4000)?.type).toBe('promote')
  })

  it('a change mid-handoff drops the pending set (not the displayed one) and starts a fresh one', () => {
    const m = new HandoffMachine(4, 3000)
    m.begin(D, { res: 1, filter: 'NB' }, 0); m.announce(1, cfgs([7, 8])); m.row(7)
    const ev = m.begin(D, { res: 3, filter: 'NB' }, 500)
    expect(ev).toEqual([{ type: 'drop', gen: 1 }, { type: 'subscribe', gen: 2, target: { res: 3, filter: 'NB' } }])
    expect(m.from).toEqual(D) // still measured from what is on screen
    expect(m.rows()).toBe(0); expect(m.startedAt).toBe(500)
    expect(m.announce(1, cfgs([7, 8]))).toBe(false) // stale announcement ignored
    m.row(7); expect(m.rows()).toBe(0)
    expect(m.announce(2, cfgs([9, 10], 3))).toBe(true)
    expect(m.tick(3499)).toBeNull() // timeout restarts with the new request
    expect(m.tick(3500)).toMatchObject({ type: 'promote', gen: 2 })
  })

  it('going back to the displayed settings mid-handoff only drops the pending set', () => {
    const m = new HandoffMachine()
    m.begin(D, { res: 1, filter: 'NB' }, 0)
    expect(m.begin(D, { res: 2, filter: 'NB' }, 10)).toEqual([{ type: 'drop', gen: 1 }])
    expect(m.phase).toBe('idle'); expect(m.live.size).toBe(0)
    expect(m.begin(D, { ...D }, 20)).toEqual([]) // no-op change
  })

  it('never holds more than one live subscription over many rapid changes', () => {
    const m = new HandoffMachine(4, 3000)
    let subs = 0, drops = 0, promotes = 0, t = 0
    for (let i = 0; i < 500; i++) {
      t += 37
      for (const e of m.begin(D, { res: 1 + (i % 9 === 1 ? 3 : i % 9), filter: i % 2 ? 'BB' : 'NB', ...(i % 5 === 0 ? { vernierHz: 50 } : {}) }, t)) { if (e.type === 'subscribe') subs++; if (e.type === 'drop') drops++ }
      expect(m.live.size).toBeLessThanOrEqual(1)
      if (i % 7 === 0 && m.phase === 'pending') { m.announce(m.gen, cfgs([1000 + i])); const e = m.tick(t + 5000); if (e?.type === 'promote') promotes++ }
    }
    if (m.phase === 'pending') { m.announce(m.gen, cfgs([1])); if (m.tick(t + 9999)?.type === 'promote') promotes++ }
    expect(m.live.size).toBe(0)
    expect(subs).toBe(drops + promotes) // every subscribe ended in exactly one drop or promote
  })

  it('drops a request the worker never answers', () => {
    const m = new HandoffMachine(4, 3000, 5000)
    m.begin(D, { res: 1, filter: 'NB' }, 0)
    expect(m.tick(4999)).toBeNull() // past the fill timeout but nothing to promote yet
    expect(m.tick(5000)).toEqual({ type: 'drop', gen: 1 })
    expect(m.live.size).toBe(0)
  })

  it('labels the change', () => {
    expect(handoffLabel({ res: 2, filter: 'NB' }, { res: 1, filter: 'NB' }, 0.5)).toBe('RES 2 → 1  FILLING 50%')
    expect(handoffLabel({ res: 5, filter: 'NB' }, { res: 5, filter: 'BB' }, 1)).toBe('NB → BB  FILLING 100%')
    expect(handoffLabel({ res: 5, filter: 'NB' }, { res: 5, filter: 'NB', vernierHz: 50 }, 0)).toBe('VERNIER → 50 Hz  FILLING 0%')
    expect(handoffLabel({ res: 5, filter: 'NB', vernierHz: 50 }, { res: 5, filter: 'NB' }, 0)).toBe('VERNIER OFF  FILLING 0%')
  })
})
