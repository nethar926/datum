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
  it('keeps the displayed streams until the pending set has filled, then swaps atomically', () => {
    const { c, notes, step, host, clock } = setup(3)
    const before = c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)
    c.setGram({ res: 4 })
    expect(c.status.gram).toEqual({ res: 4, filter: 'NB' })
    expect(notes.map((n) => n.type)).toEqual(['pending'])
    expect(c.status.handoff).toMatchObject({ active: true, label: 'RES 5 → 4  FILLING 0%' })
    // Displayed configs untouched while filling.
    expect(c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)).toEqual(before)
    step(4); c.pollHandoff(); expect(c.handoff.phase).toBe('pending')
    expect(c.status.handoff!.label).toMatch(/FILLING [1-9]\d?%/)
    step(12); clock(100); c.pollHandoff()
    const p = notes.at(-1)!
    expect(p.type).toBe('promote')
    if (p.type !== 'promote') return
    expect(p.from.map((x) => x.streamId)).toEqual(before)
    expect(c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)).toEqual(p.to.map((x) => x.streamId))
    expect(c.status.configs[0].res).toBe(4)
    expect(c.status.handoff).toMatchObject({ active: false })
    expect(host().liveStreamCount()).toBe(6) // old set unsubscribed in the worker
    expect(host().lofarStreamIds().active).toEqual(p.to.map((x) => x.streamId))
  })

  it('rapid changes drop only the pending set and never leak worker streams; timeout swaps', () => {
    const { c, notes, step, host, clock } = setup(1000, 3000)
    const displayed = c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)
    for (let i = 0; i < 20; i++) { clock(i * 50); c.setGram({ res: 1 + (i % 4) }); step(1); expect(host().liveStreamCount()).toBeLessThanOrEqual(12) }
    expect(c.status.configs.filter((x) => x.kind === 'lofar').map((x) => x.streamId)).toEqual(displayed) // display never touched
    expect(notes.filter((n) => n.type === 'drop').length).toBeGreaterThanOrEqual(18)
    clock(950 + 2999); c.pollHandoff(); expect(c.handoff.phase).toBe('pending')
    clock(950 + 3000); c.pollHandoff()
    expect(notes.at(-1)!.type).toBe('promote')
    expect(c.status.configs[0].res).toBe(4) // last request (i = 19 → res 4)
    expect(host().liveStreamCount()).toBe(6)
    expect(c.handoff.live.size).toBe(0)
  })

  it('stepping back to the displayed RES mid-handoff cancels it; restart clears it', () => {
    const { c, notes, host } = setup()
    c.setGram({ res: 3 }); c.setGram({ res: 5 })
    expect(notes.map((n) => n.type)).toEqual(['pending', 'drop'])
    expect(c.handoff.phase).toBe('idle'); expect(host().liveStreamCount()).toBe(6)
    c.setGram({ filter: 'BB' })
    c.start()
    expect(c.handoff.phase).toBe('idle'); expect(c.status.handoff).toBeUndefined()
    expect(notes.at(-1)!.type).toBe('drop')
    c.dispose()
  })
})
