/** Long press for the Play button (and any other button that keeps its tap): a ~0.5 s pointer hold, a
 * held Space, Shift+Enter, or the context-menu key / right click fires `onLong`; a normal tap or click
 * still runs `onTap`. The click that ends a long press is swallowed so it doesn't also toggle play. */
export const LONG_PRESS_MS = 500

export interface LongPressTimers { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void }
const realTimers: LongPressTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }

export interface LongPress {
  pointerDown: () => void
  /** A non-primary button went down (right click): no hold, but a new gesture. */
  otherPointerDown: () => void
  /** Pointer left / was cancelled before the hold completed (scroll, drag off). */
  pointerCancel: () => void
  keyDown: (key: string, shift: boolean, repeat: boolean) => boolean
  keyUp: (key: string) => void
  contextMenu: () => void
  click: () => void
}

export function createLongPress(onLong: () => void, onTap: () => void, ms = LONG_PRESS_MS, timers: LongPressTimers = realTimers): LongPress {
  let timer: unknown = null
  let swallow = false
  /** A long press fired and no new gesture has started: a trailing contextmenu is the same press. */
  let held = false
  const stop = () => { if (timer !== null) { timers.clear(timer); timer = null } }
  const fire = () => { stop(); swallow = true; held = true; onLong() }
  const arm = () => { stop(); swallow = false; held = false; timer = timers.set(() => { timer = null; fire() }, ms) }
  return {
    pointerDown: arm,
    otherPointerDown: () => { stop(); held = false },
    pointerCancel: () => { stop() },
    keyDown: (key, shift, repeat) => {
      if (!repeat) held = false
      // Shift+Enter is prevented by the caller, so no click follows: don't swallow the next one.
      if (key === 'Enter' && shift) { stop(); swallow = false; onLong(); return true }
      if (key === 'Enter') { swallow = false; return false }
      if (key === ' ' && !repeat) { arm(); return false }
      return false
    },
    keyUp: (key) => { if (key === ' ') stop() },
    // Touch browsers also raise contextmenu on a long press; fire once and swallow the click after it.
    contextMenu: () => { if (held) return; fire() },
    click: () => {
      stop()
      if (swallow) { swallow = false; return }
      onTap()
    },
  }
}
