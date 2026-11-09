/**
 * Shared DEMON display + subscribe contract for Cuts and live SIM.
 * Carrier band, display LUT, and NORM come from acoustics so Sonya\'s retunes drop in
 * without FE rewrites (db2de08+: DEMON_CARRIER_BAND [1000,4000], DEMON_DISPLAY_DB 0–20).
 *
 * Live hint copy lives here. Cuts/reveal answer-key helpers live in
 * `src/cuts/cuts answer-key UI module` and must not be imported from this module.
 */
import {
  DEMON_NORM,
  DEMON_CARRIER_BAND,
  DEMON_DISPLAY_DB,
} from '@acoustics'

export { DEMON_NORM, DEMON_CARRIER_BAND, DEMON_DISPLAY_DB }

/** Live/Cuts DEMON gram: bins and axis from DemonStream (0..~100 Hz @ ~0.196 Hz, 4 Hz rows). */
export const DEMON_STREAM = {
  bins: 512,
  f0Hz: 0,
  fMaxHz: 100,
  rowRateHz: 4,
} as const

/**
 * FE DEMON display contract.
 * Window/guard/clamp from DEMON_NORM; colour floor/ceil from DEMON_DISPLAY_DB (0–20).
 */
export const DEMON_DISPLAY = {
  get window() { return DEMON_NORM.window },
  get guard() { return DEMON_NORM.guard },
  get clampFloorDb() { return DEMON_NORM.clampFloorDb },
  get floorDb() { return DEMON_DISPLAY_DB.floorDb },
  get ceilDb() { return DEMON_DISPLAY_DB.ceilDb },
  get displayCeilDb() { return DEMON_DISPLAY_DB.ceilDb },
} as const

/** Gram props after whitening (absolute map; not live NB 1–22). */
export const DEMON_GRAM = {
  normalized: false as const,
  auto: false as const,
}

/** Bounded FE history rows for a live/Cuts DEMON Gram (full precision, no decimation). */
export const DEMON_HISTORY_ROWS = 500

/** True when a gram mode is the DEMON waterfall (no DIFAR bearing colouring). */
export function isDemonView(mode: string): boolean {
  return mode === 'demon'
}

/** Live SIM DEMON chrome — fixed copy; must not depend on contact state. */
export const LIVE_DEMON_HINT = 'DEMON shows propulsion only from cavitating contacts.' as const

/** Always returns LIVE_DEMON_HINT; contacts/state are ignored on purpose (no answer leak). */
export function liveDemonHint(_contacts?: unknown): string {
  return LIVE_DEMON_HINT
}

/**
 * Cuts / reveal wording Sonya owns. Displayed only when the acoustics cut expectation helper says
 * lines are not expected. Kept here as the string constant; the adapter that decides
 * when to show it lives in cuts/cuts answer-key UI module.
 */
export const CUT_DEMON_NO_CAV_HINT = 'no cavitation, no DEMON lines expected' as const
