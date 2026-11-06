/**
 * FE-local buoy detune / tune and RX-channel pool.
 * Engine RF channels stay as assigned; this module owns status colours, the integrating delay after a
 * manual drop, DETUNE/TUNE, and lowest-free channel picks. Session-only (no persistence).
 */
import { MAX_BUOYS } from './fieldMode'

/** Simultaneous tuned feeds (= field cap). */
export const MAX_CHANNELS = MAX_BUOYS
/** Wall-clock integrating delay after a manual drop / TUNE before the buoy feeds (white). */
export const INTEGRATE_MS = 2500

/**
 * Operator status for a buoy mark / channel chip.
 * - working (white): feeding
 * - integrating (green): just dropped / just tuned; progress ring until live
 * - detuned (green): operator detuned; channel freed, gram shows DETUNED
 * - dead (red): engine scuttled / life expired (or FE test hook)
 * - error (yellow): FE/test hook until the Physicist exposes a fault path
 */
export type BuoyHealth = 'working' | 'integrating' | 'detuned' | 'dead' | 'error'

export interface BuoyFeState {
  buoyId: number
  health: BuoyHealth
  /** FE RX channel while tuned or integrating; null when detuned (or never assigned). */
  channel: number | null
  /** performance.now()-style deadline while integrating; null otherwise. */
  integrateUntil: number | null
}

/** HIG-friendly tints that read on the dark plot (system green / red / yellow, near-white). */
export const BUOY_STATUS_COLOR: Record<BuoyHealth, string> = {
  working: '#f5f5f7',
  integrating: '#30d158',
  detuned: '#30d158',
  dead: '#ff453a',
  error: '#ffd60a',
}

export const BUOY_STATUS_LABEL: Record<BuoyHealth, string> = {
  working: 'Working',
  integrating: 'Integrating',
  detuned: 'Detuned',
  dead: 'Dead',
  error: 'Error',
}

/** Lowest free channel in 1..max, or null when the pool is full. */
export function lowestFreeChannel(used: ReadonlySet<number>, max = MAX_CHANNELS): number | null {
  for (let ch = 1; ch <= max; ch++) if (!used.has(ch)) return ch
  return null
}

/** Channels currently held by tuned / integrating / dead-with-channel / error rows. Detuned frees its slot. */
export function usedChannels(states: Iterable<BuoyFeState>): Set<number> {
  const s = new Set<number>()
  for (const b of states) {
    if (b.health === 'detuned') continue
    if (b.channel != null) s.add(b.channel)
  }
  return s
}

/** Reserve `n` lowest-free channels, or null when the pool cannot cover the ask (NO CH). */
export function reserveChannels(n: number, used: ReadonlySet<number>, max = MAX_CHANNELS): number[] | null {
  if (n < 0 || !Number.isInteger(n)) return null
  if (n === 0) return []
  const u = new Set(used)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const ch = lowestFreeChannel(u, max)
    if (ch == null) return null
    out.push(ch)
    u.add(ch)
  }
  return out
}

/** Paint priority: error > dead > detuned/integrating > working. Engine dead upgrades a live FE row. */
export function paintHealth(fe: BuoyFeState | undefined, engineState: 'falling' | 'live' | 'dead' | undefined): BuoyHealth {
  if (fe?.health === 'error') return 'error'
  if (engineState === 'dead' || fe?.health === 'dead') return 'dead'
  if (fe?.health === 'detuned') return 'detuned'
  if (fe?.health === 'integrating' || engineState === 'falling') return 'integrating'
  return fe?.health ?? 'working'
}

export type DetuneResult = { ok: true; channel: null } | { ok: false; reason: 'missing' | 'bad-state' }
export type TuneResult =
  | { ok: true; channel: number }
  | { ok: false; reason: 'missing' | 'bad-state' | 'NO CH' }

/**
 * External store for buoy FE status. App / DropBar / plot subscribe; pure helpers above stay unit-tested.
 * keyed by buoy id (engine `TacticalBuoy.id`, which equals RF channel today).
 */
export class DetuneStore {
  private byId = new Map<number, BuoyFeState>()
  private listeners = new Set<() => void>()
  private snap = 0
  /** Last NO CH reason for a short-lived toast; cleared by the UI after display. */
  noCh: string | null = null
  constructor(readonly maxChannels = MAX_CHANNELS) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = (): number => this.snap
  get = (buoyId: number): BuoyFeState | undefined => this.byId.get(buoyId)
  all = (): BuoyFeState[] => [...this.byId.values()]
  used = (): Set<number> => usedChannels(this.byId.values()) /* max applied at reserve */

  private emit(): void {
    this.snap++
    for (const l of this.listeners) l()
  }

  /** Seed / refresh from the tactical picture. New buoys default to working (scenario) unless flagged. */
  syncTactical(
    buoys: readonly { id: number; channel: number; state: 'falling' | 'live' | 'dead' }[],
    opts?: { integratingIds?: ReadonlySet<number>; now?: number },
  ): void {
    const seen = new Set<number>()
    let changed = false
    const now = opts?.now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const integratingIds = opts?.integratingIds
    for (const b of buoys) {
      seen.add(b.id)
      const cur = this.byId.get(b.id)
      if (!cur) {
        if (integratingIds?.has(b.id) || b.state === 'falling') {
          this.byId.set(b.id, {
            buoyId: b.id,
            health: 'integrating',
            channel: b.channel,
            integrateUntil: now + INTEGRATE_MS,
          })
        } else if (b.state === 'dead') {
          this.byId.set(b.id, { buoyId: b.id, health: 'dead', channel: b.channel, integrateUntil: null })
        } else {
          this.byId.set(b.id, { buoyId: b.id, health: 'working', channel: b.channel, integrateUntil: null })
        }
        changed = true
        continue
      }
      // Engine dead wins over working/integrating (not over explicit FE error/detuned — detuned stays until TUNE).
      if (b.state === 'dead' && cur.health !== 'dead' && cur.health !== 'error') {
        this.byId.set(b.id, { ...cur, health: 'dead', integrateUntil: null })
        changed = true
      }
    }
    for (const id of [...this.byId.keys()]) {
      if (!seen.has(id)) { this.byId.delete(id); changed = true }
    }
    if (changed) this.emit()
  }

  /**
   * Mark the buoys just returned by a manual/auto drop as integrating on the channels the host laid.
   * Call after the tactical picture includes them (ids === channels today).
   */
  noteDropped(channels: readonly number[], now = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    let changed = false
    for (const ch of channels) {
      const cur = this.byId.get(ch)
      const next: BuoyFeState = {
        buoyId: ch,
        health: 'integrating',
        channel: ch,
        integrateUntil: now + INTEGRATE_MS,
      }
      if (!cur || cur.health !== next.health || cur.channel !== next.channel || cur.integrateUntil !== next.integrateUntil) {
        this.byId.set(ch, next)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  /** Advance integrating → working when the delay elapses. Returns true if anything flipped. */
  tick(now = typeof performance !== 'undefined' ? performance.now() : Date.now()): boolean {
    let changed = false
    for (const [id, s] of this.byId) {
      if (s.health !== 'integrating' || s.integrateUntil == null) continue
      if (now < s.integrateUntil) continue
      this.byId.set(id, { ...s, health: 'working', integrateUntil: null })
      changed = true
    }
    if (changed) this.emit()
    return changed
  }

  /** Integrating progress 0..1 for a buoy, or null when not integrating. */
  progress(buoyId: number, now = typeof performance !== 'undefined' ? performance.now() : Date.now()): number | null {
    const s = this.byId.get(buoyId)
    if (!s || s.health !== 'integrating' || s.integrateUntil == null) return null
    const start = s.integrateUntil - INTEGRATE_MS
    return Math.max(0, Math.min(1, (now - start) / INTEGRATE_MS))
  }

  detune(buoyId: number): DetuneResult {
    const s = this.byId.get(buoyId)
    if (!s) return { ok: false, reason: 'missing' }
    if (s.health !== 'working' && s.health !== 'integrating') return { ok: false, reason: 'bad-state' }
    this.byId.set(buoyId, { ...s, health: 'detuned', channel: null, integrateUntil: null })
    this.emit()
    return { ok: true, channel: null }
  }

  tune(buoyId: number, now = typeof performance !== 'undefined' ? performance.now() : Date.now()): TuneResult {
    const s = this.byId.get(buoyId)
    if (!s) return { ok: false, reason: 'missing' }
    if (s.health !== 'detuned') return { ok: false, reason: 'bad-state' }
    const ch = lowestFreeChannel(this.used(), this.maxChannels)
    if (ch == null) {
      this.noCh = 'NO CH'
      this.emit()
      return { ok: false, reason: 'NO CH' }
    }
    this.byId.set(buoyId, {
      buoyId,
      health: 'integrating',
      channel: ch,
      integrateUntil: now + INTEGRATE_MS,
    })
    this.noCh = null
    this.emit()
    return { ok: true, channel: ch }
  }

  /** Pick channels for an upcoming drop of `n` buoys, or set NO CH and return null. */
  allocateForDrop(n: number): number[] | null {
    const chs = reserveChannels(n, this.used(), this.maxChannels)
    if (!chs) {
      this.noCh = 'NO CH'
      this.emit()
      return null
    }
    this.noCh = null
    return chs
  }

  clearNoCh(): void {
    if (this.noCh == null) return
    this.noCh = null
    this.emit()
  }

  /**
   * Test/dev hook for red (dead) and yellow (error) until the engine exposes buoy health/faults.
   * `error` is FE-only; `dead` mirrors what the engine already paints when life expires.
   */
  setHealth(buoyId: number, health: 'dead' | 'error' | 'working'): boolean {
    const s = this.byId.get(buoyId)
    if (!s) return false
    if (health === 'working') {
      const ch = s.channel ?? lowestFreeChannel(this.used(), this.maxChannels)
      if (ch == null) { this.noCh = 'NO CH'; this.emit(); return false }
      this.byId.set(buoyId, { ...s, health: 'working', channel: ch, integrateUntil: null })
    } else if (health === 'dead') {
      this.byId.set(buoyId, { ...s, health: 'dead', integrateUntil: null })
    } else {
      this.byId.set(buoyId, { ...s, health: 'error', integrateUntil: null })
    }
    this.emit()
    return true
  }

  /** Reset session state (new scenario). */
  reset(): void {
    this.byId.clear()
    this.noCh = null
    this.emit()
  }
}
