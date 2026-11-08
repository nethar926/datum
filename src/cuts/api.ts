/**
 * CUT API surface for the FE: re-exports the Physicist m3-cuts entry from `@acoustics`
 * plus thin FE helpers (scenario id, disposable handle). Grams are driven by
 * `renderCut` inside the sim worker (see engine/host.ts) — not by a FE stub.
 */
export {
  listCutSeeds,
  getCutSeed,
  getCutStarterPack,
  renderCut,
  scenarioFromCut,
  CUT_MODEL_VERSION,
  type CutSeed,
  type CutStarterPack,
  type CutClassifyingLine,
  type CutLineBehaviour,
  type CutRichness,
  type CutSession,
  type OperatingMode,
} from '@acoustics'

import { getCutSeed, type CutSeed } from '@acoustics'

/**
 * Deep clone of a CutSeed for UI draft edits. Starter-pack seeds from getCutSeed/listCutSeeds
 * are deep-frozen by Acoustics — mutate a clone (or a spread copy of the fields you edit), never the catalog object.
 */
export function cloneCutSeed(cut: CutSeed): CutSeed {
  return structuredClone(cut)
}


/** Scenario id the host recognises as a teaching cut (`cut:<id>`). */
export const cutScenarioId = (cutId: string) => `cut:${cutId}`
export const parseCutScenarioId = (scenarioId: string): string | null =>
  scenarioId.startsWith('cut:') ? scenarioId.slice(4) : null

/**
 * Main-thread handle: metadata + lifecycle for the UI. The worker calls `renderCut`
 * to own the AcousticEngine / LOFAR drain; this handle must not construct a second engine.
 */
export interface FeCutSession {
  readonly cut: CutSeed
  readonly scenarioId: string
  readonly disposed: boolean
  dispose(): void
}

export function openCutHandle(cutId: string): FeCutSession {
  const cut = getCutSeed(cutId)
  if (!cut) throw new Error(`Unknown cut ${cutId}`)
  const handle: FeCutSession = {
    cut,
    scenarioId: cutScenarioId(cut.id),
    disposed: false,
    dispose() { (handle as { disposed: boolean }).disposed = true },
  }
  return handle
}

/** Behaviour tag → short card / reveal wording (no slip). */
export function behaviourWording(b: string): string {
  switch (b) {
    case 'stable':
    case 'stable-ac':
      return 'AC, steady'
    case 'unstable':
    case 'wander-dc':
      return 'DC, wanders'
    case 'ramping':
    case 'ramp':
      return 'ramps'
    case 'kneeing':
      return 'engine family slows together'
    case 'skipped':
      return 'skipped'
    case 'harmonics-only':
      return 'harmonics-only'
    case 'broadband':
      return 'broadband'
    case 'tracks-engine':
      return 'EDA tracks the engine'
    case 'on-with-engine':
      return 'EDA on/off with engine'
    default:
      return b
  }
}

/** Giveaway / identifying line label, including integer harmonics as `CFR ×3`. */
export function identifyingLineText(line: {
  lineFamily: string
  label: string
  wasHarmonic: boolean
  harmonicOf?: string
  n?: number
  nominalHz?: number
}): string {
  if (line.n != null && line.n > 1) {
    return `${line.harmonicOf ?? line.lineFamily} ×${line.n}`
  }
  return `${line.label}${line.nominalHz != null ? ` · ${line.nominalHz.toFixed(1)} Hz` : ''}`
}

