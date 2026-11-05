import type { LogEvent } from '@acoustics'

/**
 * Operator log (contract v1.1 LogEvent). In-memory, bounded, append-only; the M4 panel and export read from it.
 * subscribe/size fit useSyncExternalStore.
 */
export class OperatorLog {
  private events: LogEvent[] = []
  private listeners = new Set<() => void>()
  constructor(readonly max = 5000) {}
  add(e: Omit<LogEvent, 'v' | 'type'>): LogEvent {
    const ev: LogEvent = { v: 1.1, type: 'log', ...e }
    this.events.push(ev)
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max)
    for (const l of this.listeners) l()
    return ev
  }
  all(): readonly LogEvent[] { return this.events }
  size = (): number => this.events.length
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  /** JSON Lines export, one event per line. */
  toJsonl(): string { return this.events.map((e) => JSON.stringify(e)).join('\n') }
}
