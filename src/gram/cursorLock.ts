/**
 * CURLOCK: tap-to-lock gram cursors (default scrub, HARM, DOP, LM).
 *
 * Design (Wilson):
 * - Drag moves a cursor freely while unlocked.
 * - A TAP (≤ LOCK_TAP_SLOP_PX movement and ≤ LOCK_TAP_MAX_MS) toggles lock.
 * - A lock tap does NOT jump the cursor to the tap point: the pre-gesture Hz is kept
 *   (and locked). Drags while locked are ignored for that cursor.
 * - Lock state is session-only (React state); never persisted.
 * - Pinch / pan / split / tab-bar collapse stay independent: workspace pointerdown still
 *   minimizes the tab bar on compact layouts, including during a lock tap (intentional —
 *   a gram tap is "working the gram").
 * - Double-tap full-band still wins: the second tap of a double-tap undoes the first tap's
 *   lock toggle (net unchanged) and zooms to the full band.
 * - Armed pick tools (BRG / vernier / DOP place / HARM probe) consume the tap; no lock toggle.
 * - Wired at the Gram gesture layer so Cuts inherits default-cursor lock with no extra props.
 * - HARM / DOP / LM locks live beside the tool state in the session; CUTTOOLS can reuse them.
 */
export const LOCK_TAP_SLOP_PX = 6
export const LOCK_TAP_MAX_MS = 250

export type CursorKind = 'default' | 'harm' | 'dop' | 'lm'

export type CursorLocks = Record<CursorKind, boolean>

export const EMPTY_LOCKS: CursorLocks = { default: false, harm: false, dop: false, lm: false }

/** True when the gesture is a lock tap: little movement and short duration. */
export function isLockTap(
  dx: number,
  dy: number,
  dtMs: number,
  slopPx = LOCK_TAP_SLOP_PX,
  maxMs = LOCK_TAP_MAX_MS,
): boolean {
  if (!(dtMs >= 0) || dtMs > maxMs) return false
  return Math.hypot(dx, dy) <= slopPx
}

/** Immutable toggle of one cursor kind. */
export function toggleLock(locks: CursorLocks, kind: CursorKind): CursorLocks {
  return { ...locks, [kind]: !locks[kind] }
}

/** Which tool cursor a lock-tap should affect, given the live arming state. */
export function lockKindForTool(tool: 'select' | 'dop' | 'lm' | 'harm', opts: {
  harmPlaced: boolean
  dopPlaced: boolean
}): CursorKind {
  if (tool === 'harm' && opts.harmPlaced) return 'harm'
  if (tool === 'lm') return 'lm'
  if (tool === 'dop' && opts.dopPlaced) return 'dop'
  return 'default'
}
