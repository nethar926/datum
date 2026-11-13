import { describe, expect, it } from 'vitest'
import { aliRouteSend, type AliEngineSource } from './ali'

describe('ALI send-bearing seam', () => {
  it('routes through sendBearingFromPeak when the engine handles the peak', () => {
    const sent: number[] = []
    const engine: AliEngineSource = {
      aliBearingAmplitudes() { return null },
      sendBearingFromPeak(hz) { sent.push(hz); return true },
    }
    expect(aliRouteSend(72, engine)).toBe('engine')
    expect(sent).toEqual([72])
  })

  it('falls back to the manual path when the engine declines', () => {
    const engine: AliEngineSource = {
      aliBearingAmplitudes() { return null },
      sendBearingFromPeak() { return false },
    }
    expect(aliRouteSend(80, engine)).toBe('manual')
  })
})
