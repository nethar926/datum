/**
 * Detect a newly deployed build by comparing hashed /assets/ bundle filenames
 * in the live document vs a fresh fetch of index.html (cache: 'no-store').
 * Pure parse/compare helpers are unit-tested; the poller backs off on failure
 * and pauses while the document is hidden.
 */

const ASSET_RE = /(?:src|href)=["']([^"']*\/assets\/[^"'?#]+\.(?:js|css))["']/gi
const ASSET_PATH_RE = /\/assets\/[^/?#]+\.(?:js|css)/i

/** Basename of an asset URL/path (e.g. index-AbCdEf.js). */
export function assetBasename(url: string): string {
  const path = url.split('?')[0]!.split('#')[0]!
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/** Collect hashed asset basenames mentioned in an HTML document string. */
export function parseBundleNames(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  ASSET_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ASSET_RE.exec(html)) !== null) {
    const base = assetBasename(m[1]!)
    if (!base || seen.has(base)) continue
    seen.add(base)
    out.push(base)
  }
  return out
}

/** Asset basenames currently loaded by the page (script + stylesheet). */
export function currentBundleNames(doc: ParentNode = document): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const nodes = doc.querySelectorAll('script[src], link[rel="stylesheet"][href]')
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!
    const url = el.getAttribute('src') || el.getAttribute('href') || ''
    if (!ASSET_PATH_RE.test(url)) continue
    const base = assetBasename(url)
    if (!base || seen.has(base)) continue
    seen.add(base)
    out.push(base)
  }
  return out
}

/**
 * True when the remote HTML names a different asset set than `current`
 * (any added or removed basename). Empty remote parse → false (don't false-alarm).
 */
export function bundlesDiffer(current: readonly string[], remoteHtml: string): boolean {
  const remote = parseBundleNames(remoteHtml)
  if (remote.length === 0) return false
  const cur = new Set(current)
  const rem = new Set(remote)
  if (cur.size !== rem.size) return true
  for (const n of rem) if (!cur.has(n)) return true
  return false
}

export const UPDATE_POLL_MS = 5 * 60 * 1000
export const UPDATE_BACKOFF_START_MS = 30_000
export const UPDATE_BACKOFF_MAX_MS = 10 * 60 * 1000

export type UpdatePollerDeps = {
  /** Fetch index HTML with cache bypass. */
  fetchHtml: () => Promise<string>
  /** Currently loaded asset basenames. */
  getCurrent: () => string[]
  /** Called when availability flips. */
  onChange: (available: boolean) => void
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (id: unknown) => void
  visibility?: () => DocumentVisibilityState
  addVisibilityListener?: (fn: () => void) => () => void
  intervalMs?: number
}

/**
 * Poll for a new deploy. Stops while hidden; checks on visibility→visible;
 * exponential backoff after failures; resets interval after success.
 */
export class UpdatePoller {
  private timer: unknown = null
  private stopped = true
  private available = false
  private backoff = UPDATE_BACKOFF_START_MS
  private readonly intervalMs: number
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown
  private readonly clearTimeoutFn: (id: unknown) => void
  private readonly visibility: () => DocumentVisibilityState
  private removeVis: (() => void) | null = null
  private inFlight = false

  constructor(private readonly deps: UpdatePollerDeps) {
    this.intervalMs = deps.intervalMs ?? UPDATE_POLL_MS
    this.setTimeoutFn = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
    this.clearTimeoutFn = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id as number))
    this.visibility = deps.visibility ?? (() => (typeof document !== 'undefined' ? document.visibilityState : 'visible'))
  }

  get updateAvailable(): boolean { return this.available }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    const add = this.deps.addVisibilityListener ?? defaultVisListener
    this.removeVis = add(() => {
      if (this.stopped) return
      if (this.visibility() === 'visible') void this.checkNow()
      else this.clearTimer()
    })
    if (this.visibility() === 'visible') void this.checkNow()
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
    this.removeVis?.()
    this.removeVis = null
  }

  async checkNow(): Promise<boolean> {
    if (this.stopped || this.inFlight) return this.available
    if (this.visibility() === 'hidden') {
      this.clearTimer()
      return this.available
    }
    this.inFlight = true
    try {
      const html = await this.deps.fetchHtml()
      const next = bundlesDiffer(this.deps.getCurrent(), html)
      this.backoff = UPDATE_BACKOFF_START_MS
      this.setAvailable(next)
      this.arm(this.intervalMs)
      return next
    } catch {
      this.arm(this.backoff)
      this.backoff = Math.min(UPDATE_BACKOFF_MAX_MS, Math.floor(this.backoff * 2))
      return this.available
    } finally {
      this.inFlight = false
    }
  }

  private setAvailable(v: boolean): void {
    if (this.available === v) return
    this.available = v
    this.deps.onChange(v)
  }

  private arm(ms: number): void {
    this.clearTimer()
    if (this.stopped || this.visibility() === 'hidden') return
    this.timer = this.setTimeoutFn(() => { void this.checkNow() }, ms)
  }

  private clearTimer(): void {
    if (this.timer != null) this.clearTimeoutFn(this.timer)
    this.timer = null
  }
}

function defaultVisListener(fn: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', fn)
  return () => document.removeEventListener('visibilitychange', fn)
}
