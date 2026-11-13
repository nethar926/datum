/**
 * Operator-facing units. Internal values stay SI (m, m/s). Defaults are
 * kts, nMi, ft and yds. Each preference is stored under its own key so an
 * already-saved value is kept.
 */

export const SPEED_UNITS = ['kts', 'mps', 'kmh'] as const
export type SpeedUnit = (typeof SPEED_UNITS)[number]
export const DISTANCE_UNITS = ['nMi', 'km', 'm', 'yd'] as const
export type DistanceUnit = (typeof DISTANCE_UNITS)[number]
export const ALTITUDE_UNITS = ['ft', 'm'] as const
export type AltitudeUnit = (typeof ALTITUDE_UNITS)[number]
export const DEPTH_UNITS = ['yds', 'm', 'ft'] as const
export type DepthUnit = (typeof DEPTH_UNITS)[number]

export interface DisplayUnits {
  speed: SpeedUnit
  distance: DistanceUnit
  altitude: AltitudeUnit
  depth: DepthUnit
}

export const DEFAULT_DISPLAY_UNITS: DisplayUnits = { speed: 'kts', distance: 'nMi', altitude: 'ft', depth: 'yds' }

export const UNITS_SPEED_KEY = 'datum.units.speed'
export const UNITS_DISTANCE_KEY = 'datum.units.distance'
export const UNITS_ALTITUDE_KEY = 'datum.units.altitude'
export const UNITS_DEPTH_KEY = 'datum.units.depth'

export const SPEED_UNIT_LABEL: Record<SpeedUnit, string> = { kts: 'kts', mps: 'm/s', kmh: 'km/h' }
export const DISTANCE_UNIT_LABEL: Record<DistanceUnit, string> = { nMi: 'nMi', km: 'km', m: 'm', yd: 'yd' }
export const ALTITUDE_UNIT_LABEL: Record<AltitudeUnit, string> = { ft: 'ft', m: 'm' }
export const DEPTH_UNIT_LABEL: Record<DepthUnit, string> = { yds: 'yds', m: 'm', ft: 'ft' }

export const NMI_M = 1852
export const FOOT_M = 0.3048
export const YARD_M = 0.9144

const mem = new Map<string, string>()
function store(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  try { if (typeof localStorage !== 'undefined') return localStorage } catch { /* private mode */ }
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) }, removeItem: (k) => { mem.delete(k) } }
}

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback
}

let cached: DisplayUnits | null = null
function sameUnits(a: DisplayUnits, b: DisplayUnits): boolean {
  return a.speed === b.speed && a.distance === b.distance && a.altitude === b.altitude && a.depth === b.depth
}
function readUnits(): DisplayUnits {
  const s = store()
  return {
    speed: pick(s.getItem(UNITS_SPEED_KEY), SPEED_UNITS, DEFAULT_DISPLAY_UNITS.speed),
    distance: pick(s.getItem(UNITS_DISTANCE_KEY), DISTANCE_UNITS, DEFAULT_DISPLAY_UNITS.distance),
    altitude: pick(s.getItem(UNITS_ALTITUDE_KEY), ALTITUDE_UNITS, DEFAULT_DISPLAY_UNITS.altitude),
    depth: pick(s.getItem(UNITS_DEPTH_KEY), DEPTH_UNITS, DEFAULT_DISPLAY_UNITS.depth),
  }
}
export function loadDisplayUnits(): DisplayUnits {
  const next = readUnits()
  if (cached && sameUnits(cached, next)) return cached
  cached = next
  return cached
}
export function getDisplayUnits(): DisplayUnits { return loadDisplayUnits() }

function saveField(key: string, value: string, fallback: string): void {
  if (value === fallback) store().removeItem(key)
  else store().setItem(key, value)
}

export function saveDisplayUnits(u: DisplayUnits): void {
  saveField(UNITS_SPEED_KEY, u.speed, DEFAULT_DISPLAY_UNITS.speed)
  saveField(UNITS_DISTANCE_KEY, u.distance, DEFAULT_DISPLAY_UNITS.distance)
  saveField(UNITS_ALTITUDE_KEY, u.altitude, DEFAULT_DISPLAY_UNITS.altitude)
  saveField(UNITS_DEPTH_KEY, u.depth, DEFAULT_DISPLAY_UNITS.depth)
  bump()
}

export function resetDisplayUnitsForTests(): void {
  const s = store()
  s.removeItem(UNITS_SPEED_KEY); s.removeItem(UNITS_DISTANCE_KEY)
  s.removeItem(UNITS_ALTITUDE_KEY); s.removeItem(UNITS_DEPTH_KEY)
  bump()
}
/** Test-only: write a raw key the way an existing user would already have it. */
export function seedUnitsPrefForTests(key: string, value: string): void {
  store().setItem(key, value)
  cached = null
}

let version = 0
const listeners = new Set<() => void>()
function bump(): void { cached = readUnits(); version++; listeners.forEach((fn) => fn()) }
export function subscribeDisplayUnits(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
export function displayUnitsVersion(): number { return version }

export function speedFromMps(mps: number, unit: SpeedUnit): number {
  if (unit === 'kts') return mps * 3600 / NMI_M
  if (unit === 'kmh') return mps * 3.6
  return mps
}
export function mpsFromSpeed(value: number, unit: SpeedUnit): number {
  if (unit === 'kts') return value * NMI_M / 3600
  if (unit === 'kmh') return value / 3.6
  return value
}
export function distanceFromM(m: number, unit: DistanceUnit): number {
  if (unit === 'nMi') return m / NMI_M
  if (unit === 'km') return m / 1000
  if (unit === 'yd') return m / YARD_M
  return m
}
export function metresFromDistance(value: number, unit: DistanceUnit): number {
  if (unit === 'nMi') return value * NMI_M
  if (unit === 'km') return value * 1000
  if (unit === 'yd') return value * YARD_M
  return value
}
export function altitudeFromM(m: number, unit: AltitudeUnit): number {
  return unit === 'ft' ? m / FOOT_M : m
}
export function metresFromAltitude(value: number, unit: AltitudeUnit): number {
  return unit === 'ft' ? value * FOOT_M : value
}
export function depthFromM(m: number, unit: DepthUnit): number {
  if (unit === 'yds') return m / YARD_M
  if (unit === 'ft') return m / FOOT_M
  return m
}
export function metresFromDepth(value: number, unit: DepthUnit): number {
  if (unit === 'yds') return value * YARD_M
  if (unit === 'ft') return value * FOOT_M
  return value
}

export function formatNumber(v: number, digits: number): string {
  if (digits <= 0) return String(Math.round(v))
  return v.toFixed(digits)
}

export function formatSpeed(mps: number, unit: SpeedUnit, digits = 0): string {
  return `${formatNumber(speedFromMps(mps, unit), digits)} ${SPEED_UNIT_LABEL[unit]}`
}
export function formatDistance(m: number, unit: DistanceUnit, digits = 2): string {
  return `${formatNumber(distanceFromM(m, unit), digits)} ${DISTANCE_UNIT_LABEL[unit]}`
}
export function formatAltitude(m: number, unit: AltitudeUnit, digits = 0): string {
  return `${formatNumber(altitudeFromM(m, unit), digits)} ${ALTITUDE_UNIT_LABEL[unit]}`
}
export function formatDepth(m: number, unit: DepthUnit, digits = 0): string {
  return `${formatNumber(depthFromM(m, unit), digits)} ${DEPTH_UNIT_LABEL[unit]}`
}
export function formatRingScale(spacingM = 2000, unit: DistanceUnit): string {
  const digits = unit === 'km' || unit === 'm' ? 0 : 2
  return `${formatNumber(distanceFromM(spacingM, unit), digits)} ${DISTANCE_UNIT_LABEL[unit]} rings`
}

export function aircraftReadout(headingDeg: number, speedMps: number, altitudeM: number, units: DisplayUnits): string {
  let hdg = Math.round(headingDeg) % 360
  if (hdg < 0) hdg += 360
  return `A/C ${String(hdg).padStart(3, '0')}°  ${formatSpeed(speedMps, units.speed, 0)}  ${formatAltitude(altitudeM, units.altitude, 0)}`
}

export function courseSpeed(crsDeg: number, speedMps: number, units: DisplayUnits, speedDigits = 1): string {
  let hdg = Math.round(crsDeg) % 360
  if (hdg < 0) hdg += 360
  return `CSE ${String(hdg).padStart(3, '0')}° · ${formatSpeed(speedMps, units.speed, speedDigits)}`
}

export function rangeBearing(rngM: number, brgDeg: number, units: DisplayUnits): string {
  let brg = Math.round(brgDeg) % 360
  if (brg < 0) brg += 360
  return `RNG ${formatDistance(rngM, units.distance, 2)} · BRG ${String(brg).padStart(3, '0')}°`
}

export function fadeLabel(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const m = seconds / 60
    return m === 1 ? '1 min' : `${m} min`
  }
  return `${Math.round(seconds)} s`
}

export const SETTINGS_SECTIONS = ['display', 'units', 'plot-tactical', 'gram', 'simulation', 'reference', 'debug', 'app'] as const
export type SettingsSectionID = (typeof SETTINGS_SECTIONS)[number]

export interface SettingsItem { id: string; section: SettingsSectionID; persistKey: string | null }

export const SETTINGS_CATALOG: SettingsItem[] = [
  { id: 'appearance', section: 'display', persistKey: 'datum.scheme' },
  { id: 'glass', section: 'display', persistKey: 'datum.glass' },
  { id: 'accent', section: 'display', persistKey: 'datum.accent' },
  { id: 'bloom', section: 'display', persistKey: 'datum.display.bloom' },
  { id: 'night', section: 'display', persistKey: 'datum.display.night' },
  { id: 'bfi-preset', section: 'display', persistKey: null },
  { id: 'bfi-range', section: 'display', persistKey: null },
  { id: 'app-icon', section: 'display', persistKey: null },
  { id: 'units-speed', section: 'units', persistKey: UNITS_SPEED_KEY },
  { id: 'units-distance', section: 'units', persistKey: UNITS_DISTANCE_KEY },
  { id: 'units-altitude', section: 'units', persistKey: UNITS_ALTITUDE_KEY },
  { id: 'units-depth', section: 'units', persistKey: UNITS_DEPTH_KEY },
  { id: 'fix-fade', section: 'plot-tactical', persistKey: 'datum.fix.fadeS' },
  { id: 'trail-style', section: 'plot-tactical', persistKey: 'datum.plane.trail' },
  { id: 'nav-style', section: 'plot-tactical', persistKey: 'datum.plane.nav' },
  { id: 'line-weight', section: 'plot-tactical', persistKey: 'datum.plane.lineWeight' },
  { id: 'ais', section: 'plot-tactical', persistKey: null },
  { id: 'newest-data', section: 'gram', persistKey: null },
  { id: 'horz', section: 'gram', persistKey: null },
  { id: 'ali', section: 'gram', persistKey: null },
  { id: 'bfi', section: 'gram', persistKey: null },
  { id: 'secondary-display', section: 'gram', persistKey: null },
  { id: 'lofar-colour', section: 'gram', persistKey: null },
  { id: 'band-preset', section: 'gram', persistKey: null },
  { id: 'sim-band', section: 'gram', persistKey: null },
  { id: 'reveal', section: 'simulation', persistKey: null },
  { id: 'receiver', section: 'simulation', persistKey: null },
  { id: 'difficulty', section: 'simulation', persistKey: 'datum.simStart' },
  { id: 'start-mode', section: 'simulation', persistKey: null },
  { id: 'unplaced-layout', section: 'simulation', persistKey: null },
  { id: 'drop-altitude', section: 'simulation', persistKey: null },
  { id: 'integration', section: 'simulation', persistKey: null },
  { id: 'lsti', section: 'simulation', persistKey: null },
  { id: 'compendium', section: 'reference', persistKey: null },
  { id: 'operator-log', section: 'reference', persistKey: null },
  { id: 'symbols', section: 'reference', persistKey: null },
  { id: 'debug-overlay', section: 'debug', persistKey: null },
  { id: 'reload', section: 'app', persistKey: null },
]

export function settingsSection(id: string): SettingsSectionID | undefined {
  return SETTINGS_CATALOG.find((i) => i.id === id)?.section
}
