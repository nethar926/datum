import { describe, expect, it } from 'vitest'
import { AUTO_BEARING_MIN_QUALITY, type AutoBearing } from '@acoustics'
import { MIN_DRAW_Q, selectBearings } from './TacticalPlot'
import type { Bearing, TacticalBuoy } from '../engine/contract'

describe('auto bearings', () => {
  it('treats quality as SNR dB and uses a floor of 10', () => {
    expect(MIN_DRAW_Q).toBe(10)
    expect(MIN_DRAW_Q).toBe(AUTO_BEARING_MIN_QUALITY)
    const keep: AutoBearing = { buoyId: 11, contactId: 'k1', freqHz: 72, brgDeg: 45, quality: 10, snrDb: 10, sigmaDeg: 4 }
    const drop: AutoBearing = { buoyId: 12, contactId: 'k2', freqHz: 80, brgDeg: 10, quality: 9.9, snrDb: 9.9, sigmaDeg: 8 }
    expect(keep.quality).toBe(keep.snrDb)
    const buoys: TacticalBuoy[] = [
      { id: 11, channel: 11, kind: 'difar', x: 0, y: 0, hydrophoneDepthM: 60, batteryFrac: 1, lifeRemainingS: 100, state: 'live' },
      { id: 12, channel: 12, kind: 'difar', x: 100, y: 0, hydrophoneDepthM: 60, batteryFrac: 1, lifeRemainingS: 100, state: 'live' },
    ]
    const shown = selectBearings([keep, drop] as Bearing[], buoys, 11, 72, true)
    expect(shown.map((b) => b.buoyId)).toEqual([11])
  })
})
