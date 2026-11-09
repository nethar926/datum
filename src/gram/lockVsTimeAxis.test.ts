import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  aabbOverlap, lockBtnRect, timeAxisColumnRect, topmostZuluTickRect, GRAM_TIME_AXIS_PX, LOCK_BTN,
} from './lockVsTimeAxis'

describe('lock vs time-axis layout', () => {
  it('CSS parks the lock left of the 44px axis column', () => {
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toMatch(/\.cursor-lock-btn\s*\{[\s\S]*?right:\s*calc\(44px\s*\+\s*8px\)/)
  })

  it('lock AABB never intersects the axis column or a topmost Zulu tick at 951/669/382', () => {
    for (const gramW of [951, 669, 382]) {
      const gramH = 360
      const lock = lockBtnRect(gramW)
      const axis = timeAxisColumnRect(gramW, gramH)
      const tick = topmostZuluTickRect(gramW)
      expect(lock.right).toBeLessThanOrEqual(axis.left)
      expect(aabbOverlap(lock, axis)).toBe(false)
      expect(aabbOverlap(lock, tick)).toBe(false)
    }
    expect(GRAM_TIME_AXIS_PX + LOCK_BTN.gapFromAxisPx).toBe(52)
  })
})
