import { describe, expect, it } from 'vitest'
import { AcousticEngine } from '@acoustics'
import { SimHost } from './host'
import type { FromWorker, Tactical } from './contract'

function ridgeline(opts: ConstructorParameters<typeof AcousticEngine>[2] = {}) {
  const hostOut: FromWorker[] = []
  const host = new SimHost((m) => hostOut.push(m))
  host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, ...opts })
  return { host, out: hostOut }
}

describe('deploy sequence (cb4666f fields)', () => {
  it('placed default is live and tuned at t=0', () => {
    const { out } = ridgeline()
    const t = out.filter((m): m is Tactical => m.type === 'tactical').at(-1)!
    expect(t.buoys.length).toBeGreaterThan(0)
    const live = t.buoys.filter((b) => b.state !== 'falling')
    expect(live.length).toBeGreaterThan(0)
    for (const b of live) {
      expect(b.status?.phase).toBe('tuned')
      expect(b.status?.fill).toBe(1)
      expect(b.status?.etaSeconds).toBe(0)
      expect(b.status?.splashTime).toBe(b.status?.liveTime)
    }
  })

  it('unplaced starts with nothing in the water', () => {
    const { out } = ridgeline({ buoyStartMode: 'unplaced' })
    const t = out.filter((m): m is Tactical => m.type === 'tactical').at(-1)
    expect(t?.buoys ?? []).toHaveLength(0)
  })

  it('unplaced autoDropPattern walks the sequence from deployed', () => {
    const { out } = ridgeline({ buoyStartMode: 'unplaced', autoDropPattern: true })
    const t = out.filter((m): m is Tactical => m.type === 'tactical').at(-1)!
    expect(t.buoys.length).toBeGreaterThan(0)
    const st = t.buoys[0].status!
    expect(st.phase).toBe('deployed')
    expect(st.etaSeconds).toBeCloseTo(1, 9)
    expect(st.splashTime).toBeCloseTo(1 + 457.2 / 9, 9)
    expect(st.liveTime).toBeGreaterThan(st.splashTime)
  })

  it('AcousticEngine.dropBuoy always runs the sequence and accepts per-drop geometry', () => {
    const { host, out } = ridgeline({ buoyStartMode: 'unplaced' })
    host.handle({
      type: 'dropBuoys', seq: 1, source: 'manual',
      buoys: [{ kind: 'difar', x: 0, y: 0, channel: 3, dropAltitudeM: 457.2, descentRateMps: 9, integrationTimeS: 8 }],
    })
    const t = out.filter((m): m is Tactical => m.type === 'tactical').at(-1)!
    expect(t.buoys).toHaveLength(1)
    expect(t.buoys[0].status?.phase).toBe('deployed')
    expect(t.buoys[0].status?.liveTime).toBeCloseTo((t.buoys[0].status?.splashTime ?? 0) + 8, 9)
  })
})
