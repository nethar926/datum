import type { Bearing, TacticalBuoy } from '../engine/contract'

export interface Fix { x: number; y: number; freqHz: number; buoys: number; residualM: number }

/**
 * Display-side fix aid: group DIFAR lines by frequency across buoys and intersect their bearing lines
 * by least squares (minimise perpendicular distance). Not a tracker; a teaching aid for cross-fixes.
 */
export function crossFixes(bearings: readonly Bearing[], buoys: readonly TacticalBuoy[], tolHz = 1.5, minQuality = 6): Fix[] {
  const pos = new Map<number, TacticalBuoy>()
  for (const b of buoys) if (b.state === 'live') pos.set(b.id, b)
  const lines = bearings.filter((l) => l.quality >= minQuality && pos.has(l.buoyId)).sort((a, b) => a.freqHz - b.freqHz)
  const fixes: Fix[] = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    while (j < lines.length && lines[j].freqHz - lines[i].freqHz <= tolHz) j++
    // Keep the strongest line per buoy in the group.
    const best = new Map<number, Bearing>()
    for (let k = i; k < j; k++) { const l = lines[k], cur = best.get(l.buoyId); if (!cur || l.quality > cur.quality) best.set(l.buoyId, l) }
    if (best.size >= 2) { const f = intersect([...best.values()], pos); if (f) fixes.push(f) }
    i = j
  }
  return fixes
}

function intersect(group: Bearing[], pos: Map<number, TacticalBuoy>): Fix | null {
  // Line through p with unit direction d; normal n = (cos θ, -sin θ) for bearing θ (x east, y north).
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, f = 0
  for (const l of group) {
    const p = pos.get(l.buoyId)!, t = (l.brgDeg * Math.PI) / 180
    const nx = Math.cos(t), ny = -Math.sin(t), c = nx * p.x + ny * p.y
    a11 += nx * nx; a12 += nx * ny; a22 += ny * ny; b1 += nx * c; b2 += ny * c; f += l.freqHz
  }
  const det = a11 * a22 - a12 * a12
  if (Math.abs(det) < 0.05 * group.length) return null // near-parallel bearings: no useful fix
  const x = (a22 * b1 - a12 * b2) / det, y = (a11 * b2 - a12 * b1) / det
  let r = 0, ahead = 0
  for (const l of group) {
    const p = pos.get(l.buoyId)!, t = (l.brgDeg * Math.PI) / 180
    r += ((Math.cos(t) * (x - p.x) - Math.sin(t) * (y - p.y)) ** 2)
    if (Math.sin(t) * (x - p.x) + Math.cos(t) * (y - p.y) > 0) ahead++
  }
  if (ahead < group.length) return null // intersection behind a buoy: inconsistent
  return { x, y, freqHz: f / group.length, buoys: group.length, residualM: Math.sqrt(r / group.length) }
}
