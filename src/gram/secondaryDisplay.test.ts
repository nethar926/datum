import { beforeEach, describe, expect, it } from 'vitest'
import {
  SECONDARY_KEY, fillsCompanion, loadSecondary, parseSecondary, resolveSecondary,
  saveSecondary, SECONDARY_DISPLAYS, SECONDARY_TITLE,
} from './secondaryDisplay'

describe('secondary display (companion pane)', () => {
  const mem = new Map<string, string>()
  beforeEach(() => {
    mem.clear()
    const ls = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v) },
      removeItem: (k: string) => { mem.delete(k) },
    }
    ;(globalThis as { localStorage?: unknown }).localStorage = ls
  })

  it('defaults to the plot, lists Plot and BFI, and both fill the companion', () => {
    expect(SECONDARY_DISPLAYS).toEqual(['plot', 'bfi'])
    expect(SECONDARY_TITLE.plot).toBe('Plot')
    expect(SECONDARY_TITLE.bfi).toBe('BFI')
    expect(loadSecondary()).toBe('plot')
    expect(parseSecondary(null)).toBe('plot')
    expect(parseSecondary('nope')).toBe('plot')
    expect(fillsCompanion('plot')).toBe(true)
    expect(fillsCompanion('bfi')).toBe(true)
  })

  it('round-trips through localStorage', () => {
    saveSecondary('bfi')
    expect(mem.get(SECONDARY_KEY)).toBe('bfi')
    expect(loadSecondary()).toBe('bfi')
    saveSecondary('plot')
    expect(loadSecondary()).toBe('plot')
  })

  it('survives a throwing storage and treats anything but "bfi" as plot', () => {
    mem.set(SECONDARY_KEY, 'BFI')
    expect(loadSecondary()).toBe('plot')
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(loadSecondary()).toBe('plot')
    expect(() => saveSecondary('bfi')).not.toThrow()
  })

  it('resolves BFI only on DIFAR; omni falls back to the plot', () => {
    expect(resolveSecondary('bfi', true)).toBe('bfi')
    expect(resolveSecondary('bfi', false)).toBe('plot')
    expect(resolveSecondary('plot', true)).toBe('plot')
    expect(resolveSecondary('plot', false)).toBe('plot')
  })
})
