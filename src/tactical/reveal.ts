/**
 * Reveal positions: instructor marks on the tactical plot (shapes + short tags).
 * Pure helpers — no React, no engine imports beyond contact-shaped inputs.
 */

export type RevealShape = 'triangle' | 'circle' | 'square'

/**
 * Shape-by-kind map. `warship` is reserved for a future surface kind (square mark);
 * do not invent warship contacts today — only subsurface/surface categories exist on the wire.
 */
export const REVEAL_SHAPE_BY_KIND = {
  subsurface: 'triangle',
  surface: 'circle',
  warship: 'square',
} as const satisfies Record<string, RevealShape>

export type RevealKind = keyof typeof REVEAL_SHAPE_BY_KIND

/** Map engine `category` to a draw shape; null for unknown/unmapped (skip the mark). */
export function revealShapeForCategory(category: string | undefined | null): RevealShape | null {
  if (category === 'subsurface') return REVEAL_SHAPE_BY_KIND.subsurface
  if (category === 'surface') return REVEAL_SHAPE_BY_KIND.surface
  return null
}

/** Short tag prefix: S = subsurface, M = surface commercial (merchant). */
export function revealTagPrefix(category: 'subsurface' | 'surface'): 'S' | 'M' {
  return category === 'subsurface' ? 'S' : 'M'
}

/** Build S1/M2… tags for active contacts in list order (separate counters per prefix). */
export function assignRevealTags(
  contacts: readonly { active?: boolean; category?: string | null }[],
): (string | null)[] {
  let s = 0, m = 0
  const out: (string | null)[] = new Array(contacts.length)
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]
    if (c.active === false) { out[i] = null; continue }
    if (c.category === 'subsurface') out[i] = `S${++s}`
    else if (c.category === 'surface') out[i] = `M${++m}`
    else out[i] = null
  }
  return out
}

export interface RevealRect { x: number; y: number; w: number; h: number }

/** Candidate tag offsets (dx, dy) from the mark centre to the tag's top-left, in canvas px. */
export const REVEAL_TAG_OFFSETS: readonly (readonly [number, number])[] = [
  [10, -4],    // right
  [-10, -4],   // left (caller subtracts tag width)
  [10, -16],   // above-right
  [-10, -16],  // above-left
  [10, 10],    // below-right
  [-10, 10],   // below-left
  [0, -18],    // above
  [0, -30],    // further above (clears bottom chrome)
  [0, -42],
  [14, -30],
  [-14, -30],
  [0, 12],     // below
  [0, 24],
]

/**
 * Greedy tag placement: try REVEAL_TAG_OFFSETS in order, skip any that overlap obstacles
 * (other tags, buoy labels, chrome insets) or leave the canvas. Writes top-left into outX/outY.
 * Zero heap traffic when callers reuse the typed arrays.
 */
export function placeRevealTagsInPlace(
  n: number,
  ax: Float64Array, ay: Float64Array,
  tw: Float64Array, th: Float64Array,
  outX: Float64Array, outY: Float64Array,
  obstacles: Float64Array, // [x,y,w,h] * mObs
  mObs: number,
  canvasW: number, canvasH: number,
  margin = 4,
): void {
  let placed = mObs
  // Grow a local obstacle list in the same flat buffer: caller must leave room after mObs.
  for (let i = 0; i < n; i++) {
    const ww = tw[i], hh = th[i]
    let placedOk = false
    for (let k = 0; k < REVEAL_TAG_OFFSETS.length; k++) {
      const odx = REVEAL_TAG_OFFSETS[k][0], ody = REVEAL_TAG_OFFSETS[k][1]
      let x = ax[i] + odx
      let y = ay[i] + ody
      if (odx < 0) x -= ww
      if (ody < -4 && odx === 0) x -= ww / 2
      if (ody > 4 && odx === 0) x -= ww / 2
      x = Math.max(margin, Math.min(canvasW - ww - margin, x))
      y = Math.max(margin, Math.min(canvasH - hh - margin, y))
      let hit = false
      for (let o = 0; o < placed; o++) {
        const ox = obstacles[o * 4], oy = obstacles[o * 4 + 1], ow = obstacles[o * 4 + 2], oh = obstacles[o * 4 + 3]
        if (!(x + ww + 2 <= ox || ox + ow + 2 <= x || y + hh + 2 <= oy || oy + oh + 2 <= y)) { hit = true; break }
      }
      if (hit) continue
      outX[i] = x; outY[i] = y
      obstacles[placed * 4] = x; obstacles[placed * 4 + 1] = y
      obstacles[placed * 4 + 2] = ww; obstacles[placed * 4 + 3] = hh
      placed++
      placedOk = true
      break
    }
    if (!placedOk) {
      // Fall back: walk upward from the mark until the tag clears every obstacle.
      let x = Math.max(margin, Math.min(canvasW - ww - margin, ax[i] + 10))
      let y = Math.max(margin, Math.min(canvasH - hh - margin, ay[i] - hh - 4))
      for (let step = 0; step < 48; step++) {
        let hit = false
        for (let o = 0; o < placed; o++) {
          const ox = obstacles[o * 4], oy = obstacles[o * 4 + 1], ow = obstacles[o * 4 + 2], oh = obstacles[o * 4 + 3]
          if (!(x + ww + 2 <= ox || ox + ow + 2 <= x || y + hh + 2 <= oy || oy + oh + 2 <= y)) { hit = true; break }
        }
        if (!hit) break
        y = Math.max(margin, y - 4)
      }
      outX[i] = x; outY[i] = y
      obstacles[placed * 4] = x; obstacles[placed * 4 + 1] = y
      obstacles[placed * 4 + 2] = ww; obstacles[placed * 4 + 3] = hh
      placed++
    }
  }
}

/** Allocating wrapper for tests: returns top-left of each tag. */
export function placeRevealTags(
  marks: readonly { ax: number; ay: number; w: number; h: number }[],
  obstacles: readonly RevealRect[],
  canvasW: number,
  canvasH: number,
): { x: number; y: number }[] {
  const n = marks.length
  const ax = new Float64Array(n), ay = new Float64Array(n), tw = new Float64Array(n), th = new Float64Array(n)
  const outX = new Float64Array(n), outY = new Float64Array(n)
  const room = obstacles.length + n + 4
  const obs = new Float64Array(room * 4)
  for (let i = 0; i < obstacles.length; i++) {
    obs[i * 4] = obstacles[i].x; obs[i * 4 + 1] = obstacles[i].y
    obs[i * 4 + 2] = obstacles[i].w; obs[i * 4 + 3] = obstacles[i].h
  }
  for (let i = 0; i < n; i++) { ax[i] = marks[i].ax; ay[i] = marks[i].ay; tw[i] = marks[i].w; th[i] = marks[i].h }
  placeRevealTagsInPlace(n, ax, ay, tw, th, outX, outY, obs, obstacles.length, canvasW, canvasH)
  return Array.from({ length: n }, (_, i) => ({ x: outX[i], y: outY[i] }))
}

/** True bearing (deg) and range (m) from a buoy to a contact; null if coincident. */
export function revealRangeBrg(
  buoy: { x: number; y: number } | null | undefined,
  contact: { x: number; y: number },
): { rngM: number; brgDeg: number } | null {
  if (!buoy) return null
  const dx = contact.x - buoy.x, dy = contact.y - buoy.y
  const rngM = Math.hypot(dx, dy)
  if (rngM < 1) return null
  const brgDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  return { rngM, brgDeg }
}
