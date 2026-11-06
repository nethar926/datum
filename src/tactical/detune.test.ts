import { describe, expect, it } from 'vitest'
import {
  BUOY_STATUS_COLOR,
  DetuneStore,
  INTEGRATE_MS,
  MAX_CHANNELS,
  lowestFreeChannel,
  paintHealth,
  reserveChannels,
  usedChannels,
} from './detune'

describe('channel allocation', () => {
  it('picks the lowest free channel in 1..max', () => {
    expect(lowestFreeChannel(new Set())).toBe(1)
    expect(lowestFreeChannel(new Set([1, 2, 4]))).toBe(3)
    expect(lowestFreeChannel(new Set([1, 2, 3]), 3)).toBeNull()
  })

  it('reserves a contiguous lowest-free block or returns null (NO CH)', () => {
    expect(reserveChannels(3, new Set([1, 3]))).toEqual([2, 4, 5])
    expect(reserveChannels(0, new Set([1]))).toEqual([])
    const almost = new Set<number>()
    for (let i = 1; i <= MAX_CHANNELS; i++) almost.add(i)
    expect(reserveChannels(1, almost)).toBeNull()
    almost.delete(7)
    expect(reserveChannels(1, almost)).toEqual([7])
  })

  it('ignores detuned channels when computing used', () => {
    const used = usedChannels([
      { buoyId: 11, health: 'working', channel: 11, integrateUntil: null },
      { buoyId: 12, health: 'detuned', channel: null, integrateUntil: null },
      { buoyId: 13, health: 'integrating', channel: 5, integrateUntil: 1 },
    ])
    expect([...used].sort((a, b) => a - b)).toEqual([5, 11])
  })
})

describe('paintHealth', () => {
  it('maps white/green/red/yellow with engine dead and FE error priority', () => {
    expect(paintHealth(undefined, 'live')).toBe('working')
    expect(paintHealth(undefined, 'falling')).toBe('integrating')
    expect(paintHealth(undefined, 'dead')).toBe('dead')
    expect(paintHealth({ buoyId: 1, health: 'detuned', channel: null, integrateUntil: null }, 'live')).toBe('detuned')
    expect(paintHealth({ buoyId: 1, health: 'working', channel: 1, integrateUntil: null }, 'dead')).toBe('dead')
    expect(paintHealth({ buoyId: 1, health: 'error', channel: 1, integrateUntil: null }, 'dead')).toBe('error')
  })

  it('keeps HIG status colours distinct on dark', () => {
    expect(BUOY_STATUS_COLOR.working.toLowerCase()).toMatch(/^#f/)
    expect(BUOY_STATUS_COLOR.detuned).toBe(BUOY_STATUS_COLOR.integrating)
    expect(BUOY_STATUS_COLOR.dead.toLowerCase()).toMatch(/^#ff/)
    expect(BUOY_STATUS_COLOR.error.toLowerCase()).toMatch(/^#ffd/)
  })
})

describe('DetuneStore state machine', () => {
  it('seeds scenario buoys as working, then manual drops as integrating → working', () => {
    const s = new DetuneStore()
    s.syncTactical([
      { id: 11, channel: 11, state: 'live' },
      { id: 12, channel: 12, state: 'live' },
    ])
    expect(s.get(11)).toMatchObject({ health: 'working', channel: 11 })
    s.noteDropped([40], 1000)
    expect(s.get(40)).toMatchObject({ health: 'integrating', channel: 40, integrateUntil: 1000 + INTEGRATE_MS })
    expect(s.progress(40, 1000)).toBe(0)
    expect(s.progress(40, 1000 + INTEGRATE_MS / 2)).toBeCloseTo(0.5, 3)
    expect(s.tick(1000 + INTEGRATE_MS - 1)).toBe(false)
    expect(s.get(40)?.health).toBe('integrating')
    expect(s.tick(1000 + INTEGRATE_MS)).toBe(true)
    expect(s.get(40)).toMatchObject({ health: 'working', integrateUntil: null })
    expect(s.progress(40, 9999)).toBeNull()
  })

  it('DETUNE frees the channel; TUNE reclaims the lowest free', () => {
    const s = new DetuneStore()
    s.syncTactical([
      { id: 1, channel: 1, state: 'live' },
      { id: 2, channel: 2, state: 'live' },
      { id: 3, channel: 3, state: 'live' },
    ])
    expect(s.detune(2)).toEqual({ ok: true, channel: null })
    expect(s.get(2)).toMatchObject({ health: 'detuned', channel: null })
    expect([...s.used()].sort((a, b) => a - b)).toEqual([1, 3])
    expect(s.detune(2).ok).toBe(false)
    const t = s.tune(2, 5000)
    expect(t).toEqual({ ok: true, channel: 2 })
    expect(s.get(2)).toMatchObject({ health: 'integrating', channel: 2, integrateUntil: 5000 + INTEGRATE_MS })
  })

  it('allocateForDrop / tune surface NO CH when the pool is full', () => {
    const s = new DetuneStore()
    const buoys = Array.from({ length: MAX_CHANNELS }, (_, i) => ({
      id: i + 1, channel: i + 1, state: 'live' as const,
    }))
    s.syncTactical(buoys)
    expect(s.allocateForDrop(1)).toBeNull()
    expect(s.noCh).toBe('NO CH')
    s.clearNoCh()
    expect(s.noCh).toBeNull()
    expect(s.detune(1).ok).toBe(true)
    expect(s.allocateForDrop(1)).toEqual([1])
    expect(s.tune(1)).toMatchObject({ ok: true, channel: 1 })

    // Smaller pool: two tuned hold every slot while a third is detuned → TUNE returns NO CH.
    const tiny = new DetuneStore(2)
    tiny.syncTactical([
      { id: 1, channel: 1, state: 'live' },
      { id: 2, channel: 2, state: 'live' },
      { id: 3, channel: 3, state: 'live' },
    ])
    expect(tiny.detune(3).ok).toBe(true)
    expect(tiny.tune(3)).toEqual({ ok: false, reason: 'NO CH' })
    expect(tiny.noCh).toBe('NO CH')
  })

  it('setHealth is the FE/test hook for red and yellow', () => {
    const s = new DetuneStore()
    s.syncTactical([{ id: 9, channel: 9, state: 'live' }])
    expect(s.setHealth(9, 'error')).toBe(true)
    expect(s.get(9)?.health).toBe('error')
    expect(paintHealth(s.get(9), 'live')).toBe('error')
    expect(s.setHealth(9, 'dead')).toBe(true)
    expect(s.get(9)?.health).toBe('dead')
    expect(s.setHealth(9, 'working')).toBe(true)
    expect(s.get(9)?.health).toBe('working')
  })

  it('syncTactical drops rows for buoys that left the field and upgrades engine-dead', () => {
    const s = new DetuneStore()
    s.syncTactical([{ id: 1, channel: 1, state: 'live' }, { id: 2, channel: 2, state: 'live' }])
    s.syncTactical([{ id: 1, channel: 1, state: 'dead' }])
    expect(s.get(2)).toBeUndefined()
    expect(s.get(1)?.health).toBe('dead')
  })
})
