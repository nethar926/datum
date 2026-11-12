/**
 * Bloom + phosphor noise on plot, chrome and overlays — never on the grams.
 * Off is the default and attaches no pass (zero added cost). One cheap CSS /
 * canvas filter pass when on; no per-frame allocations.
 */
export const DISPLAY_BLOOM_LEVELS = ['off', 'low', 'med', 'high'] as const
export type DisplayBloom = (typeof DISPLAY_BLOOM_LEVELS)[number]
export const DEFAULT_DISPLAY_BLOOM: DisplayBloom = 'off'
export const DISPLAY_BLOOM_KEY = 'datum.display.bloom'
export const DISPLAY_BLOOM_LABEL: Record<DisplayBloom, string> = {
  off: 'Off', low: 'Low', med: 'Med', high: 'High',
}

export type DisplayFxSurface = 'plot' | 'chrome' | 'overlay' | 'gram'

const mem = new Map<string, string>()
function store(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  try { if (typeof localStorage !== 'undefined') return localStorage } catch { /* private mode */ }
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) }, removeItem: (k) => { mem.delete(k) } }
}

export function parseDisplayBloom(v: unknown): DisplayBloom {
  return (DISPLAY_BLOOM_LEVELS as readonly string[]).includes(String(v)) ? (v as DisplayBloom) : DEFAULT_DISPLAY_BLOOM
}

export function loadDisplayBloom(): DisplayBloom {
  return parseDisplayBloom(store().getItem(DISPLAY_BLOOM_KEY))
}
export function saveDisplayBloom(v: DisplayBloom): void {
  if (v === DEFAULT_DISPLAY_BLOOM) store().removeItem(DISPLAY_BLOOM_KEY)
  else store().setItem(DISPLAY_BLOOM_KEY, v)
}
export function resetDisplayBloomForTests(): void { store().removeItem(DISPLAY_BLOOM_KEY) }

export function bloomAppliesPass(level: DisplayBloom): boolean { return level !== 'off' }
export function extraBloomPasses(level: DisplayBloom): number { return level === 'off' ? 0 : 1 }

export function bloomAppliesTo(surface: DisplayFxSurface, level: DisplayBloom): boolean {
  return bloomAppliesPass(level) && surface !== 'gram'
}

/** CSS selector prefix for the one pass. Empty when off so no filter is attached. */
export function bloomFilterId(level: DisplayBloom): string | null {
  if (level === 'off') return null
  return `datum-bloom-${level}`
}

/** Strength / grain used by the SVG filter (and a CPU stand-in for tests). */
export function bloomParams(level: DisplayBloom): { strength: number; grain: number; blur: number } {
  switch (level) {
    case 'off': return { strength: 0, grain: 0, blur: 0 }
    case 'low': return { strength: 0.22, grain: 0.04, blur: 0.7 }
    case 'med': return { strength: 0.45, grain: 0.07, blur: 1.2 }
    case 'high': return { strength: 0.75, grain: 0.11, blur: 1.8 }
  }
}

/**
 * CPU stand-in for the one compositing pass. Off returns immediately and does
 * not touch `scratch`. The buffer is preallocated by the caller.
 */
export function runBloomPass(level: DisplayBloom, scratch: Float32Array): void {
  if (level === 'off' || scratch.length === 0) return
  const { strength, grain } = bloomParams(level)
  for (let i = 0; i < scratch.length; i++) {
    const n = scratch[i]!
    const glow = Math.max(0, n - 0.35) * strength
    const g = (n - 0.5) * grain
    scratch[i] = Math.min(1, Math.max(0, n + glow + g))
  }
}

/** Surfaces that receive the CSS pass. Grams are listed so tests can assert exclusion. */
export const BLOOM_SURFACES = {
  include: ['.tabbar', '.panel-body.plot', '[data-testid="settings"]', '.gram-head', '.plot-corner'],
  exclude: ['.gram-panel .panel-body', '[data-testid="live-gram-panel"] .panel-body', '[data-testid="secondary-bfi-pane"]', '[data-testid="secondary-demon-pane"]'],
} as const

export const DISPLAY_NIGHT_KEY = 'datum.display.night'
export const DEFAULT_DISPLAY_NIGHT = false

export function loadDisplayNight(): boolean {
  const v = store().getItem(DISPLAY_NIGHT_KEY)
  if (v == null) return DEFAULT_DISPLAY_NIGHT
  return v === '1'
}
export function saveDisplayNight(on: boolean): void {
  if (on === DEFAULT_DISPLAY_NIGHT) store().removeItem(DISPLAY_NIGHT_KEY)
  else store().setItem(DISPLAY_NIGHT_KEY, on ? '1' : '0')
}
export function resetDisplayNightForTests(): void { store().removeItem(DISPLAY_NIGHT_KEY) }
export function resetDisplayFxForTests(): void {
  resetDisplayBloomForTests()
  resetDisplayNightForTests()
}

/** Web plane glyph local space (heading 0 = north): nose −Y, left wing −X, right +X, tail +Y. */
export const NIGHT_NAV_LIGHTS = [
  { name: 'left', x: -6, y: 6, r: 0.92, g: 0.14, b: 0.14, a: 0.9, radius: 1.6 },
  { name: 'right', x: 6, y: 6, r: 0.12, g: 0.86, b: 0.28, a: 0.9, radius: 1.6 },
  { name: 'tail', x: 0, y: 7.2, r: 0.92, g: 0.92, b: 0.95, a: 0.85, radius: 1.5 },
] as const
export const NIGHT_BEACON = { name: 'beacon', x: 0, y: -1, r: 1, g: 0.22, b: 0.16, a: 0.95, radius: 1.8 } as const

export function nightBeaconOn(now: number, period = 1, duty = 0.16): boolean {
  let t = now % period
  if (t < 0) t += period
  return t < duty
}

export function nightLights(enabled: boolean, now: number) {
  if (!enabled) return []
  return nightBeaconOn(now) ? [...NIGHT_NAV_LIGHTS, NIGHT_BEACON] : [...NIGHT_NAV_LIGHTS]
}

export function nightAppliesToPlaneGlyph(enabled: boolean): boolean { return enabled }
/** Night never covers grams, chrome, overlays, or the plot as a whole — plane glyph only. */
export function nightAppliesTo(_surface: DisplayFxSurface, _enabled: boolean): boolean { return false }
