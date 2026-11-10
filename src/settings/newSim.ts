import type { ScenarioParams } from '../scenarios/acousticsApi'

/** What a Play long press can restart. Cuts are players, not sims: no prompt there. */
export interface RunningSim { scenarioId: string; seed: number; params?: ScenarioParams }
export type NewSimChoice = { kind: 'new'; seed: number } | { kind: 'restart' } | { kind: 'cancel' }
export interface SimStartArgs { seed: number; scenarioId: string; params: ScenarioParams | undefined }

export const canPromptNewSim = (s: RunningSim) => !s.scenarioId.startsWith('cut:')

/** A fresh seed for the prompt, never the running one. */
export function freshSeed(current: number, random: () => number): number {
  for (let i = 0; i < 8; i++) { const s = random() >>> 0; if (s !== current) return s }
  return (current + 1) >>> 0
}

/** client.start args for a choice, or null for Cancel. New keeps the scenario and settings (generated
 * params with the new seed); Restart replays the running seed and settings from T+0. */
export function newSimStartArgs(s: RunningSim, c: NewSimChoice): SimStartArgs | null {
  if (c.kind === 'cancel') return null
  const seed = c.kind === 'new' ? c.seed >>> 0 : s.seed
  return { seed, scenarioId: s.scenarioId, params: s.params ? { ...s.params, seed } : undefined }
}
