import { planDrop, type DropPlan } from './drop'
import { dropReducer, initialDrop, type DropAction, type DropState, type FieldMode } from './fieldMode'

/**
 * External store for the drop tool. The tactical plot reads `ghost` from its own rAF loop and the drop bar
 * subscribes, so a drag re-renders only the bar (never the whole app) and the plot repaints at display rate.
 */
export class DropController {
  state: DropState
  /** Ghost preview of the current placement (null when nothing is placed). Replaced, never mutated. */
  ghost: DropPlan | null = null
  /** Bumped on every ghost change (the plot redraws when it differs). */
  version = 0
  private drops = 0
  private listeners = new Set<() => void>()
  constructor(mode: FieldMode = 'preplan') { this.state = initialDrop(mode) }

  dispatch = (a: DropAction): void => {
    const prev = this.state, next = dropReducer(prev, a)
    if (next === prev) return
    this.state = next
    if (next.placement !== prev.placement || next.count !== prev.count || next.buoyKind !== prev.buoyKind) {
      this.ghost = next.placement ? planDrop(next.placement, next.count, this.drops, next.buoyKind) : null
      this.version++
    }
    for (const l of this.listeners) l()
  }
  /** Called after a confirmed drop so the next pattern's suggested RF channels differ. */
  committed(): void { this.drops++ }
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getState = (): DropState => this.state
}
