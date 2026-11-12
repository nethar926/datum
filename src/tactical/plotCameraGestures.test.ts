import { describe, expect, it } from 'vitest'
import { PLOT_DOUBLE_TAP_S, PLOT_DOUBLE_TAP_SLOP_PT, plotCameraAllows, plotDoubleTap } from './plotCameraGestures'

describe('plot camera gestures (shared with native PlotDoubleTap)', () => {
  it('matches native double-tap window and slop', () => {
    expect(PLOT_DOUBLE_TAP_S).toBe(0.3)
    expect(PLOT_DOUBLE_TAP_SLOP_PT).toBe(24)
    const first = plotDoubleTap(null, 10, 10, 1)
    expect(first.kind).toBe('pick')
    expect(plotDoubleTap(first.last, 12, 11, 1.2).kind).toBe('recentre')
    const after = plotDoubleTap(first.last, 12, 11, 1.2)
    expect(after.last).toBeNull()
    expect(plotDoubleTap(after.last, 12, 11, 1.3).kind).toBe('pick')
    const slow = plotDoubleTap({ t: 2, x: 12, y: 11 }, 12, 11, 2.5)
    expect(slow.kind).toBe('pick')
    const far = plotDoubleTap({ t: 2, x: 12, y: 11 }, 80, 11, 2.1)
    expect(far.kind).toBe('pick')
  })

  it('stands down while the drop run or armed BRG owns the plot', () => {
    expect(plotCameraAllows({ dropCaptures: false, brgArmed: false })).toBe(true)
    expect(plotCameraAllows({ dropCaptures: true, brgArmed: false })).toBe(false)
    expect(plotCameraAllows({ dropCaptures: false, brgArmed: true })).toBe(false)
    expect(plotCameraAllows({ dropCaptures: true, brgArmed: true })).toBe(false)
  })
})
