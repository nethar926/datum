import { describe, expect, it } from 'vitest'
import {
  EMPTY_LOCKS, LOCK_TAP_MAX_MS, LOCK_TAP_SLOP_PX,
  isLockTap, lockKindForTool, toggleLock,
} from './cursorLock'

describe('isLockTap', () => {
  it('accepts a short, still press', () => {
    expect(isLockTap(0, 0, 40)).toBe(true)
    expect(isLockTap(3, 4, 120)).toBe(true) // hypot 5 ≤ 6
    expect(isLockTap(LOCK_TAP_SLOP_PX, 0, LOCK_TAP_MAX_MS)).toBe(true)
  })
  it('rejects movement past the slop', () => {
    expect(isLockTap(LOCK_TAP_SLOP_PX + 0.1, 0, 80)).toBe(false)
    expect(isLockTap(5, 5, 80)).toBe(false) // hypot ~7.07
  })
  it('rejects a press that lasts too long (held scrub / long-press)', () => {
    expect(isLockTap(0, 0, LOCK_TAP_MAX_MS + 1)).toBe(false)
    expect(isLockTap(0, 0, 450)).toBe(false)
  })
  it('rejects negative or non-finite duration', () => {
    expect(isLockTap(0, 0, -1)).toBe(false)
    expect(isLockTap(0, 0, Number.NaN)).toBe(false)
  })
})

describe('toggleLock / lockKindForTool', () => {
  it('toggles each cursor kind independently', () => {
    let s = EMPTY_LOCKS
    s = toggleLock(s, 'default')
    expect(s).toEqual({ default: true, harm: false, dop: false, lm: false })
    s = toggleLock(s, 'harm')
    expect(s.default).toBe(true)
    expect(s.harm).toBe(true)
    s = toggleLock(s, 'default')
    expect(s.default).toBe(false)
    expect(s.harm).toBe(true)
  })
  it('routes the lock-tap to the armed placed tool, else the default cursor', () => {
    expect(lockKindForTool('select', { harmPlaced: false, dopPlaced: false })).toBe('default')
    expect(lockKindForTool('harm', { harmPlaced: false, dopPlaced: false })).toBe('default')
    expect(lockKindForTool('harm', { harmPlaced: true, dopPlaced: false })).toBe('harm')
    expect(lockKindForTool('lm', { harmPlaced: true, dopPlaced: true })).toBe('lm')
    expect(lockKindForTool('dop', { harmPlaced: false, dopPlaced: false })).toBe('default')
    expect(lockKindForTool('dop', { harmPlaced: false, dopPlaced: true })).toBe('dop')
  })
})
