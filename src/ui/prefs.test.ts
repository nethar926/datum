import { beforeEach, describe, expect, it } from 'vitest'
import {
  ALI_KEY, HORZ_KEY, SPLIT_DEFAULT_V, SPLIT_KEY_V, SPLIT_MIN_GRAM_PX, SPLIT_MIN_PLOT_PX, clampSplit, loadAli, loadHorz, loadSplit,
  parseGlass, parseScheme, parseTab, resolveGlass, resolveScheme, saveAli, saveHorz, saveSplit,
} from './prefs'

// Minimal localStorage for the node test environment.
const mem = new Map<string, string>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
  }
})

describe('clampSplit', () => {
  it('passes a sane fraction through', () => {
    expect(clampSplit(0.6, 500)).toBeCloseTo(0.6, 12)
  })
  it('keeps the gram pane at least SPLIT_MIN_GRAM_PX', () => {
    const f = clampSplit(0.05, 500)
    expect(f * 500).toBeCloseTo(SPLIT_MIN_GRAM_PX, 9)
  })
  it('keeps the plot pane at least SPLIT_MIN_PLOT_PX', () => {
    const f = clampSplit(0.99, 500)
    expect((1 - f) * 500).toBeCloseTo(SPLIT_MIN_PLOT_PX, 9)
  })
  it('shares proportionally when the total cannot fit both minimums', () => {
    const f = clampSplit(0.9, 200)
    expect(f).toBeCloseTo(SPLIT_MIN_GRAM_PX / (SPLIT_MIN_GRAM_PX + SPLIT_MIN_PLOT_PX), 12)
  })
  it('falls back on NaN and on an unknown total', () => {
    expect(clampSplit(NaN, 500)).toBeCloseTo(SPLIT_DEFAULT_V, 12)
    expect(clampSplit(0.99, 0)).toBe(0.9)
    expect(clampSplit(0.01, 0)).toBe(0.1)
  })
  it('honours custom minimums', () => {
    expect(clampSplit(0.1, 1000, 300, 100)).toBeCloseTo(0.3, 12)
    expect(clampSplit(0.95, 1000, 300, 100)).toBeCloseTo(0.9, 12)
  })
  it('persists and reloads, ignoring junk', () => {
    expect(loadSplit(SPLIT_KEY_V, 0.6)).toBe(0.6)
    saveSplit(SPLIT_KEY_V, 0.4321)
    expect(loadSplit(SPLIT_KEY_V, 0.6)).toBeCloseTo(0.4321, 4)
    mem.set(SPLIT_KEY_V, 'banana'); expect(loadSplit(SPLIT_KEY_V, 0.6)).toBe(0.6)
    mem.set(SPLIT_KEY_V, '1.5'); expect(loadSplit(SPLIT_KEY_V, 0.6)).toBe(0.6)
  })
})

describe('HORZ toggle persistence', () => {
  it('is off by default', () => {
    expect(loadHorz()).toBe(false)
  })
  it('round-trips on and off through localStorage', () => {
    saveHorz(true); expect(mem.get(HORZ_KEY)).toBe('1'); expect(loadHorz()).toBe(true)
    saveHorz(false); expect(mem.get(HORZ_KEY)).toBe('0'); expect(loadHorz()).toBe(false)
  })
  it('treats anything but "1" as off and survives a throwing storage', () => {
    mem.set(HORZ_KEY, 'true'); expect(loadHorz()).toBe(false)
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadHorz()).toBe(false)
    expect(() => saveHorz(true)).not.toThrow()
  })
})

describe('ALI toggle persistence', () => {
  it('is off by default', () => {
    expect(loadAli()).toBe(false)
  })
  it('round-trips on and off through localStorage', () => {
    saveAli(true); expect(mem.get(ALI_KEY)).toBe('1'); expect(loadAli()).toBe(true)
    saveAli(false); expect(mem.get(ALI_KEY)).toBe('0'); expect(loadAli()).toBe(false)
  })
  it('treats anything but "1" as off and survives a throwing storage', () => {
    mem.set(ALI_KEY, 'true'); expect(loadAli()).toBe(false)
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadAli()).toBe(false)
    expect(() => saveAli(true)).not.toThrow()
  })
})

describe('appearance, glass and tab parsing', () => {
  it('scheme', () => {
    expect(parseScheme('light')).toBe('light'); expect(parseScheme('x')).toBe('system')
    expect(resolveScheme('system', true)).toBe('dark'); expect(resolveScheme('system', false)).toBe('light'); expect(resolveScheme('dark', false)).toBe('dark')
  })
  it('glass', () => {
    expect(parseGlass('reduced')).toBe('reduced'); expect(parseGlass(null)).toBe('auto')
    expect(resolveGlass('auto', true)).toBe('reduced'); expect(resolveGlass('auto', false)).toBe('full'); expect(resolveGlass('full', true)).toBe('full')
  })
  it('tab', () => { expect(parseTab('plot')).toBe('plot'); expect(parseTab('nope')).toBe('live') })
})
