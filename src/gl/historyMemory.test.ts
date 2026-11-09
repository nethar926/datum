import { describe, expect, it } from 'vitest'
import { MAX_FIELD_BUOYS } from '../engine/host'
import {
  CURRENT_DEMON_HISTORY_ROWS, CURRENT_HISTORY_ROWS, HISTORY_BUDGET_CPU_MB, HISTORY_BUDGET_GPU_MB,
  HISTORY_FIELD_BUOYS, SCROLL_BACK_HISTORY_ROWS, bytesToMb, estimateDemonGpuBytes,
  estimateLevelHistoryCpuBytes, estimateLofarGpuBytes, liveLofarTextures, lofarGpuWithinBudget,
} from './historyMemory'

describe('history ring memory (current R16F / Float32)', () => {
  it('field cap matches SimHost', () => {
    expect(HISTORY_FIELD_BUOYS).toBe(MAX_FIELD_BUOYS)
    expect(SCROLL_BACK_HISTORY_ROWS).toBe(1800)
  })

  it('counts band 2N+N and RES N+N textures', () => {
    expect(liveLofarTextures('band', 32)).toBe(96)
    expect(liveLofarTextures('res', 32)).toBe(64)
  })

  it('reports current vs 15-min LOFAR GPU for a full 32-buoy field at max bins', () => {
    const band600 = bytesToMb(estimateLofarGpuBytes({ rows: CURRENT_HISTORY_ROWS, bins: 2048, mode: 'band' }))
    const band1800 = bytesToMb(estimateLofarGpuBytes({ rows: SCROLL_BACK_HISTORY_ROWS, bins: 2048, mode: 'band' }))
    const res600 = bytesToMb(estimateLofarGpuBytes({ rows: CURRENT_HISTORY_ROWS, bins: 1024, mode: 'res' }))
    const res1800 = bytesToMb(estimateLofarGpuBytes({ rows: SCROLL_BACK_HISTORY_ROWS, bins: 1024, mode: 'res' }))
    // Exact: bins × rows × 2 × textures / 1e6
    expect(band600).toBeCloseTo(235.93, 1)
    expect(band1800).toBeCloseTo(707.79, 1)
    expect(res600).toBeCloseTo(78.64, 1)
    expect(res1800).toBeCloseTo(235.93, 1)
  })

  it('CPU LevelHistory stays small (one on-screen stream)', () => {
    const cpu1800 = bytesToMb(estimateLevelHistoryCpuBytes(SCROLL_BACK_HISTORY_ROWS, 2048))
    expect(cpu1800).toBeLessThan(HISTORY_BUDGET_CPU_MB)
    expect(cpu1800).toBeCloseTo(14.75, 1)
  })

  it('holds the 1,800-row bump: band LOFAR at max bins exceeds GPU budget', () => {
    expect(lofarGpuWithinBudget(CURRENT_HISTORY_ROWS, 2048, 'band')).toBe(true)
    expect(lofarGpuWithinBudget(SCROLL_BACK_HISTORY_ROWS, 2048, 'band')).toBe(false)
    // RES alone at 1800 is under the soft ceiling, but band (operator default for ELF–MF) is not.
    expect(lofarGpuWithinBudget(SCROLL_BACK_HISTORY_ROWS, 1024, 'res')).toBe(true)
  })

  it('DEMON pane adds further GPU when raised to 15 min', () => {
    const cur = bytesToMb(estimateDemonGpuBytes({ rows: CURRENT_DEMON_HISTORY_ROWS }))
    const want = bytesToMb(estimateDemonGpuBytes({ rows: SCROLL_BACK_HISTORY_ROWS }))
    expect(cur).toBeCloseTo(49.15, 1)
    expect(want).toBeCloseTo(176.95, 1)
    const combined1800 =
      bytesToMb(estimateLofarGpuBytes({ rows: SCROLL_BACK_HISTORY_ROWS, bins: 2048, mode: 'band' })) + want
    expect(combined1800).toBeGreaterThan(HISTORY_BUDGET_GPU_MB)
  })
})
