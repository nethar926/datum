import { formatZuluHms, isReviewing } from '../touch/scrollBack'
import { formatZuluSec } from './timeAxis'

/** HORZ line reads time. Live: `HHmmssZ`. Scroll-back: `HH:MM:SSz`. */
export function horzZulu(simS: number, originMs: number, scrollBackS: number): string {
  return isReviewing(scrollBackS) ? formatZuluHms(simS, originMs) : formatZuluSec(simS, originMs)
}

/** Hz shown in the live readout: finger x while a pointer is down, otherwise the vertical hairline. */
export function readoutHz(fingerHz: number | null | undefined, cursorHz: number | null | undefined): number | null {
  if (fingerHz !== null && fingerHz !== undefined) return fingerHz
  return cursorHz ?? null
}

export function formatHorzHz(hz: number, fBin: number, f0: number, unit = 'Hz'): string {
  const bin = Math.round((hz - f0) / fBin)
  return `${hz.toFixed(fBin < 0.1 ? 2 : 1)} ${unit} · bin ${bin}`
}

export function formatHorzDb(db: number | null | undefined): string {
  return typeof db === 'number' && Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-- dB'
}

/**
 * Live readout: HORZ time (the line reads time) alongside Hz at the finger's x,
 * plus dB when the long-press crosshair is active.
 */
export function liveReadout(opts: {
  hz: number | null
  fBin: number
  f0?: number
  unit?: string
  horzZulu?: string | null
  crosshair?: boolean
  db?: number | null
  suffix?: string
}): string | null {
  const parts: string[] = []
  if (opts.horzZulu) parts.push(opts.horzZulu)
  if (opts.hz !== null) parts.push(formatHorzHz(opts.hz, opts.fBin, opts.f0 ?? 0, opts.unit ?? 'Hz') + (opts.suffix ?? ''))
  if (opts.crosshair) parts.push(formatHorzDb(opts.db))
  return parts.length ? parts.join('  ') : null
}

/** One pointer sample against HORZ / locked-hairline rules (mouse hover, mouse drag, or touch drag). */
export function horzAtPointer(opts: {
  x: number; y: number; w: number; h: number
  hzAtX: number
  agoS: number
  horz: boolean
  locked: boolean
  cursorHz: number | null
}): { fingerHz: number; hoverAgo: number | null; cursorHz: number | null } {
  return {
    fingerHz: opts.hzAtX,
    hoverAgo: opts.horz ? opts.agoS : null,
    cursorHz: opts.locked ? opts.cursorHz : opts.hzAtX,
  }
}
