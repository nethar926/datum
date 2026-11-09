import { describe, expect, it } from 'vitest'
import { EMPTY_LOCKS, toggleLock } from '../gram/cursorLock'
import {
  BRG_OMNI_REASON,
  FIX_DISABLED_REASON,
  NO_GEOM_REASON,
  NO_SESSION_REASON,
  WHEEL_LOFAR_REASON,
  availabilityMap,
  clearToolArm,
  cutToolAvailability,
  emptyToolArm,
  type CutToolContext,
  type ToolArmState,
} from './cutTools'

const difarCut: CutToolContext = {
  hasSession: true,
  buoyCount: 1,
  buoyKind: 'difar',
  hasTactical: true,
  difarMode: true,
}

describe('cutToolAvailability matrix', () => {
  it('disables everything with a reason when no session (picker)', () => {
    const rows = cutToolAvailability({ ...difarCut, hasSession: false })
    expect(rows.every((r) => !r.enabled && r.reason === NO_SESSION_REASON)).toBe(true)
    expect(rows.map((r) => r.id)).toEqual([
      'fix', 'brg', 'dop', 'harm', 'comb', 'lm', 'horz', 'con', 'listen', 'difarWheel',
    ])
  })

  it('disables FIX on a single-buoy cut with an explicit reason (never hidden)', () => {
    const fix = availabilityMap(difarCut).fix
    expect(fix.enabled).toBe(false)
    expect(fix.reason).toBe(FIX_DISABLED_REASON)
  })

  it('enables BRG / DOP / HARM / LM / HORZ / CON / listen / wheel on a DIFAR cut', () => {
    const m = availabilityMap(difarCut)
    for (const id of ['brg', 'dop', 'harm', 'lm', 'horz', 'con', 'listen', 'difarWheel'] as const) {
      expect(m[id].enabled, id).toBe(true)
      expect(m[id].reason, id).toBeUndefined()
    }
  })

  it('disables BRG on an omni cut', () => {
    const brg = availabilityMap({ ...difarCut, buoyKind: 'omni' }).brg
    expect(brg.enabled).toBe(false)
    expect(brg.reason).toBe(BRG_OMNI_REASON)
  })

  it('disables DOP and LM when tactical geometry is missing', () => {
    const m = availabilityMap({ ...difarCut, hasTactical: false })
    expect(m.dop.enabled).toBe(false)
    expect(m.dop.reason).toBe(NO_GEOM_REASON)
    expect(m.lm.enabled).toBe(false)
    expect(m.lm.reason).toBe(NO_GEOM_REASON)
    // FIX still disabled for its own reason
    expect(m.fix.reason).toBe(FIX_DISABLED_REASON)
  })

  it('disables the DIFAR wheel in LOFAR gram mode (reason, not hidden)', () => {
    const wheel = availabilityMap({ ...difarCut, difarMode: false }).difarWheel
    expect(wheel.enabled).toBe(false)
    expect(wheel.reason).toBe(WHEEL_LOFAR_REASON)
  })

  it('keeps disabled tools in the matrix (never omit FIX)', () => {
    const ids = cutToolAvailability(difarCut).map((r) => r.id)
    expect(ids).toContain('fix')
    expect(ids.length).toBe(10)
    expect(ids).toContain('comb')
  })
})

describe('tool arm isolation (Live vs Cuts)', () => {
  it('emptyToolArm returns independent locks/lm objects', () => {
    const a = emptyToolArm()
    const b = emptyToolArm()
    expect(a.locks).not.toBe(b.locks)
    expect(a.lm).not.toBe(b.lm)
    a.locks = toggleLock(a.locks, 'harm')
    a.tool = 'harm'
    a.harmF0 = 42
    expect(b.tool).toBe('select')
    expect(b.locks.harm).toBe(false)
    expect(b.harmF0).toBeNull()
  })

  it('clearToolArm resets Cuts arm without touching a separate Live arm', () => {
    const live: ToolArmState = {
      ...emptyToolArm(),
      tool: 'harm',
      harmF0: 55,
      locks: toggleLock(EMPTY_LOCKS, 'harm'),
    }
    const cuts: ToolArmState = {
      ...emptyToolArm(),
      tool: 'dop',
      locks: toggleLock(EMPTY_LOCKS, 'dop'),
    }
    const cleared = clearToolArm(cuts)
    expect(cleared.tool).toBe('select')
    expect(cleared.locks).toEqual(EMPTY_LOCKS)
    expect(cleared.harmF0).toBeNull()
    // Live snapshot untouched
    expect(live.tool).toBe('harm')
    expect(live.harmF0).toBe(55)
    expect(live.locks.harm).toBe(true)
  })

  it('arming HARM on Cuts does not flip Live locks (value isolation)', () => {
    const live = emptyToolArm()
    const cuts = emptyToolArm()
    cuts.tool = 'harm'
    cuts.locks = toggleLock(cuts.locks, 'harm')
    cuts.harmF0 = 100
    expect(live.tool).toBe('select')
    expect(live.locks.harm).toBe(false)
    expect(live.harmF0).toBeNull()
  })
})
