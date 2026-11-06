import { describe, expect, it } from 'vitest'
import { afterTeardown, channelAllowsListen, gateListen, nextMutePhase } from './mute'

describe('gateListen', () => {
  const ok = { userOn: true, liveTab: true, visible: true, channelOk: true }
  it('passes only when every gate is open', () => {
    expect(gateListen(ok).gated).toBe(true)
    expect(gateListen(ok).reasons).toEqual([])
  })
  it('collects reasons', () => {
    const r = gateListen({ userOn: false, liveTab: false, visible: false, channelOk: false })
    expect(r.gated).toBe(false)
    expect(r.reasons).toEqual(['user', 'cuts', 'hidden', 'channel'])
  })
})

describe('channelAllowsListen', () => {
  it('allows working/integrating only', () => {
    expect(channelAllowsListen('working')).toBe(true)
    expect(channelAllowsListen('integrating')).toBe(true)
    expect(channelAllowsListen('detuned')).toBe(false)
    expect(channelAllowsListen('dead')).toBe(false)
    expect(channelAllowsListen('error')).toBe(false)
  })
})

describe('mute phase machine', () => {
  it('boots muted; unmute → starting → running', () => {
    expect(nextMutePhase('muted', true, false)).toBe('starting')
    expect(nextMutePhase('starting', true, true)).toBe('running')
  })
  it('running → teardown on gate close', () => {
    expect(nextMutePhase('running', false, true)).toBe('teardown')
  })
  it('afterTeardown lands muted or silenced', () => {
    expect(afterTeardown(false, false)).toBe('muted')
    expect(afterTeardown(true, false)).toBe('silenced')
    expect(afterTeardown(true, true)).toBe('starting')
  })
})
