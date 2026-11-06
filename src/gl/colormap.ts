type Stop = [t: number, r: number, g: number, b: number]

/**
 * LOFAR palettes: single-hue operator phosphors, black to near-white. Amplitude only, no hue coding
 * (DIFAR ignores these and uses the bearing wheel).
 */
export const PALETTES = {
  green: [[0, 0, 0, 0], [0.25, 0, 40, 8], [0.55, 20, 150, 45], [0.8, 92, 255, 122], [1, 225, 255, 230]],
  amber: [[0, 0, 0, 0], [0.25, 45, 18, 0], [0.55, 170, 90, 5], [0.8, 255, 176, 40], [1, 255, 238, 200]],
  red: [[0, 0, 0, 0], [0.25, 48, 0, 2], [0.55, 165, 12, 12], [0.8, 255, 72, 56], [1, 255, 222, 210]],
} satisfies Record<string, Stop[]>
export type PaletteId = keyof typeof PALETTES
export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[]
export const isPaletteId = (v: unknown): v is PaletteId => typeof v === 'string' && v in PALETTES

/** 256-entry RGBA lookup table for a palette (piecewise-linear between stops). */
export function paletteLut(id: PaletteId = 'green', size = 256): Uint8Array {
  const stops: Stop[] = PALETTES[id] ?? PALETTES.green
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [t0, r0, g0, b0] = stops[k], [t1, r1, g1, b1] = stops[k + 1]
    const a = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
    out[i * 4] = Math.round(r0 + (r1 - r0) * a)
    out[i * 4 + 1] = Math.round(g0 + (g1 - g0) * a)
    out[i * 4 + 2] = Math.round(b0 + (b1 - b0) * a)
    out[i * 4 + 3] = 255
  }
  return out
}

/** Classic phosphor-green palette (kept for existing callers). */
export const phosphorLut = (size = 256) => paletteLut('green', size)

/** dB → 0..1 display intensity, NaN preserved (drawn as gap colour). */
export function normalizeDb(db: number, floor: number, ceil: number): number {
  if (Number.isNaN(db)) return NaN
  const span = Math.max(1e-6, ceil - floor)
  return Math.min(1, Math.max(0, (db - floor) / span))
}

/**
 * DIFAR bearing → hue on a full, continuous 360° HSV wheel (S = V = 1; brightness comes from intensity in the shader).
 * Cardinals land on Wilson's colours: 000 N red, 090 E yellow, 180 S blue, 270 W violet. Between them the hue sweeps
 * every value in order (N→E orange, E→S green and cyan, S→W indigo, W→N magenta), piecewise-linear in hue.
 */
export const DIFAR_HUE_ANCHORS: readonly (readonly [bearingDeg: number, hueDeg: number])[] = [
  [0, 0], [90, 60], [180, 240], [270, 280], [360, 360],
]
/** Bearing (deg, any value) → hue (deg 0..360). */
export function difarHue(deg: number): number {
  const d = ((deg % 360) + 360) % 360
  let k = 0
  while (k < DIFAR_HUE_ANCHORS.length - 2 && d >= DIFAR_HUE_ANCHORS[k + 1][0]) k++
  const [b0, h0] = DIFAR_HUE_ANCHORS[k], [b1, h1] = DIFAR_HUE_ANCHORS[k + 1]
  return (h0 + ((d - b0) / (b1 - b0)) * (h1 - h0)) % 360
}
/** Fully saturated HSV (V = 1) to RGB 0..255. */
export function hueRgb(h: number): [number, number, number] {
  const x = (((h % 360) + 360) % 360) / 60, i = Math.floor(x) % 6, f = x - Math.floor(x)
  const up = Math.round(255 * f), dn = Math.round(255 * (1 - f))
  switch (i) {
    case 0: return [255, up, 0]
    case 1: return [dn, 255, 0]
    case 2: return [0, 255, up]
    case 3: return [0, dn, 255]
    case 4: return [up, 0, 255]
    default: return [255, 0, dn]
  }
}
/** Bearing (deg, any value) to RGB 0..255 on the continuous wheel. */
export const difarRgb = (deg: number): [number, number, number] => hueRgb(difarHue(deg))
/**
 * Operator wheel settings (DIFAR applet). Sectors are 16 × 22.5° on TRUE bearing, centred on N (sector 0 = 348.75–11.25°),
 * stored as 16-bit masks. Rotation only moves the colours; null/isolate/steps always refer to true bearing.
 */
export type WheelSteps = 360 | 16 | 8 | 4
export type WheelLook = 'full' | 'pastel' | 'bw' | 'green'
export interface DifarWheelSettings { rotDeg: number; steps: WheelSteps; look: WheelLook; nulled: number; isolated: number }
export const WHEEL_SECTORS = 16
export const DEFAULT_WHEEL: DifarWheelSettings = { rotDeg: 0, steps: 360, look: 'full', nulled: 0, isolated: 0 }
export const WHEEL_STEPS: WheelSteps[] = [360, 16, 8, 4]
export const WHEEL_LOOKS: WheelLook[] = ['full', 'pastel', 'bw', 'green']
/** Grey for nulled sectors (same as "no bearing"); dark grey for sectors muted by an isolate. */
export const WHEEL_NULL_RGB: [number, number, number] = [153, 153, 153]
export const WHEEL_MUTED_RGB: [number, number, number] = [56, 56, 56]

const norm = (d: number) => ((d % 360) + 360) % 360
export const sectorOf = (deg: number): number => Math.floor(norm(deg + 11.25) / 22.5) % WHEEL_SECTORS
/** Snap a bearing to the centre of its step bin (bins centred on N). 360 = continuous. */
export const quantizeBearing = (deg: number, steps: WheelSteps): number =>
  steps >= 360 ? norm(deg) : norm(Math.round(norm(deg) / (360 / steps)) * (360 / steps))

const luma = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
/** Bearing → RGB under the operator's wheel settings. */
export function wheelRgb(deg: number, w: DifarWheelSettings = DEFAULT_WHEEL): [number, number, number] {
  const sec = sectorOf(deg), bit = 1 << sec
  if (w.nulled & bit) return WHEEL_NULL_RGB
  if (w.isolated && !(w.isolated & bit)) return WHEEL_MUTED_RGB
  const c = difarRgb(quantizeBearing(deg, w.steps) - w.rotDeg)
  switch (w.look) {
    case 'pastel': return c.map((v) => Math.round(v * 0.55 + 255 * 0.45)) as [number, number, number]
    case 'bw': { const y = Math.round(64 + (luma(c) / 255) * 191); return [y, y, y] }
    case 'green': { const y = luma(c) / 255; return [Math.round(30 * y), Math.round(70 + 185 * y), Math.round(40 + 60 * y)] }
    default: return c
  }
}
/** 360-entry RGBA wheel (one texel per degree) for the GPU; sampled with linear filtering and REPEAT wrap. */
export function difarWheelLut(size = 360, w: DifarWheelSettings = DEFAULT_WHEEL): Uint8Array {
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) { const [r, g, b] = wheelRgb((i * 360) / size, w); out.set([r, g, b, 255], i * 4) }
  return out
}
