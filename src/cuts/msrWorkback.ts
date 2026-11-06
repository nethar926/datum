/**
 * MSR / shaft / blade work-back: mark one line, assume harmonic n and type
 * (shaft rate or blade rate), list catalog classes that fit within a tolerance.
 * Pure — no gram / React. Fundamental may be missing (n > 1).
 */
import { catalog } from '@acoustics'

export type WorkbackType = 'shaft' | 'blade'

export interface WorkbackInput {
  /** Observed line frequency (Hz). */
  markHz: number
  /** Assumed harmonic order of that mark (1 = fundamental). */
  n: number
  type: WorkbackType
  /** Absolute Hz tolerance on the implied fundamental (default 0.5). */
  tolHz?: number
}

export interface WorkbackHit {
  classId: string
  name: string
  /** Implied fundamental from mark/n. */
  impliedFundHz: number
  /** Catalog envelope used for the match. */
  envelopeHz: [number, number]
  deltaHz: number
  blades: number
  shafts: number
  /** For blade type: implied shaft = fund/blades when blades known. */
  impliedShaftHz?: number
}

export interface WorkbackResult {
  impliedFundHz: number
  hits: WorkbackHit[]
}

type Any = Record<string, any>

function familyRange(keys: Any, family: string): [number, number] | null {
  const f = (keys.harmonicFamilies ?? []).find((x: Any) => x.lineFamily === family)
  const r = f?.fundamentalHz
  if (Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number') return [r[0], r[1]]
  return null
}

/**
 * Rank catalog classes whose shaft (PSR) or blade (BR) fundamental envelope
 * contains markHz / n (within tol). Missing fundamental is fine: n>1 still works.
 */
export function msrWorkback(input: WorkbackInput, source: { classes: readonly unknown[] } = catalog): WorkbackResult {
  const n = Math.max(1, Math.round(input.n))
  const tol = input.tolHz ?? 0.5
  if (!(input.markHz > 0) || !Number.isFinite(input.markHz)) return { impliedFundHz: NaN, hits: [] }
  const impliedFundHz = input.markHz / n
  const family = input.type === 'shaft' ? 'PSR' : 'BR'
  const hits: WorkbackHit[] = []
  for (const raw of source.classes) {
    const x = raw as Any
    const keys = x.idKeys ?? {}
    const env = familyRange(keys, family)
    if (!env) continue
    // Envelope already spans 0..max; score by distance to the design max * typical fraction,
    // but acceptance is: implied fund inside [lo-tol, hi+tol] (lo is often 0).
    const lo = env[0] - tol, hi = env[1] + tol
    if (impliedFundHz < lo || impliedFundHz > hi) continue
    const blades = x.propeller?.blades ?? x.params?.blades ?? 0
    const shafts = x.propeller?.shafts ?? x.shafts ?? 1
    // Prefer classes whose mid-band (hi*0.5) is closer — teaching cue, not a probability.
    const mid = (env[0] + env[1]) / 2
    const deltaHz = Math.abs(impliedFundHz - mid)
    const hit: WorkbackHit = {
      classId: String(x.id),
      name: String(x.name ?? x.id).replace(/^Fictional /, ''),
      impliedFundHz,
      envelopeHz: env,
      deltaHz,
      blades, shafts,
    }
    if (input.type === 'blade' && blades > 0) hit.impliedShaftHz = impliedFundHz / blades
    hits.push(hit)
  }
  hits.sort((a, b) => a.deltaHz - b.deltaHz || a.classId.localeCompare(b.classId))
  return { impliedFundHz, hits }
}
