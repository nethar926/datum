/**
 * CPA cursor support. The operator marks points (sim time, Hz) along one tonal's Doppler S-curve; a fit
 * (acoustics' fitCpaFromDoppler, planned for contract v1.1) returns f0, speed, CPA time and CPA range.
 * This file only holds the UI-side types, the adapter, and the curve sampling used to draw a fit.
 */
import { doppler } from '@acoustics'
import { acousticsV11 } from '../scenarios/acousticsApi'

export interface CpaSample { tS: number; fHz: number }
export interface CpaFit { ok: boolean; f0: number; speedMps: number; tCpaS: number; rCpaM: number; reason?: string }
export type CpaFitter = (samples: readonly CpaSample[]) => CpaFit
export const MIN_CPA_SAMPLES = 5

/** Received frequency for a straight-line pass: source radial speed is positive (closing) before CPA. */
export function cpaModelHz(fit: Pick<CpaFit, 'f0' | 'speedMps' | 'tCpaS' | 'rCpaM'>, tS: number): number {
  const along = fit.speedMps * (tS - fit.tCpaS)
  const r = Math.hypot(fit.rCpaM, along)
  const radial = r > 0 ? (-fit.speedMps * along) / r : 0
  return doppler(fit.f0, radial)
}

/** Insert a mark keeping time order; a mark within minDtS of an existing one replaces it. */
export function addSample(list: readonly CpaSample[], s: CpaSample, minDtS = 1): CpaSample[] {
  const out = list.filter((p) => Math.abs(p.tS - s.tS) >= minDtS)
  out.push(s)
  out.sort((a, b) => a.tS - b.tS)
  return out
}

/** Pending fitter until acoustics ships fitCpaFromDoppler; swap in with setCpaFitter. */
const v11 = acousticsV11.fitCpaFromDoppler
let fitter: CpaFitter | null = v11
  ? (smp) => { const r = v11(smp.map((p) => ({ tS: p.tS, fHz: p.fHz }))); return { ok: r.ok, f0: r.f0, speedMps: r.speed, tCpaS: r.tCPA, rCpaM: r.rCPA } }
  : null
export const setCpaFitter = (f: CpaFitter | null) => { fitter = f }
export function runCpaFit(samples: readonly CpaSample[]): CpaFit | null {
  if (samples.length < MIN_CPA_SAMPLES || !fitter) return null
  try { return fitter(samples) } catch (e) { return { ok: false, f0: NaN, speedMps: NaN, tCpaS: NaN, rCpaM: NaN, reason: String(e) } }
}
export const cpaFitterReady = () => fitter !== null
