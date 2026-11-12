import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SimClient, type HandoffNotice } from './client'
import { SimHost } from './host'
import type { FromWorker, ToWorker } from './contract'
import { HandoffMachine } from '../gram/handoff'

/** In-process "worker": SimHost behind a postMessage-shaped object (synchronous delivery). */
function fakeWorker(hosts: SimHost[]) {
  const w = { onmessage: null as ((e: MessageEvent<FromWorker>) => void) | null, onerror: null, terminated: false,
    host: undefined as unknown as SimHost, sent: [] as ToWorker['type'][],
    postMessage(m: ToWorker) { if (!w.terminated) { w.sent.push(m.type); w.host.handle(m) } }, terminate() { w.terminated = true } }
  w.host = new SimHost((m) => { if (!w.terminated) w.onmessage?.({ data: m } as MessageEvent<FromWorker>) })
  w.host.historyRows = 16
  w.host.visibleRows = 8
  hosts.push(w.host)
  return w
}
const g = globalThis as unknown as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown }
const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame }
beforeAll(() => { g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {} })
afterAll(() => { g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf })

function setup(fill = 3, timeout = 3000) {
  let t = 0
  const hosts: SimHost[] = [], workers: ReturnType<typeof fakeWorker>[] = []
  const c = new SimClient(() => { const w = fakeWorker(hosts); workers.push(w); return w as unknown as Worker }, new HandoffMachine(fill, timeout), () => t)
  const notes: HandoffNotice[] = []
  c.onHandoff((n) => notes.push(n))
  c.setGram({ res: 5, filter: 'NB' })
  c.start()
  const step = (k: number) => { for (let i = 0; i < k; i++) (c as unknown as { send: (m: ToWorker) => void }).send({ type: 'step' }) }
  return { c, notes, step, host: () => hosts.at(-1)!, worker: () => workers.at(-1)!, clock: (ms: number) => { t = ms } }
}

describe('SimClient gram handoff', () => {
  it('RES switch keeps stream ids and starts a filling drain (no second subscribe)', () => {
    const { c, notes, step, host } = setup(3)
    const before = c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)
    const drains: { filledFrom: number; handleId: number; totalRows: number }[] = []
    c.onDrainProgress((ev) => drains.push({ filledFrom: ev.filledFrom, handleId: ev.handleId, totalRows: ev.totalRows }))
    step(16)
    c.setGram({ res: 4 })
    expect(c.status.gram).toEqual({ res: 4, filter: 'NB' })
    expect(notes).toHaveLength(0)
    expect(c.handoff.phase).toBe('idle')
    expect(c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)).toEqual(before)
    expect(c.status.configs[0]!.res).toBe(4)
    expect(host().liveStreamCount()).toBe(12) // 6 LOFAR + 6 always-on DEMON; same ids, no pending set
    expect(host().lofarStreamIds().active).toEqual(before)
    expect(drains.length).toBeGreaterThan(0)
    expect(drains[0]!.totalRows).toBeGreaterThan(0)
    expect(drains[0]!.filledFrom).toBeLessThanOrEqual(drains[0]!.totalRows)
  })

  it('rapid RES changes never leak worker streams and keep the same ids', () => {
    const { c, notes, step, host, clock } = setup(1000, 3000)
    const displayed = c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)
    for (let i = 0; i < 20; i++) {
      clock(i * 50)
      c.setGram({ res: 1 + (i % 4) })
      step(1)
      expect(host().liveStreamCount()).toBe(12)
    }
    expect(c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)).toEqual(displayed)
    expect(notes.filter((n) => n.type === 'pending' || n.type === 'drop' || n.type === 'promote')).toHaveLength(0)
    expect(c.status.configs[0]!.res).toBe(4) // last request (i = 19 → res 4)
    expect(c.handoff.phase).toBe('idle')
    expect(c.handoff.live.size).toBe(0)
  })

  it('switch-back mid-fill cancels the previous drain and starts a clean handle', () => {
    const { c, notes, host } = setup()
    const ids: number[] = []
    c.onDrainProgress((ev) => ids.push(ev.handleId))
    c.setGram({ res: 3 }); c.setGram({ res: 5 })
    expect(notes).toHaveLength(0)
    expect(c.handoff.phase).toBe('idle'); expect(host().liveStreamCount()).toBe(12)
    expect(c.status.configs[0]!.res).toBe(5)
    expect(new Set(ids).size).toBeGreaterThanOrEqual(2)
    c.setGram({ filter: 'BB' })
    c.start()
    expect(c.handoff.phase).toBe('idle')
    expect(c.status.configs[0]!.filter).toBe('BB')
    c.dispose()
  })
})

describe('SimClient band presets', () => {
  function setupBand(fill = 2) {
    let t = 0
    const hosts: SimHost[] = []
    const c = new SimClient(() => fakeWorker(hosts) as unknown as Worker, new HandoffMachine(fill, 3000), () => t)
    const notes: HandoffNotice[] = []
    c.onHandoff((n) => notes.push(n))
    c.setGram({ res: 5, filter: 'NB', band: 'LF' })
    c.start()
    const step = (k: number) => { for (let i = 0; i < k; i++) (c as unknown as { send: (m: ToWorker) => void }).send({ type: 'step' }) }
    return { c, notes, step, host: () => hosts.at(-1)!, clock: (ms: number) => { t = ms } }
  }
  const lofarOf = (c: SimClient) => c.status.configs.filter((x) => x.kind === 'lofar')

  it('starts on the saved band (RES off) and hands off between presets', () => {
    const { c, notes, step, host } = setupBand()
    expect(lofarOf(c)[0]).toMatchObject({ bandPreset: 'LF' })
    c.setGram({ band: 'MF' })
    expect(c.status.gram).toEqual({ res: 5, filter: 'NB', band: 'MF' })
    expect(c.status.handoff?.label).toBe('LF → MF  FILLING 0%')
    step(3); c.pollHandoff()
    expect(notes.at(-1)!.type).toBe('promote')
    expect(lofarOf(c)[0].bandPreset).toBe('MF')
    expect(lofarOf(c)[0].fBin * 2047).toBeCloseTo(2000)
    expect(host().liveStreamCount()).toBe(12)
  })

  it('NB/BB on a band gram is display-only (no new streams); RES −/+ hands back to RES', () => {
    const { c, notes, step, host } = setupBand()
    c.setGram({ filter: 'BB' })
    expect(notes).toHaveLength(0)
    expect(c.status.gram).toMatchObject({ filter: 'BB', band: 'LF' })
    c.setGram({ res: 4, band: null })
    expect(c.status.gram).toEqual({ res: 4, filter: 'BB' })
    expect(c.status.handoff?.label).toBe('LF → RES 4  FILLING 0%')
    step(12); c.pollHandoff()
    expect(lofarOf(c)[0]).toMatchObject({ res: 4, filter: 'BB', bins: 1024 })
    expect(lofarOf(c)[0].bandPreset).toBeUndefined()
    expect(host().liveStreamCount()).toBe(12)
  })

  it('restart keeps the band family: init carries bandPreset, never res together with it', () => {
    const { c, host } = setupBand()
    c.setGram({ band: 'ELF' }); c.start()
    expect(host().lofarStreamIds().mode).toBe('band')
    expect(lofarOf(c)[0].bandPreset).toBe('ELF')
  })
})
