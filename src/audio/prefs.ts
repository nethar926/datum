/**
 * Persisted listen settings. On/off is saved when the operator toggles, but every page load
 * starts muted (iOS gesture + Lead lock). Width and shift restore across loads.
 */
import { DEFAULT_FOCUS_HALF, FOCUS_HALF_WIDTHS, isFocusHalf, type FocusHalfWidth } from './focus'
import { isShiftMode, type ShiftMode } from './shift'

export const LISTEN_ON_KEY = 'datum.listen.on'
export const LISTEN_WIDTH_KEY = 'datum.listen.width'
export const LISTEN_SHIFT_KEY = 'datum.listen.shift'

export function loadListenOn(): boolean {
  // Always boot muted — persisted value is only written so a future session can show intent if needed.
  try { void localStorage.getItem(LISTEN_ON_KEY) } catch { /* private mode */ }
  return false
}

export function saveListenOn(on: boolean): void {
  try { localStorage.setItem(LISTEN_ON_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

export function loadFocusHalf(): FocusHalfWidth {
  try {
    const v = Number(localStorage.getItem(LISTEN_WIDTH_KEY))
    if (isFocusHalf(v)) return v
  } catch { /* private mode */ }
  return DEFAULT_FOCUS_HALF
}

export function saveFocusHalf(w: FocusHalfWidth): void {
  try { localStorage.setItem(LISTEN_WIDTH_KEY, String(w)) } catch { /* private mode */ }
}

export function loadShiftMode(): ShiftMode {
  try {
    const v = localStorage.getItem(LISTEN_SHIFT_KEY)
    if (isShiftMode(v)) return v
  } catch { /* private mode */ }
  return 'off'
}

export function saveShiftMode(m: ShiftMode): void {
  try { localStorage.setItem(LISTEN_SHIFT_KEY, m) } catch { /* private mode */ }
}

export { FOCUS_HALF_WIDTHS }
