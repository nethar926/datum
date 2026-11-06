/**
 * Gram time ↔ screen-Y mapping.
 *
 * Default (newestAtBottom = true): live data enters at the BOTTOM; older history scrolls UP.
 * Flipped (newestAtBottom = false): legacy operator look — newest at the TOP.
 *
 * Every time↔y conversion in the FE (shader age, taps, Doppler, Lloyd's, crosshair, Zulu labels)
 * must go through these helpers so a single setting flips the gram.
 */
export const GRAM_DIR_KEY = 'datum.gramDir'

/** `bottom` = newest at bottom (default); `top` = newest at top. */
export type GramDir = 'bottom' | 'top'

export const DEFAULT_GRAM_DIR: GramDir = 'bottom'

export function parseGramDir(v: unknown): GramDir {
  return v === 'top' ? 'top' : 'bottom'
}

export function loadGramDir(): GramDir {
  try { return parseGramDir(localStorage.getItem(GRAM_DIR_KEY)) } catch { return DEFAULT_GRAM_DIR }
}

export function saveGramDir(d: GramDir): void {
  try { localStorage.setItem(GRAM_DIR_KEY, d) } catch { /* private mode */ }
}

export const newestAtBottom = (d: GramDir): boolean => d !== 'top'

/**
 * Age in seconds (0 = newest / "now") from a canvas Y in CSS px.
 * y=0 is the top of the waterfall canvas.
 */
export function agoFromY(y: number, height: number, historyS: number, dir: GramDir): number {
  const h = Math.max(1, height)
  const t = Math.max(0, Math.min(1, y / h))
  return (newestAtBottom(dir) ? 1 - t : t) * historyS
}

/** Canvas Y (px from top) for an age in seconds (0 = newest). */
export function yFromAgo(agoS: number, height: number, historyS: number, dir: GramDir): number {
  const h = Math.max(1, height)
  const hist = Math.max(1e-9, historyS)
  const t = Math.max(0, Math.min(1, agoS / hist))
  return (newestAtBottom(dir) ? 1 - t : t) * h
}

/** Canvas Y for an absolute sim time given "now" and the visible history window. */
export function yFromTime(tS: number, nowS: number, height: number, historyS: number, dir: GramDir): number {
  return yFromAgo(nowS - tS, height, historyS, dir)
}

/** Absolute sim time from a canvas Y. */
export function timeFromY(y: number, nowS: number, height: number, historyS: number, dir: GramDir): number {
  return nowS - agoFromY(y, height, historyS, dir)
}

/** CSS `top` percentage (0–100) for an age — used by DOM overlays (crosshair, Lloyd's polylines). */
export function pctFromAgo(agoS: number, historyS: number, dir: GramDir): number {
  const hist = Math.max(1e-9, historyS)
  const t = Math.max(0, Math.min(1, agoS / hist))
  return (newestAtBottom(dir) ? 1 - t : t) * 100
}

/**
 * Arrow-key / screen Δy (px, + = down the screen) → Δt seconds (+ = later).
 * Newest at top: moving down the screen goes to older time (−Δt).
 * Newest at bottom: moving down the screen goes to newer time (+Δt).
 */
export function dtFromScreenDy(dyPx: number, height: number, historyS: number, dir: GramDir): number {
  const h = Math.max(1, height)
  const dt = (dyPx / h) * historyS
  return newestAtBottom(dir) ? dt : -dt
}

/**
 * WebGL fragment age from vUv.y (0 at top, 1 at bottom) and row count.
 * Returns the age index the shader should use (0 = newest row).
 */
export function shaderAgeExpr(dir: GramDir): string {
  // Kept as a GLSL snippet so the FS stays in sync with the TS helpers.
  return newestAtBottom(dir)
    ? `int(floor((1.0 - vUv.y) * float(uRows)))`
    : `int(floor(vUv.y * float(uRows)))`
}

/** Uniform: 1 = newest at bottom, 0 = newest at top. */
export const flipUniform = (dir: GramDir): number => (newestAtBottom(dir) ? 1 : 0)

/** Zulu clock: scenario wall-clock origin + sim seconds → `HHmmZ`. */
export function formatZulu(simS: number, originMs: number): string {
  // simS may be negative for ticks older than scenario start (empty history at the far end).
  const d = new Date(originMs + simS * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}${mm}Z`
}

/** Zulu clock to the second (`HHmmssZ`) for the HORZ hover row label. */
export function formatZuluSec(simS: number, originMs: number): string {
  const d = new Date(originMs + simS * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`
}

/**
 * Tick ages (seconds before now) for the Y axis. Short canvases get fewer labels so `0213Z` doesn't collide.
 */
export function timeTickAges(historyS: number, canvasH: number): number[] {
  const n = canvasH < 120 ? 3 : canvasH < 200 ? 4 : 6
  if (historyS <= 0 || n < 2) return [0]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((historyS * i) / (n - 1))
  return out
}
