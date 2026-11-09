import { describe, expect, it } from 'vitest'
import {
  holdAfterThreeFingerSwipe, isCursorFrozen, isHoldTap, nextHoldOnTap,
  showLockIcon, toggleLockButton,
} from './cursorState'

describe('free / tap-anchor / tap-release / lock', () => {
  it('tap cycles free ↔ anchored', () => {
    expect(nextHoldOnTap('free')).toBe('anchored')
    expect(nextHoldOnTap('anchored')).toBe('free')
    expect(nextHoldOnTap('locked')).toBe('locked')
  })
  it('three-finger swipe down locks only when anchored', () => {
    expect(holdAfterThreeFingerSwipe('anchored', true)).toBe('locked')
    expect(holdAfterThreeFingerSwipe('free', true)).toBe('free')
    expect(holdAfterThreeFingerSwipe('anchored', false)).toBe('anchored')
  })
  it('lock button toggles locked ↔ anchored/free', () => {
    expect(toggleLockButton('locked', true)).toBe('anchored')
    expect(toggleLockButton('locked', false)).toBe('free')
    expect(toggleLockButton('anchored', true)).toBe('locked')
    expect(toggleLockButton('free', false)).toBe('locked')
  })
  it('frozen + lock icon', () => {
    expect(isCursorFrozen('free')).toBe(false)
    expect(isCursorFrozen('anchored')).toBe(true)
    expect(isCursorFrozen('locked')).toBe(true)
    expect(showLockIcon('locked')).toBe(true)
    expect(showLockIcon('anchored')).toBe(false)
  })
  it('hold tap uses lock-tap thresholds', () => {
    expect(isHoldTap(0, 0, 100)).toBe(true)
    expect(isHoldTap(20, 0, 100)).toBe(false)
  })
})
