/**
 * Small persisted UI preferences for the iOS-style chrome: portrait/landscape split, HORZ cursor hairline,
 * appearance (system / light / dark) and glass strength. Pure helpers + localStorage wrappers (private mode safe).
 */

// ---------- Split (gram ↔ tactical plot) ----------
export const SPLIT_KEY_V = 'datum.split.v' // stacked (phone portrait): gram on top
export const SPLIT_KEY_H = 'datum.split.h' // side by side (landscape / iPad / desktop): gram on the left
export const SPLIT_DEFAULT_V = 0.6
export const SPLIT_DEFAULT_H = 0.62
/** Minimum pane sizes in CSS px (gram pane includes its 44 px frequency axis). */
export const SPLIT_MIN_GRAM_PX = 168
export const SPLIT_MIN_PLOT_PX = 120

/**
 * Clamp a split fraction (gram share of the total) so each pane keeps its minimum size. If the total is too small
 * for both minimums, the space is shared in proportion to the minimums. Non-finite input falls back to `fallback`.
 */
export function clampSplit(frac: number, totalPx: number, minA = SPLIT_MIN_GRAM_PX, minB = SPLIT_MIN_PLOT_PX, fallback = SPLIT_DEFAULT_V): number {
  const f = Number.isFinite(frac) ? frac : fallback
  const t = Math.max(0, totalPx)
  if (!(t > 0)) return Math.min(0.9, Math.max(0.1, f))
  if (minA + minB >= t) return minA / (minA + minB)
  const lo = minA / t, hi = 1 - minB / t
  return Math.min(hi, Math.max(lo, f))
}

export function loadSplit(key: string, fallback: number): number {
  try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 && v < 1 ? v : fallback } catch { return fallback }
}
export function saveSplit(key: string, frac: number): void {
  try { if (Number.isFinite(frac)) localStorage.setItem(key, frac.toFixed(4)) } catch { /* private mode */ }
}

// ---------- HORZ: horizontal hairline on the default gram cursor ----------
export const HORZ_KEY = 'datum.horz'
/** Off by default. */
export function loadHorz(): boolean {
  try { return localStorage.getItem(HORZ_KEY) === '1' } catch { return false }
}
export function saveHorz(on: boolean): void {
  try { localStorage.setItem(HORZ_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

// ---------- ALI: Automatic Line Integration strip at the newest-data edge ----------
export const ALI_KEY = 'datum.ali'
/** Off by default. */
export function loadAli(): boolean {
  try { return localStorage.getItem(ALI_KEY) === '1' } catch { return false }
}
export function saveAli(on: boolean): void {
  try { localStorage.setItem(ALI_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

// ---------- Appearance ----------
export const SCHEME_KEY = 'datum.scheme'
export type SchemePref = 'system' | 'light' | 'dark'
export type Scheme = 'light' | 'dark'
export const parseScheme = (v: unknown): SchemePref => (v === 'light' || v === 'dark' ? v : 'system')
export function loadScheme(): SchemePref { try { return parseScheme(localStorage.getItem(SCHEME_KEY)) } catch { return 'system' } }
export function saveScheme(s: SchemePref): void { try { localStorage.setItem(SCHEME_KEY, s) } catch { /* private mode */ } }
export const resolveScheme = (pref: SchemePref, systemDark: boolean): Scheme => (pref === 'system' ? (systemDark ? 'dark' : 'light') : pref)

// ---------- Glass strength (low-power / reduced transparency fallback) ----------
export const GLASS_KEY = 'datum.glass'
export type GlassPref = 'auto' | 'full' | 'reduced'
export const parseGlass = (v: unknown): GlassPref => (v === 'full' || v === 'reduced' ? v : 'auto')
export function loadGlass(): GlassPref { try { return parseGlass(localStorage.getItem(GLASS_KEY)) } catch { return 'auto' } }
export function saveGlass(g: GlassPref): void { try { localStorage.setItem(GLASS_KEY, g) } catch { /* private mode */ } }
/** 'auto' follows prefers-reduced-transparency. */
export const resolveGlass = (pref: GlassPref, reducedTransparency: boolean): 'full' | 'reduced' => (pref === 'auto' ? (reducedTransparency ? 'reduced' : 'full') : pref)

// ---------- Tabs ----------
export type Tab = 'live' | 'cuts' | 'plot' | 'settings'
export const TABS: readonly Tab[] = ['live', 'cuts', 'plot', 'settings']
export const TAB_LABEL: Record<Tab, string> = { live: 'Live', cuts: 'Cuts', plot: 'Plot', settings: 'Settings' }
export const TAB_KEY = 'datum.tab'
export const parseTab = (v: unknown): Tab => (TABS as readonly unknown[]).includes(v) ? (v as Tab) : 'live'
