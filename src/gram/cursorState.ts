/**
 * Cursor hold model (Wilson):
 * - free: follows the finger exactly
 * - anchored: tap holds position; another tap releases to free (no lock icon)
 * - locked: three-finger swipe-down while anchored, or the visible lock button; lock icon shown
 *
 * Tap classification still uses isLockTap from cursorLock.ts (slop + duration).
 */
import { isLockTap } from './cursorLock'

export type CursorHold = 'free' | 'anchored' | 'locked'

export const nextHoldOnTap = (hold: CursorHold): CursorHold => {
  if (hold === 'free') return 'anchored'
  if (hold === 'anchored') return 'free'
  // Locked: tap does not unlock — only the lock button (or an explicit unlock) does.
  return 'locked'
}

/** Three-finger swipe-down while anchored → locked; otherwise unchanged. */
export const holdAfterThreeFingerSwipe = (hold: CursorHold, swipedDown: boolean): CursorHold =>
  swipedDown && hold === 'anchored' ? 'locked' : hold

/** Visible lock button: toggles locked ↔ anchored (if there is a Hz) or locked ↔ free. */
export function toggleLockButton(hold: CursorHold, hasHz: boolean): CursorHold {
  if (hold === 'locked') return hasHz ? 'anchored' : 'free'
  return 'locked'
}

export const isCursorFrozen = (hold: CursorHold): boolean => hold === 'anchored' || hold === 'locked'
export const showLockIcon = (hold: CursorHold): boolean => hold === 'locked'

/** Classify a one-finger up as a hold-cycle tap (same thresholds as CURLOCK taps). */
export const isHoldTap = (dx: number, dy: number, dtMs: number): boolean => isLockTap(dx, dy, dtMs)
