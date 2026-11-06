import { describe, expect, it, vi } from 'vitest'
import {
  UPDATE_BACKOFF_START_MS,
  UpdatePoller,
  assetBasename,
  bundlesDiffer,
  parseBundleNames,
} from './updateCheck'

const HTML_A = `<!doctype html><html><head>
<link rel="stylesheet" href="/datum/assets/index-AaAaAa.css">
<script type="module" src="/datum/assets/index-BbBbBb.js"></script>
<script type="module" src="/datum/assets/sim.worker-CcCcCc.js"></script>
</head><body></body></html>`

const HTML_B = `<!doctype html><html><head>
<link rel="stylesheet" href="/datum/assets/index-XxXxXx.css">
<script type="module" src="/datum/assets/index-YyYyYy.js"></script>
<script type="module" src="/datum/assets/sim.worker-ZzZzZz.js"></script>
</head><body></body></html>`

describe('parseBundleNames / assetBasename', () => {
  it('extracts hashed asset basenames from HTML', () => {
    expect(parseBundleNames(HTML_A).sort()).toEqual([
      'index-AaAaAa.css',
      'index-BbBbBb.js',
      'sim.worker-CcCcCc.js',
    ].sort())
  })
  it('ignores non-asset URLs and dedupes', () => {
    const html = `<script src="/datum/src/main.tsx"></script>
      <script src="/datum/assets/index-Ab12Cd.js"></script>
      <script src="/datum/assets/index-Ab12Cd.js"></script>
      <link href="/favicon.svg">`
    expect(parseBundleNames(html)).toEqual(['index-Ab12Cd.js'])
  })
  it('assetBasename strips query/hash and path', () => {
    expect(assetBasename('/datum/assets/index-Ab.js?v=1#x')).toBe('index-Ab.js')
    expect(assetBasename('https://ex.test/datum/assets/foo-1.css')).toBe('foo-1.css')
  })
})

describe('bundlesDiffer', () => {
  it('false when remote matches current set', () => {
    const cur = parseBundleNames(HTML_A)
    expect(bundlesDiffer(cur, HTML_A)).toBe(false)
  })
  it('true when remote hashed names differ', () => {
    const cur = parseBundleNames(HTML_A)
    expect(bundlesDiffer(cur, HTML_B)).toBe(true)
  })
  it('false on empty/unparseable remote (no false alarm)', () => {
    expect(bundlesDiffer(['index-Aa.js'], '<html></html>')).toBe(false)
    expect(bundlesDiffer(['index-Aa.js'], '')).toBe(false)
  })
  it('true when a single index hash flips', () => {
    const cur = ['index-Old.js', 'index-Old.css']
    const remote = `<script src="/assets/index-New.js"></script><link href="/assets/index-Old.css" rel="stylesheet">`
    expect(bundlesDiffer(cur, remote)).toBe(true)
  })
})

describe('UpdatePoller', () => {
  it('reports update when remote differs; backs off on failure; pauses when hidden', async () => {
    let vis: DocumentVisibilityState = 'visible'
    const timers: Array<{ fn: () => void; ms: number }> = []
    const onChange = vi.fn()
    let fetches = 0
    const poller = new UpdatePoller({
      fetchHtml: async () => {
        fetches++
        if (fetches === 2) throw new Error('network')
        return fetches === 1 ? HTML_A : HTML_B
      },
      getCurrent: () => parseBundleNames(HTML_A),
      onChange,
      intervalMs: 1000,
      visibility: () => vis,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
      clearTimeout: () => {},
      addVisibilityListener: () => () => {},
    })
    poller.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled() // same bundles
    expect(timers.at(-1)?.ms).toBe(1000)

    // Failure → backoff
    timers.pop()!.fn()
    await Promise.resolve()
    await Promise.resolve()
    expect(timers.at(-1)?.ms).toBe(UPDATE_BACKOFF_START_MS)

    // Success with different HTML → update available
    timers.pop()!.fn()
    await Promise.resolve()
    await Promise.resolve()
    expect(onChange).toHaveBeenCalledWith(true)
    expect(poller.updateAvailable).toBe(true)

    // Hidden clears schedule
    vis = 'hidden'
    const n = timers.length
    await poller.checkNow()
    expect(timers.length).toBe(n) // no new arm while hidden

    poller.stop()
  })
})
