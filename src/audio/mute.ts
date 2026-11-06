/**
 * Listen mute state machine. Always boots muted (user gesture required on iOS).
 * Auto-gates off when not on Live / an open Cuts player, when the document is hidden,
 * or when the selected buoy is detuned / dead / error. Pure helpers — the engine applies the transitions.
 */

export type MuteReason = 'boot' | 'user' | 'cuts' | 'hidden' | 'channel'

export type MutePhase = 'muted' | 'starting' | 'running' | 'silenced' | 'teardown'

export interface GateInput {
  /** Operator wants listen on (session toggle; always false at boot). */
  userOn: boolean
  /** Live tab or open Cuts player (Settings / Plot-only / Cuts picker stay gated). */
  liveTab: boolean
  /** document.visibilityState === 'visible'. */
  visible: boolean
  /** Selected buoy is working or integrating (not detuned/dead/error). */
  channelOk: boolean
}

export interface GateResult {
  /** True when audio nodes should be producing sound. */
  gated: boolean
  reasons: MuteReason[]
}

/** Decide whether listen is allowed right now. Boot mute is applied by the UI (userOn starts false). */
export function gateListen(i: GateInput): GateResult {
  const reasons: MuteReason[] = []
  if (!i.userOn) reasons.push('user')
  if (!i.liveTab) reasons.push('cuts')
  if (!i.visible) reasons.push('hidden')
  if (!i.channelOk) reasons.push('channel')
  return { gated: reasons.length === 0, reasons }
}

export function channelAllowsListen(health: string | null | undefined): boolean {
  return health === 'working' || health === 'integrating'
}

/**
 * Phase transition. `want` is the gated desire; `haveCtx` whether an AudioContext exists.
 * Teardown is requested when moving from running/starting → muted.
 */
export function nextMutePhase(cur: MutePhase, want: boolean, haveCtx: boolean): MutePhase {
  if (!want) {
    if (cur === 'running' || cur === 'starting' || cur === 'silenced') return 'teardown'
    if (cur === 'teardown') return haveCtx ? 'teardown' : 'muted'
    return 'muted'
  }
  if (cur === 'muted' || cur === 'teardown') return 'starting'
  if (cur === 'starting') return haveCtx ? 'running' : 'starting'
  if (cur === 'silenced') return 'running'
  return 'running'
}

/** After teardown completes, land in muted (user off) or silenced (gated off but user still wants on). */
export function afterTeardown(userOn: boolean, gated: boolean): MutePhase {
  if (!userOn) return 'muted'
  if (!gated) return 'silenced'
  return 'starting'
}
