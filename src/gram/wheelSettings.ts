import { DEFAULT_WHEEL, WHEEL_LOOKS, WHEEL_SECTORS, WHEEL_STEPS, type DifarWheelSettings } from '../gl/colormap'

export const WHEEL_KEY = 'datum.difarWheel'
const mask = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v & 0xffff : 0)
export const normRot = (d: number) => (Number.isFinite(d) ? ((Math.round(d) % 360) + 360) % 360 : 0)

/** Validate anything (stored JSON, URL) into a safe settings object. */
export function sanitizeWheel(v: unknown): DifarWheelSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const steps = WHEEL_STEPS.includes(o.steps as never) ? (o.steps as DifarWheelSettings['steps']) : DEFAULT_WHEEL.steps
  const look = WHEEL_LOOKS.includes(o.look as never) ? (o.look as DifarWheelSettings['look']) : DEFAULT_WHEEL.look
  const nulled = mask(o.nulled), isolated = mask(o.isolated) & ~nulled
  return { rotDeg: normRot(Number(o.rotDeg ?? 0)), steps, look, nulled, isolated }
}
export function loadWheel(): DifarWheelSettings {
  try { const v = localStorage.getItem(WHEEL_KEY); return v ? sanitizeWheel(JSON.parse(v)) : DEFAULT_WHEEL } catch { return DEFAULT_WHEEL }
}
export function saveWheel(w: DifarWheelSettings): void { try { localStorage.setItem(WHEEL_KEY, JSON.stringify(w)) } catch { /* private mode */ } }

/** Tap a sector: nulling and isolating are exclusive per sector; tapping again clears it. */
export function toggleSector(w: DifarWheelSettings, sector: number, tool: 'null' | 'isolate'): DifarWheelSettings {
  const bit = 1 << sector
  if (tool === 'null') { const on = !(w.nulled & bit); return { ...w, nulled: on ? w.nulled | bit : w.nulled & ~bit, isolated: w.isolated & ~bit } }
  const on = !(w.isolated & bit); return { ...w, isolated: on ? w.isolated | bit : w.isolated & ~bit, nulled: w.nulled & ~bit }
}
export const isDefaultWheel = (w: DifarWheelSettings) =>
  w.rotDeg === 0 && w.steps === 360 && w.look === 'full' && !w.nulled && !w.isolated

/** True when the applet should stroke the 16 sector wedges (stepped modes). Continuous 360° draws none. */
export const showsSectorDivisions = (steps: number): boolean => steps !== 360

/** How many sector paths get a division stroke (marked null/isolate sectors always stroke). */
export function sectorDivisionStrokeCount(steps: number, nulled = 0, isolated = 0): number {
  let n = 0
  for (let i = 0; i < WHEEL_SECTORS; i++) {
    const bit = 1 << i
    if ((nulled & bit) || (isolated & bit) || showsSectorDivisions(steps)) n++
  }
  return n
}
