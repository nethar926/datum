import { beforeEach, describe, expect, it } from 'vitest'
import {
  A2HS_HIDE_KEY, installPlatform, isStandalone, isTouchDevice, loadHideA2hs, saveHideA2hs,
  shouldOfferHomeScreen, showHomeScreenCard, type StorageLike, type WindowLike,
} from './splashPlatform'

const mem = new Map<string, string>()
const store: StorageLike = {
  getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}

beforeEach(() => { mem.clear() })

const win = (partial: Partial<WindowLike> & { ua?: string; standalone?: boolean; touch?: number; modes?: string[] }): WindowLike => {
  const modes = new Set(partial.modes ?? [])
  return {
    navigator: {
      userAgent: partial.ua ?? 'Mozilla/5.0',
      standalone: partial.standalone,
      maxTouchPoints: partial.touch ?? 0,
    },
    matchMedia: (q: string) => ({ matches: [...modes].some((m) => q.includes(m)) }),
    ...partial,
  }
}

describe('isStandalone', () => {
  it('reads navigator.standalone (iOS)', () => {
    expect(isStandalone(win({ standalone: true, ua: 'iPhone' }))).toBe(true)
    expect(isStandalone(win({ standalone: false, ua: 'iPhone' }))).toBe(false)
  })
  it('reads display-mode media queries', () => {
    expect(isStandalone(win({ modes: ['standalone'] }))).toBe(true)
    expect(isStandalone(win({ modes: ['fullscreen'] }))).toBe(true)
    expect(isStandalone(win({ modes: ['minimal-ui'] }))).toBe(true)
    expect(isStandalone(win({ modes: ['browser'] }))).toBe(false)
  })
})

describe('installPlatform + touch', () => {
  it('classifies iOS / Android / other', () => {
    expect(installPlatform(win({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }))).toBe('ios')
    expect(installPlatform(win({ ua: 'Mozilla/5.0 (iPad; CPU OS 16_0)' }))).toBe('ios')
    expect(installPlatform(win({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', touch: 5 }))).toBe('ios')
    expect(installPlatform(win({ ua: 'Mozilla/5.0 (Linux; Android 14)' }))).toBe('android')
    expect(installPlatform(win({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', touch: 0 }))).toBe('other')
  })
  it('detects touch via maxTouchPoints or coarse pointer', () => {
    expect(isTouchDevice(win({ touch: 5 }))).toBe(true)
    expect(isTouchDevice(win({ touch: 0, modes: ['pointer: coarse'] }))).toBe(true)
    expect(isTouchDevice(win({ touch: 0 }))).toBe(false)
  })
})

describe('shouldOfferHomeScreen', () => {
  it('offers on iPhone Safari (touch, not standalone)', () => {
    expect(shouldOfferHomeScreen(win({ ua: 'iPhone', touch: 5 }))).toBe(true)
  })
  it('offers on Android Chrome', () => {
    expect(shouldOfferHomeScreen(win({ ua: 'Linux; Android 14', touch: 5 }))).toBe(true)
  })
  it('hides when already standalone', () => {
    expect(shouldOfferHomeScreen(win({ ua: 'iPhone', touch: 5, standalone: true }))).toBe(false)
    expect(shouldOfferHomeScreen(win({ ua: 'iPhone', touch: 5, modes: ['standalone'] }))).toBe(false)
  })
  it('hides on desktop Safari (no touch)', () => {
    expect(shouldOfferHomeScreen(win({ ua: 'Macintosh', touch: 0 }))).toBe(false)
  })
})

describe('A2HS persistence', () => {
  it('is shown by default when eligible', () => {
    expect(loadHideA2hs(store)).toBe(false)
    expect(showHomeScreenCard(win({ ua: 'iPhone', touch: 5 }), store)).toBe(true)
  })
  it('round-trips Don\'t show again', () => {
    saveHideA2hs(true, store)
    expect(mem.get(A2HS_HIDE_KEY)).toBe('1')
    expect(loadHideA2hs(store)).toBe(true)
    expect(showHomeScreenCard(win({ ua: 'iPhone', touch: 5 }), store)).toBe(false)
    saveHideA2hs(false, store)
    expect(loadHideA2hs(store)).toBe(false)
  })
  it('survives a throwing storage', () => {
    const bad: StorageLike = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(loadHideA2hs(bad)).toBe(false)
    expect(() => saveHideA2hs(true, bad)).not.toThrow()
  })
})
