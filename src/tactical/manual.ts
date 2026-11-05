import type { Bearing, TacticalBuoy } from '../engine/contract'

/** Operator-placed bearing cursors, one per DIFAR buoy: buoyId → true bearing in degrees. */
export type ManualBearings = Readonly<Record<number, number>>
export type FixSource = 'auto' | 'manual' | 'both'
/** Manual lines are treated as certain when fixing; with 'both', a buoy's manual line overrides its auto line. */
export const MANUAL_QUALITY = 99

/** True bearing (deg, 0 = north, clockwise) from a buoy to a world point; null if the point is on the buoy. */
export function bearingTo(buoy: { x: number; y: number }, wx: number, wy: number): number | null {
  const dx = wx - buoy.x, dy = wy - buoy.y
  if (dx * dx + dy * dy < 1) return null
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

/** Perpendicular distance (m) from a world point to a bearing ray of finite length; Infinity behind the buoy or past the end. */
export function distToRay(buoy: { x: number; y: number }, brgDeg: number, lenM: number, wx: number, wy: number): number {
  const t = (brgDeg * Math.PI) / 180, ux = Math.sin(t), uy = Math.cos(t)
  const dx = wx - buoy.x, dy = wy - buoy.y, along = dx * ux + dy * uy
  if (along < 0 || along > lenM) return Infinity
  return Math.abs(dx * uy - dy * ux)
}

/**
 * Lines fed to the cross-fix solver. Manual lines get the frequency of the active auto group (or the picked
 * frequency) so they fix together with it; with no frequency known they form their own group.
 */
export function fixInputs(auto: readonly Bearing[], manual: ManualBearings, buoys: readonly TacticalBuoy[], source: FixSource, selHz: number | null): Bearing[] {
  const out: Bearing[] = source === 'manual' ? [] : [...auto]
  if (source === 'auto') return out
  const hz = selHz ?? auto[0]?.freqHz ?? -1
  for (const b of buoys) {
    const deg = manual[b.id]
    if (deg === undefined || b.kind !== 'difar' || b.state !== 'live') continue
    out.push({ buoyId: b.id, freqHz: hz, brgDeg: deg, quality: MANUAL_QUALITY })
  }
  return out
}
