/**
 * Visual style for an operator-laid (passive) fix. Default mark is a yellow
 * multiply (X). Auto fixes are not shown — `SHOW_AUTO_FIXES` is the UI-layer
 * gate; `crossFixes` maths stay available for drop planning and tests.
 */
export const FIX_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue'] as const
export type FixColor = (typeof FIX_COLORS)[number]
export const DEFAULT_FIX_COLOR: FixColor = 'yellow'

export const FIX_SHAPES = ['multiply', 'plus', 'staroflife.fill', 'star.fill', 'burst.fill', 'sub'] as const
export type FixShape = (typeof FIX_SHAPES)[number]
export const DEFAULT_FIX_SHAPE: FixShape = 'multiply'

/** Auto (DIFAR-computed) bearing lines: violet. */
export const AUTO_BEARING = 'rgba(157, 107, 255, 0.85)'
/** Cyan used for a laid fix's snapshot bearing lines (same as --plot-manual). */
export const FIX_LINE = '#8af0ff'
export const DEFAULT_FIX_FADE_S = 120
export const FIX_FADE_KEY = 'datum.fix.fadeS'
export const SHOW_AUTO_FIXES = false
export const FIX_HIT_PX = 22
export const FIX_MENU_W = 228
export const FIX_MENU_H = 196

export const FIX_COLOR_RGB: Record<FixColor, string> = {
  green: '#30d158',
  yellow: '#ffd60a',
  orange: '#ff9f0a',
  red: '#ff453a',
  purple: '#bf5af2',
  blue: '#0a84ff',
}

export type FixLayoutRect = { x: number; y: number; width: number; height: number }

function usable(r: FixLayoutRect): boolean {
  return Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0
}
function intersect(a: FixLayoutRect, b: FixLayoutRect): FixLayoutRect {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height)
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) }
}

export function clampFixFadeS(s: number): number {
  return Math.min(600, Math.max(10, s))
}

const fadeMemory = new Map<string, string>()
function fadeStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch { /* private mode */ }
  return {
    getItem: (k) => fadeMemory.get(k) ?? null,
    setItem: (k, v) => { fadeMemory.set(k, v) },
    removeItem: (k) => { fadeMemory.delete(k) },
  }
}

export function loadFixFadeS(): number {
  const v = fadeStore().getItem(FIX_FADE_KEY)
  if (v == null) return DEFAULT_FIX_FADE_S
  const n = Number(v)
  return Number.isFinite(n) ? clampFixFadeS(n) : DEFAULT_FIX_FADE_S
}

export function saveFixFadeS(s: number): void {
  fadeStore().setItem(FIX_FADE_KEY, String(clampFixFadeS(s)))
}

export function resetFixFadeForTests(): void {
  fadeStore().removeItem(FIX_FADE_KEY)
}

/** Alpha of a laid-fix bearing line of this sim-time age. 1 at lay, 0 at `fadeS`. */
export function fixLineAlpha(ageS: number, fadeS = DEFAULT_FIX_FADE_S): number {
  const w = Math.max(1e-9, fadeS)
  return Math.min(1, Math.max(0, 1 - ageS / w))
}

/** UI-layer gate: never returns auto-generated fixes while SHOW_AUTO_FIXES is off. */
export function displayedAutoFixes<T>(computed: T[]): T[] {
  return SHOW_AUTO_FIXES ? computed : []
}

export function hitFix(
  marks: { id: number; sx: number; sy: number }[],
  x: number, y: number, radius = FIX_HIT_PX,
): number | null {
  let best: { id: number; d: number } | null = null
  for (const m of marks) {
    const d = Math.hypot(m.sx - x, m.sy - y)
    if (d <= radius && (!best || d < best.d)) best = { id: m.id, d }
  }
  return best ? best.id : null
}

export function fixAvoidsCrease(frame: FixLayoutRect, crease?: FixLayoutRect | null): boolean {
  if (!crease || !usable(crease)) return true
  return !usable(intersect(frame, crease))
}

function shiftOffCrease(frame: FixLayoutRect, crease: FixLayoutRect, inner: FixLayoutRect): FixLayoutRect {
  const hit = intersect(frame, crease)
  if (!usable(hit)) return frame
  if (hit.width <= hit.height) {
    const leftW = Math.max(0, crease.x - inner.x)
    const rightW = Math.max(0, inner.x + inner.width - (crease.x + crease.width))
    if (rightW >= frame.width) return { x: crease.x + crease.width, y: frame.y, width: frame.width, height: frame.height }
    if (leftW >= frame.width) return { x: crease.x - frame.width, y: frame.y, width: frame.width, height: frame.height }
    return rightW >= leftW
      ? { x: crease.x + crease.width, y: frame.y, width: rightW, height: frame.height }
      : { x: inner.x, y: frame.y, width: leftW, height: frame.height }
  }
  const topH = Math.max(0, crease.y - inner.y)
  const botH = Math.max(0, inner.y + inner.height - (crease.y + crease.height))
  if (botH >= frame.height) return { x: frame.x, y: crease.y + crease.height, width: frame.width, height: frame.height }
  if (topH >= frame.height) return { x: frame.x, y: crease.y - frame.height, width: frame.width, height: frame.height }
  return botH >= topH
    ? { x: frame.x, y: crease.y + crease.height, width: frame.width, height: botH }
    : { x: frame.x, y: inner.y, width: frame.width, height: topH }
}

/** Place the edit menu near a fix, inside the plot, never over the Duo hinge crease. */
export function fixMenuFrame(
  fixSX: number, fixSY: number, plot: FixLayoutRect,
  crease?: FixLayoutRect | null,
  width = FIX_MENU_W, height = FIX_MENU_H,
): FixLayoutRect | null {
  const pad = 8
  const inner: FixLayoutRect = { x: plot.x + pad, y: plot.y + pad, width: Math.max(0, plot.width - 2 * pad), height: Math.max(0, plot.height - 2 * pad) }
  if (!usable(inner)) return null
  let x = fixSX + 12
  let y = fixSY + 12
  if (x + width > inner.x + inner.width) x = fixSX - width - 12
  if (y + height > inner.y + inner.height) y = fixSY - height - 12
  x = Math.min(Math.max(inner.x, x), Math.max(inner.x, inner.x + inner.width - width))
  y = Math.min(Math.max(inner.y, y), Math.max(inner.y, inner.y + inner.height - height))
  let frame: FixLayoutRect = { x, y, width: Math.min(width, inner.width), height: Math.min(height, inner.height) }
  if (crease && usable(crease)) frame = shiftOffCrease(frame, crease, inner)
  frame = intersect(frame, inner)
  return usable(frame) ? frame : null
}

export function drawFixShape(
  ctx: CanvasRenderingContext2D,
  shape: FixShape,
  x: number, y: number, r: number,
  color: string,
  lineWidth: number,
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (shape === 'multiply') {
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke()
  } else if (shape === 'plus') {
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke()
  } else if (shape === 'sub') {
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); ctx.fill()
  } else {
    const points = shape === 'star.fill' ? 5 : shape === 'staroflife.fill' ? 6 : 8
    const inner = shape === 'burst.fill' ? 0.35 : 0.45
    ctx.beginPath()
    for (let i = 0; i < points * 2; i++) {
      const a = i * Math.PI / points - Math.PI / 2
      const rad = r * (i % 2 === 0 ? 1 : inner)
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py)
    }
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()
}
