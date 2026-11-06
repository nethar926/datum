/**
 * Launch-splash helpers: standalone / installable detection and Add-to-Home-Screen persistence.
 * Pure enough to unit-test without a real browser (injectable window).
 */

export const A2HS_HIDE_KEY = 'datum.a2hs.hide'

/** True when the page is running as an installed web app (iOS standalone or display-mode: standalone / fullscreen / minimal-ui). */
export function isStandalone(win: WindowLike = globalWindow()): boolean {
  try {
    const nav = win.navigator as NavigatorLike
    if (nav && nav.standalone === true) return true
  } catch { /* private / odd host */ }
  try {
    const mm = win.matchMedia
    if (typeof mm === 'function') {
      if (mm.call(win, '(display-mode: standalone)').matches) return true
      if (mm.call(win, '(display-mode: fullscreen)').matches) return true
      if (mm.call(win, '(display-mode: minimal-ui)').matches) return true
    }
  } catch { /* no matchMedia */ }
  return false
}

/** Coarse platform for A2HS copy: iOS/iPadOS, Android, or other. */
export type InstallPlatform = 'ios' | 'android' | 'other'

export function installPlatform(win: WindowLike = globalWindow()): InstallPlatform {
  const ua = (() => { try { return String(win.navigator?.userAgent ?? '') } catch { return '' } })()
  // iPadOS 13+ desktop UA still carries Macintosh + touch.
  const iPadOsDesktop = /Macintosh/.test(ua) && maxTouch(win) > 1
  if (/iPhone|iPad|iPod/.test(ua) || iPadOsDesktop) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

/** Touch / coarse pointer — phones and tablets, not mouse desktops. */
export function isTouchDevice(win: WindowLike = globalWindow()): boolean {
  try {
    if (maxTouch(win) > 0) return true
  } catch { /* */ }
  try {
    const mm = win.matchMedia
    if (typeof mm === 'function' && mm.call(win, '(pointer: coarse)').matches) return true
  } catch { /* */ }
  return false
}

/**
 * Offer the Add to Home Screen card only on iOS/iPadOS/Android touch devices that are NOT already standalone.
 * Desktops and already-installed PWAs never see it.
 */
export function shouldOfferHomeScreen(win: WindowLike = globalWindow()): boolean {
  if (isStandalone(win)) return false
  if (!isTouchDevice(win)) return false
  const plat = installPlatform(win)
  return plat === 'ios' || plat === 'android'
}

export function loadHideA2hs(store: StorageLike | null = safeStorage()): boolean {
  try { return store?.getItem(A2HS_HIDE_KEY) === '1' } catch { return false }
}

export function saveHideA2hs(hide: boolean, store: StorageLike | null = safeStorage()): void {
  try {
    if (!store) return
    if (hide) store.setItem(A2HS_HIDE_KEY, '1')
    else store.removeItem(A2HS_HIDE_KEY)
  } catch { /* private mode */ }
}

/** Whether the A2HS card should render right now (platform eligible AND not dismissed permanently). */
export function showHomeScreenCard(win: WindowLike = globalWindow(), store: StorageLike | null = safeStorage()): boolean {
  return shouldOfferHomeScreen(win) && !loadHideA2hs(store)
}

// ---------- injectable types (unit tests) ----------
export type WindowLike = {
  navigator?: NavigatorLike
  matchMedia?: (q: string) => { matches: boolean }
}
export type NavigatorLike = { userAgent?: string; standalone?: boolean; maxTouchPoints?: number }
export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function globalWindow(): WindowLike {
  return typeof window !== 'undefined' ? window : {}
}

function maxTouch(win: WindowLike): number {
  try { return Number(win.navigator?.maxTouchPoints ?? 0) || 0 } catch { return 0 }
}

function safeStorage(): StorageLike | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}
