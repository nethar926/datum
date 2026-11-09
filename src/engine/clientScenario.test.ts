import { afterEach, expect, it, vi } from 'vitest'
import { SimClient } from './client'
import type { ToWorker } from './contract'
import { acousticsV11 } from '../scenarios/acousticsApi'
afterEach(() => vi.unstubAllGlobals())
it('does not carry generated parameters into a named training scenario', () => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const sent: ToWorker[] = []
  const c = new SimClient(() => ({ postMessage: (m: ToWorker) => sent.push(m), terminate() {} }) as unknown as Worker)
  const p = acousticsV11.presetToParams!('regular', 42)
  c.start(42, 'generated', 'lofar1k', p)
  c.setSurfaceTraffic(0)
  c.start(7, 'ridgeline-field', 'lofar1k', undefined)
  const last = sent.filter((m) => m.type === 'init').at(-1)!
  expect(last).toMatchObject({ scenarioId: 'ridgeline-field', seed: 7, surfaceTraffic: 0 })
  expect(last.params).toBeUndefined()
})
