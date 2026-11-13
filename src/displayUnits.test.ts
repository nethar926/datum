import { describe, expect, it, beforeEach } from 'vitest'
import {
  DEFAULT_DISPLAY_UNITS, NMI_M, FOOT_M, YARD_M, SETTINGS_CATALOG, UNITS_SPEED_KEY, UNITS_DISTANCE_KEY,
  aircraftReadout, altitudeFromM, courseSpeed, depthFromM, distanceFromM, fadeLabel, formatAltitude,
  formatDepth, formatRingScale, formatSpeed, loadDisplayUnits, metresFromDepth, mpsFromSpeed,
  rangeBearing, resetDisplayUnitsForTests, saveDisplayUnits, seedUnitsPrefForTests, settingsSection, speedFromMps,
} from './displayUnits'
import { DISPLAY_BLOOM_KEY } from './displayFx'
import { DISPLAY_NIGHT_KEY } from './displayFx'
import { FIX_FADE_KEY } from './tactical/fixStyle'
import { TRAIL_KEY, NAV_KEY, LINE_WEIGHT_KEY } from './tactical/planeRoute'
import { SIM_START_KEY } from './settings/simStart'
import { SCHEME_KEY, GLASS_KEY } from './ui/prefs'

beforeEach(() => { resetDisplayUnitsForTests() })

describe('display units', () => {
  it('defaults to kts, nMi, ft and yds, and keeps a stored value', () => {
    expect(DEFAULT_DISPLAY_UNITS).toEqual({ speed: 'kts', distance: 'nMi', altitude: 'ft', depth: 'yds' })
    expect(loadDisplayUnits()).toEqual(DEFAULT_DISPLAY_UNITS)
    seedUnitsPrefForTests(UNITS_SPEED_KEY, 'kmh')
    let loaded = loadDisplayUnits()
    expect(loaded.speed).toBe('kmh')
    expect(loaded.distance).toBe('nMi')
    expect(loaded.altitude).toBe('ft')
    expect(loaded.depth).toBe('yds')
    saveDisplayUnits({ ...DEFAULT_DISPLAY_UNITS, speed: 'kmh', altitude: 'm' })
    loaded = loadDisplayUnits()
    expect(loaded.speed).toBe('kmh')
    expect(loaded.altitude).toBe('m')
    seedUnitsPrefForTests(UNITS_DISTANCE_KEY, 'furlongs')
    loaded = loadDisplayUnits()
    expect(loaded.distance).toBe('nMi')
    expect(loaded.speed).toBe('kmh')
  })

  it('converts SI values and formats readouts', () => {
    expect(NMI_M).toBe(1852)
    expect(FOOT_M).toBeCloseTo(0.3048, 12)
    expect(YARD_M).toBeCloseTo(0.9144, 12)
    const kts = speedFromMps(1, 'kts')
    expect(kts).toBeCloseTo(3600 / 1852, 12)
    expect(mpsFromSpeed(kts, 'kts')).toBeCloseTo(1, 12)
    expect(speedFromMps(10, 'kmh')).toBeCloseTo(36, 12)
    expect(distanceFromM(1852, 'nMi')).toBeCloseTo(1, 12)
    expect(distanceFromM(2000, 'km')).toBeCloseTo(2, 12)
    expect(altitudeFromM(457.2, 'ft')).toBeCloseTo(1500, 9)
    expect(depthFromM(91.44, 'yds')).toBeCloseTo(100, 9)
    expect(metresFromDepth(100, 'yds')).toBeCloseTo(91.44, 9)
    const def = DEFAULT_DISPLAY_UNITS
    expect(formatSpeed(mpsFromSpeed(120, 'kts'), 'kts')).toBe('120 kts')
    expect(formatAltitude(1500 * FOOT_M, 'ft')).toBe('1500 ft')
    expect(formatDepth(40, 'm')).toBe('40 m')
    expect(formatRingScale(2000, 'km')).toBe('2 km rings')
    expect(formatRingScale(2000, 'nMi')).toBe('1.08 nMi rings')
    expect(aircraftReadout(45, mpsFromSpeed(180, 'kts'), 1500 * FOOT_M, def)).toBe('A/C 045°  180 kts  1500 ft')
    expect(courseSpeed(7, mpsFromSpeed(12.3, 'kts'), def)).toBe('CSE 007° · 12.3 kts')
    expect(rangeBearing(1852, 90, def)).toBe('RNG 1.00 nMi · BRG 090°')
    expect(formatSpeed(10, 'kmh', 0)).toBe('36 km/h')
    expect(fadeLabel(120)).toBe('2 min')
    expect(fadeLabel(45)).toBe('45 s')
  })

  it('keeps every setting reachable in a section', () => {
    const ids = SETTINGS_CATALOG.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    const required = [
      'appearance', 'glass', 'accent', 'bloom', 'night', 'bfi-preset', 'bfi-range', 'app-icon',
      'units-speed', 'units-distance', 'units-altitude', 'units-depth',
      'fix-fade', 'trail-style', 'nav-style', 'line-weight', 'ais',
      'newest-data', 'horz', 'ali', 'bfi', 'secondary-display', 'lofar-colour', 'band-preset', 'sim-band',
      'reveal', 'receiver', 'difficulty', 'start-mode', 'unplaced-layout', 'drop-altitude', 'integration', 'lsti',
      'compendium', 'operator-log', 'symbols', 'debug-overlay', 'reload',
    ]
    expect(ids.sort()).toEqual([...required].sort())
    expect(settingsSection('appearance')).toBe('display')
    expect(settingsSection('bloom')).toBe('display')
    expect(settingsSection('night')).toBe('display')
    expect(settingsSection('bfi-preset')).toBe('display')
    expect(settingsSection('units-speed')).toBe('units')
    expect(settingsSection('fix-fade')).toBe('plot-tactical')
    expect(settingsSection('trail-style')).toBe('plot-tactical')
    expect(settingsSection('ais')).toBe('plot-tactical')
    expect(settingsSection('difficulty')).toBe('simulation')
    expect(settingsSection('start-mode')).toBe('simulation')
    expect(settingsSection('integration')).toBe('simulation')
    expect(settingsSection('lofar-colour')).toBe('gram')
    expect(settingsSection('reload')).toBe('app')
    const keyOf = (id: string) => SETTINGS_CATALOG.find((i) => i.id === id)?.persistKey
    expect(keyOf('bloom')).toBe(DISPLAY_BLOOM_KEY)
    expect(keyOf('night')).toBe(DISPLAY_NIGHT_KEY)
    expect(keyOf('fix-fade')).toBe(FIX_FADE_KEY)
    expect(keyOf('trail-style')).toBe(TRAIL_KEY)
    expect(keyOf('nav-style')).toBe(NAV_KEY)
    expect(keyOf('line-weight')).toBe(LINE_WEIGHT_KEY)
    expect(keyOf('difficulty')).toBe(SIM_START_KEY)
    expect(keyOf('appearance')).toBe(SCHEME_KEY)
    expect(keyOf('glass')).toBe(GLASS_KEY)
  })
})
