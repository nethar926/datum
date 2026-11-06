import type { GramConfig, GramFilter } from '../engine/contract'
import { fmtHz } from './res'

/**
 * Gram continuity on RES / filter / vernier changes (m3-fe-gram-handoff). Pure state machine, no I/O:
 *
 *  idle ──begin──▶ pending ──rows ≥ fillRows on every stream, or timeout──▶ (promote) idle
 *                    │  ▲
 *                    └──┘ begin again mid-handoff: drop the PENDING set (never the displayed one), subscribe fresh
 *
 * The displayed set keeps scrolling while the pending set fills. `begin` returning to the displayed settings just
 * drops the pending set. Events are returned to the caller (SimClient), which turns them into worker messages.
 */
export interface HandoffTarget { res: number; filter: GramFilter; vernierHz?: number }
export type HandoffEvent =
  | { type: 'subscribe'; gen: number; target: HandoffTarget }
  | { type: 'drop'; gen: number }
  | { type: 'promote'; gen: number; configs: GramConfig[] }

/** New rows every pending stream needs before the swap (the old history fills the rest of the window). */
export const HANDOFF_FILL_ROWS = 8
/** Wall-clock fallback: swap anyway after this long so a slow RES (rows every 8 s) or a paused sim can't hang. */
export const HANDOFF_TIMEOUT_MS = 3000
/** No pendingStreams answer within this long (worker error): give up and drop the request. */
export const HANDOFF_ANNOUNCE_MS = 5000

export const sameTarget = (a: HandoffTarget, b: HandoffTarget): boolean =>
  a.res === b.res && a.filter === b.filter && (a.vernierHz ?? null) === (b.vernierHz ?? null)

export class HandoffMachine {
  phase: 'idle' | 'pending' = 'idle'
  /** Generation of the current pending request (monotonic; 0 = none yet). */
  gen = 0
  from?: HandoffTarget
  to?: HandoffTarget
  startedAt = 0
  /** Pending configs once the worker announced them (undefined = still subscribing). */
  configs?: GramConfig[]
  private ids = new Map<number, number>()
  private counts = new Int32Array(0)
  private minRows = 0
  /** Every subscribe not yet dropped or promoted (should never exceed 1). Test hook for leak checks. */
  readonly live = new Set<number>()

  constructor(readonly fillRows = HANDOFF_FILL_ROWS, readonly timeoutMs = HANDOFF_TIMEOUT_MS, readonly announceMs = HANDOFF_ANNOUNCE_MS) {}

  /** A settings change. `displayed` = settings of the set on screen now. */
  begin(displayed: HandoffTarget, target: HandoffTarget, now: number): HandoffEvent[] {
    const ev: HandoffEvent[] = []
    if (this.phase === 'pending') { ev.push({ type: 'drop', gen: this.gen }); this.live.delete(this.gen); this.reset() }
    if (sameTarget(displayed, target)) return ev // back to what is on screen: nothing to fill
    this.gen++
    this.phase = 'pending'; this.from = { ...displayed }; this.to = { ...target }; this.startedAt = now
    this.live.add(this.gen)
    ev.push({ type: 'subscribe', gen: this.gen, target: { ...target } })
    return ev
  }

  /** Worker announced the pending streams for `gen`. Returns false for a stale (superseded) generation. */
  announce(gen: number, configs: GramConfig[]): boolean {
    if (this.phase !== 'pending' || gen !== this.gen) return false
    this.configs = configs
    this.ids.clear(); configs.forEach((c, i) => this.ids.set(c.streamId, i))
    this.counts = new Int32Array(configs.length); this.minRows = 0
    return true
  }

  /** Index of a pending stream id (or -1), for routing rows. */
  indexOf(streamId: number): number { return this.ids.get(streamId) ?? -1 }

  /** One row arrived for streamId (no-op for anything that is not a pending stream). */
  row(streamId: number): void {
    const i = this.ids.get(streamId)
    if (i === undefined || this.phase !== 'pending') return
    this.counts[i]++
    let m = this.counts[0]
    for (let k = 1; k < this.counts.length; k++) if (this.counts[k] < m) m = this.counts[k]
    this.minRows = m
  }

  rows(): number { return this.minRows }
  /** 0..1 fill towards the threshold. */
  progress(): number { return this.phase === 'pending' && this.configs ? Math.min(1, this.minRows / Math.max(1, this.fillRows)) : 0 }
  ready(): boolean { return this.phase === 'pending' && !!this.configs && this.minRows >= this.fillRows }

  /** Per frame: promote when filled or timed out; drop when the worker never answered. Allocation-free when idle. */
  tick(now: number): HandoffEvent | null {
    if (this.phase !== 'pending') return null
    const age = now - this.startedAt
    if (this.configs && (this.minRows >= this.fillRows || age >= this.timeoutMs)) {
      const e: HandoffEvent = { type: 'promote', gen: this.gen, configs: this.configs }
      this.live.delete(this.gen); this.reset(); return e
    }
    if (!this.configs && age >= this.announceMs) { const e: HandoffEvent = { type: 'drop', gen: this.gen }; this.live.delete(this.gen); this.reset(); return e }
    return null
  }

  /** Sim restart: forget everything (the worker that held the streams is gone). */
  cancel(): void { this.live.clear(); this.reset() }

  private reset(): void {
    this.phase = 'idle'; this.from = undefined; this.to = undefined; this.configs = undefined
    this.ids.clear(); this.counts = new Int32Array(0); this.minRows = 0
  }
}

/** Indicator text, e.g. "RES 2 → 1", "NB → BB", "VERNIER → 50.00 Hz", joined; then FILLING n%. */
export function handoffLabel(from: HandoffTarget, to: HandoffTarget, progress: number): string {
  const parts: string[] = []
  if (from.res !== to.res) parts.push(`RES ${from.res} → ${to.res}`)
  if (from.filter !== to.filter) parts.push(`${from.filter} → ${to.filter}`)
  if ((from.vernierHz ?? null) !== (to.vernierHz ?? null)) parts.push(to.vernierHz === undefined ? 'VERNIER OFF' : `VERNIER → ${fmtHz(to.vernierHz)} Hz`)
  return `${parts.join('  ') || `RES ${to.res}`}  FILLING ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`
}
