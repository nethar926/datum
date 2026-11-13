import { DEFAULT_COUNT, clampCount, gesturePlacement, type DropKind, type DropPattern, type Placement, type Pt } from './drop'

/**
 * Field modes. PREPLAN: the scenario's preplanned field, nothing laid automatically. AUTO: the trainer lays the
 * planner's AUTO pattern on entry and again when a new fix falls outside the field. MANUAL: the operator lays the
 * field; the drop palette stays armed after each drop for rapid repeats. Manual drops work in every mode.
 */
export type FieldMode = 'preplan' | 'auto' | 'manual'
export const FIELD_MODES: readonly FieldMode[] = ['preplan', 'auto', 'manual']
export const FIELD_MODE_LABEL: Record<FieldMode, string> = { preplan: 'PREPLAN', auto: 'AUTO', manual: 'MANUAL' }
/** Field cap (the engine bench budget is 32 buoys per 0.25 s frame; validateScenario allows 128). */
export const MAX_BUOYS = 32

export type DropPhase = 'idle' | 'armed' | 'placing' | 'preview'
export interface DropState {
  buoyKind: DropKind; mode: FieldMode; phase: DropPhase; pattern: DropPattern | null; count: number
  placement: Placement | null; start: Pt | null
}
export type DropAction =
  | { type: 'mode'; mode: FieldMode }
  | { type: 'kind'; kind: DropKind }
  | { type: 'arm'; pattern: DropPattern }
  | { type: 'disarm' }
  | { type: 'press'; at: Pt }
  | { type: 'drag'; at: Pt }
  | { type: 'release' }
  | { type: 'count'; delta: number }
  | { type: 'confirm' }
  | { type: 'cancel' }

export const initialDrop = (mode: FieldMode = 'preplan'): DropState => ({ buoyKind: 'difar', mode, phase: 'idle', pattern: null, count: 1, placement: null, start: null })

export function dropReducer(s: DropState, a: DropAction): DropState {
  switch (a.type) {
    case 'kind':
      // ACTIVE has no ping/echo model yet: reject unsupported values even if dispatched directly.
      return (a.kind === 'omni' || a.kind === 'difar' || a.kind === 'bt') && a.kind !== s.buoyKind ? { ...s, buoyKind: a.kind } : s
    case 'mode': return a.mode === s.mode ? s : { ...s, mode: a.mode }
    case 'arm':
      // Tapping the armed pattern again puts it away; another pattern re-arms (any pending ghost is discarded).
      if (s.pattern === a.pattern && s.phase === 'armed') return { ...s, phase: 'idle', pattern: null, placement: null, start: null }
      return { ...s, phase: 'armed', pattern: a.pattern, count: DEFAULT_COUNT[a.pattern], placement: null, start: null }
    case 'disarm': return { ...s, phase: 'idle', pattern: null, placement: null, start: null }
    case 'press':
      if (!s.pattern || s.phase === 'idle') return s
      return { ...s, phase: 'placing', start: a.at, placement: gesturePlacement(s.pattern, a.at, null) }
    case 'drag':
      if (s.phase !== 'placing' || !s.pattern || !s.start) return s
      return { ...s, placement: gesturePlacement(s.pattern, s.start, a.at) }
    case 'release': return s.phase === 'placing' ? { ...s, phase: 'preview', start: null } : s
    case 'count': {
      if (!s.pattern) return s
      const count = clampCount(s.pattern, s.count + a.delta)
      return count === s.count ? s : { ...s, count }
    }
    case 'confirm':
      if (s.phase !== 'preview') return s
      // MANUAL keeps the pattern armed for the next drop; PREPLAN / AUTO put the palette away.
      return s.mode === 'manual' ? { ...s, phase: 'armed', placement: null, start: null } : { ...s, phase: 'idle', pattern: null, placement: null, start: null }
    case 'cancel':
      if (s.phase === 'preview' || s.phase === 'placing') return { ...s, phase: 'armed', placement: null, start: null }
      return { ...s, phase: 'idle', pattern: null, placement: null, start: null }
  }
}

/** The plot routes presses to the drop tool (not the manual bearing cursors) while a pattern is armed. */
export const dropCapturesPlot = (s: DropState): boolean => s.phase !== 'idle' && s.pattern !== null

/** Status line shown under the palette, so the tool state is always visible. */
export function dropHint(s: DropState, full: boolean): string {
  if (full) return 'Field full'
  if (!s.pattern) return s.mode === 'auto' ? 'AUTO lays on new fixes · pick a pattern to drop manually' : 'Pick a pattern to drop'
  const name = s.pattern.toUpperCase()
  if (s.phase === 'armed') return s.pattern === 'single' ? 'Tap the plot to place one buoy' : `Tap to place ${name} · drag to orient and size`
  if (s.phase === 'placing') return s.placement?.dragged ? `Sizing ${name}…` : `Placing ${name}…`
  return 'Confirm to drop · tap again to move'
}

/** Phone-width version of {@link dropHint}: same states, copy short enough for a chip beside the drop tools. */
export function dropHintShort(s: DropState, full: boolean): string {
  if (full) return 'Field full'
  if (!s.pattern) return s.mode === 'auto' ? 'AUTO · or pick one' : 'Pick a pattern'
  const name = s.pattern.toUpperCase()
  if (s.phase === 'armed') return s.pattern === 'single' ? 'Tap to place' : `Tap to place ${name}`
  if (s.phase === 'placing') return s.placement?.dragged ? 'Sizing…' : 'Placing…'
  return 'Confirm or move'
}

/** AUTO re-lay rules: a fix farther than AUTO_GAP_M from every live buoy, at most once per AUTO_COOLDOWN_S. */
export const AUTO_GAP_M = 4000, AUTO_COOLDOWN_S = 300
export interface AutoMemo { lastLayS: number | null }
export function autoShouldLay(memo: AutoMemo, simT: number, fix: Pt | null, live: readonly Pt[], buoyCount: number, entering: boolean): boolean {
  if (buoyCount >= MAX_BUOYS) return false
  if (entering) return true
  if (!fix || (memo.lastLayS !== null && simT - memo.lastLayS < AUTO_COOLDOWN_S)) return false
  for (const b of live) if (Math.hypot(b.x - fix.x, b.y - fix.y) <= AUTO_GAP_M) return false
  return true
}
