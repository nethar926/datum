/**
 * CUTTOOLS: tool availability + Live/Cuts arm-state isolation.
 *
 * Choice (documented for Lead/Wilson): tool arm state is **separate per tab**.
 * Live and Cuts each keep their own armed tool, HARM/DOP/LM placements, CURLOCK
 * locks, and BRG arm. Shared display prefs (contrast, HORZ, palette, wheel,
 * listen FOCUS width) stay shared — they are not "armed tools or cursors".
 * Leaving Cuts (abandon) or seeking/starting a cut clears the Cuts arm only;
 * Live arm is untouched. Switching Live ↔ Cuts never copies arm state across.
 */
import { EMPTY_LOCKS, type CursorLocks } from '../gram/cursorLock'
import type { LloydState } from '../gram/LloydsOverlay'
import { ARM_IDLE, type BearingArm } from '../tactical/bearingArm'

export type CutToolId =
  | 'fix'
  | 'brg'
  | 'dop'
  | 'harm'
  | 'lm'
  | 'horz'
  | 'con'
  | 'listen'
  | 'difarWheel'

export interface CutToolAvailability {
  id: CutToolId
  /** Shown in the Cuts toolbar (never hidden when in the matrix). */
  enabled: boolean
  /** When disabled, shown as the button title / aria-description. */
  reason?: string
}

export type BuoyKindLike = 'omni' | 'difar' | 'dicass' | 'vlad' | 'bt' | string

export interface CutToolContext {
  /** A cut session is open (player, not picker). */
  hasSession: boolean
  /** Number of tactical buoys in the cut scenario (renderCut lays one). */
  buoyCount: number
  /** Primary buoy kind; cuts use DIFAR today. */
  buoyKind: BuoyKindLike | null
  /** Tactical picture posted (aircraft + buoy geometry). */
  hasTactical: boolean
  /** Gram mode is DIFAR (bearing-as-hue); wheel only applies then. */
  difarMode: boolean
}

export const FIX_DISABLED_REASON =
  'Cut has a single buoy — cross-FIX needs ≥2 fresh DIFAR bearings from separated buoys'
export const BRG_OMNI_REASON = 'BRG needs DIFAR bearing bins (omni cut has none)'
export const NO_SESSION_REASON = 'Open a cut to use tools'
export const NO_GEOM_REASON = 'Cut geometry not ready (buoy / aircraft tactical)'
export const WHEEL_LOFAR_REASON = 'DIFAR wheel applies in DIFAR gram mode'

/** Default Lloyd panel state (matches App live default). */
export const DEFAULT_LM: LloydState = {
  basis: 'cpaFit', k: 40, tCpaS: 0, tauS: 300, manRangeM: 2000, manSpeedMps: 4,
}

/** Armable / cursor state that must not leak across Live ↔ Cuts. */
export interface ToolArmState {
  tool: 'select' | 'dop' | 'lm' | 'harm'
  locks: CursorLocks
  harmF0: number | null
  harmK: number | null
  harmFam: string | null
  harmProbe: number | null
  harmProbeOn: boolean
  lm: LloydState
  brgArm: BearingArm
  vernierPick: boolean
}

export function emptyToolArm(): ToolArmState {
  return {
    tool: 'select',
    locks: { ...EMPTY_LOCKS },
    harmF0: null,
    harmK: null,
    harmFam: null,
    harmProbe: null,
    harmProbeOn: false,
    lm: { ...DEFAULT_LM },
    brgArm: ARM_IDLE,
    vernierPick: false,
  }
}

/** Clear arm/cursors for dispose on finish / seek / abandon (DISPOSE). */
export function clearToolArm(_prev?: ToolArmState): ToolArmState {
  return emptyToolArm()
}

/**
 * Availability matrix for the Cuts toolbar.
 * Disabled tools stay visible with a reason — never hidden.
 */
export function cutToolAvailability(ctx: CutToolContext): CutToolAvailability[] {
  if (!ctx.hasSession) {
    return (['fix', 'brg', 'dop', 'harm', 'lm', 'horz', 'con', 'listen', 'difarWheel'] as const)
      .map((id) => ({ id, enabled: false, reason: NO_SESSION_REASON }))
  }

  const difar = ctx.buoyKind === 'difar' || ctx.buoyKind === 'dicass'
  const geomOk = ctx.hasTactical && ctx.buoyCount >= 1

  const fixEnabled = false // single-buoy cut cannot cross-fix
  const brgEnabled = difar
  const dopEnabled = geomOk
  const harmEnabled = true
  const lmEnabled = geomOk
  const horzEnabled = true
  const conEnabled = true
  const listenEnabled = true
  const wheelEnabled = ctx.difarMode

  return [
    {
      id: 'fix',
      enabled: fixEnabled,
      reason: fixEnabled ? undefined : FIX_DISABLED_REASON,
    },
    {
      id: 'brg',
      enabled: brgEnabled,
      reason: brgEnabled ? undefined : BRG_OMNI_REASON,
    },
    {
      id: 'dop',
      enabled: dopEnabled,
      reason: dopEnabled ? undefined : NO_GEOM_REASON,
    },
    { id: 'harm', enabled: harmEnabled },
    {
      id: 'lm',
      enabled: lmEnabled,
      reason: lmEnabled ? undefined : NO_GEOM_REASON,
    },
    { id: 'horz', enabled: horzEnabled },
    { id: 'con', enabled: conEnabled },
    { id: 'listen', enabled: listenEnabled },
    {
      id: 'difarWheel',
      enabled: wheelEnabled,
      reason: wheelEnabled ? undefined : WHEEL_LOFAR_REASON,
    },
  ]
}

export function availabilityMap(ctx: CutToolContext): Record<CutToolId, CutToolAvailability> {
  const out = {} as Record<CutToolId, CutToolAvailability>
  for (const a of cutToolAvailability(ctx)) out[a.id] = a
  return out
}

/** Pure check: two arm states do not share object identity for locks/lm (isolation invariant). */
export function armsIsolated(a: ToolArmState, b: ToolArmState): boolean {
  return a.locks !== b.locks && a.lm !== b.lm && a.brgArm !== b.brgArm
}
