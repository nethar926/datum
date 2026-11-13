import { beforeEach, describe, expect, it } from 'vitest'
import {
  ALI_KEY, BFI_KEY, BFI_PRESET_KEY, BFI_RANGES_KEY, HORZ_KEY, SPLIT_DEFAULT_V, SPLIT_KEY_V, SPLIT_MIN_GRAM_PX, SPLIT_MIN_PLOT_PX,
  clampSplit, loadAli, loadBfi, loadBfiPreset, loadBfiRanges, loadHorz, loadSplit,
  ACCENT_DEFAULT, ACCENT_KEY, ACCENT_LABEL, ACCENT_PAIRED_ICON, ACCENTS,
  parseAccent, parseBfiPreset, parseGlass, parseScheme, parseTab, resolveGlass, resolveScheme, loadAccent, saveAccent,
  saveAli, saveBfi, saveBfiPreset, saveBfiRanges, saveHorz, saveSplit,
} from './prefs'
import { BFI_DEFAULT_RANGES } from '../gram/bfi'

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

describe('BFI toggle persistence', () => {
  it('is off by default', () => {
    expect(loadBfi()).toBe(false)
  })
  it('round-trips on and off through localStorage', () => {
    saveBfi(true); expect(mem.get(BFI_KEY)).toBe('1'); expect(loadBfi()).toBe(true)
    saveBfi(false); expect(mem.get(BFI_KEY)).toBe('0'); expect(loadBfi()).toBe(false)
  })
  it('treats anything but "1" as off and survives a throwing storage', () => {
    mem.set(BFI_KEY, 'true'); expect(loadBfi()).toBe(false)
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadBfi()).toBe(false)
    expect(() => saveBfi(true)).not.toThrow()
  })
})

describe('BFI preset defaults, edits and persistence', () => {
  it('defaults to BFI 1 and the documented Hz ranges', () => {
    expect(loadBfiPreset()).toBe(1)
    expect(loadBfiRanges()).toEqual(BFI_DEFAULT_RANGES)
    expect(parseBfiPreset('2')).toBe(2)
    expect(parseBfiPreset('9')).toBe(1)
    expect(parseBfiPreset(null)).toBe(1)
  })
  it('persists a preset choice and an edited range', () => {
    saveBfiPreset(3)
    expect(mem.get(BFI_PRESET_KEY)).toBe('3')
    expect(loadBfiPreset()).toBe(3)
    const ranges = loadBfiRanges()
    ranges[3] = { loHz: 30, hiHz: 250 }
    saveBfiRanges(ranges)
    expect(loadBfiRanges()[3]).toEqual({ loHz: 30, hiHz: 250 })
    expect(loadBfiRanges()[1]).toEqual({ loHz: 10, hiHz: 100 })
  })
  it('clamps inverted and junk stored ranges', () => {
    mem.set(BFI_RANGES_KEY, JSON.stringify({ 2: { loHz: 80, hiHz: 20 } }))
    expect(loadBfiRanges()[2]).toEqual({ loHz: 20, hiHz: 80 })
    mem.set(BFI_RANGES_KEY, 'banana')
    expect(loadBfiRanges()).toEqual(BFI_DEFAULT_RANGES)
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(loadBfiPreset()).toBe(1)
    expect(loadBfiRanges()).toEqual(BFI_DEFAULT_RANGES)
    expect(() => saveBfiPreset(2)).not.toThrow()
    expect(() => saveBfiRanges(BFI_DEFAULT_RANGES)).not.toThrow()
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

describe('accent colour', () => {
  it('parses the five choices, defaults to green, and migrates graphite', () => {
    expect(ACCENTS).toEqual(['green', 'blue', 'amber', 'red', 'gray'])
    expect(ACCENT_DEFAULT).toBe('green')
    expect(ACCENT_LABEL.blue).toBe('Blue')
    expect(parseAccent('blue')).toBe('blue')
    expect(parseAccent('graphite')).toBe('gray')
    expect(parseAccent('teal')).toBe('green')
    expect(parseAccent(null)).toBe('green')
    expect(loadAccent()).toBe('green')
    saveAccent('blue')
    expect(mem.get(ACCENT_KEY)).toBe('blue')
    expect(loadAccent()).toBe('blue')
  })
  it('pairs Blue with the DATUM Blue CRT icon id', () => {
    expect(ACCENT_PAIRED_ICON.green).toBe('')
    expect(ACCENT_PAIRED_ICON.blue).toBe('AppIcon-BlueCRT')
    expect(ACCENT_PAIRED_ICON.red).toBe('AppIcon-RedCRT')
    expect(ACCENT_PAIRED_ICON.amber).toBeNull()
    expect(ACCENT_PAIRED_ICON.gray).toBeNull()
  })
})
