import { useRef } from 'react'
import { freqToX } from './axis'
import { pctFromAgo } from './timeAxis'
import type { OverlayCtx } from './Gram'
import { BASIS_LABEL, kThrough, lloydReadout, nearestNull, overlaySpacingSamples, striationHz, type LloydBasis, type Striation } from './lloyds'
import { acousticsV11 } from '../scenarios/acousticsApi'

export const LM_MAX_N = 30
/** Skip drawing when null spacing at CPA is below this many pixels (curves would just be hatching). */
const MIN_SPACING_PX = 10

export interface LloydState {
  basis: LloydBasis
  k: number            // first-null Hz at CPA
  tCpaS: number        // used for manual / none
  tauS: number         // used for none (R/v)
  manRangeM: number; manSpeedMps: number
}
export interface CpaGeom { tCpaS: number; rCpaM: number; speedMps: number }

/** Effective striation for the active basis. */
export function effective(st: LloydState, cpa: CpaGeom | null): { s: Striation; rCpaM: number | null } {
  if (st.basis === 'cpaFit' && cpa) return { s: { k: st.k, tCpaS: cpa.tCpaS, tauS: cpa.rCpaM / Math.max(0.1, cpa.speedMps) }, rCpaM: cpa.rCpaM }
  if (st.basis === 'manual') return { s: { k: st.k, tCpaS: st.tCpaS, tauS: st.manRangeM / Math.max(0.1, st.manSpeedMps) }, rCpaM: st.manRangeM }
  return { s: { k: st.k, tCpaS: st.tCpaS, tauS: st.tauS }, rCpaM: null }
}

/** Drag handler factory: plain drag re-scales K through the grabbed null; shift-drag moves CPA time (manual/none). */
export function useLloydDrag(st: LloydState, set: (s: LloydState) => void, cpa: CpaGeom | null, nowS: number) {
  const grab = useRef<{ n: number; t0: number; tc0: number } | null>(null)
  return (phase: 'start' | 'move' | 'end', hz: number, agoS: number, shift: boolean) => {
    const t = nowS - agoS, { s } = effective(st, cpa)
    if (phase === 'start') { grab.current = { n: nearestNull(s, t, hz), t0: t, tc0: st.tCpaS }; return }
    const g = grab.current
    if (!g) return
    if (shift && st.basis !== 'cpaFit') set({ ...st, tCpaS: g.tc0 + (t - g.t0) })
    else { const k = kThrough(s, g.n, t, hz); if (k > 0.05 && isFinite(k)) set({ ...st, k }) }
    if (phase === 'end') grab.current = null
  }
}

/** Fit the overlay's measured Δf(t) with acoustics' fitLloydsMirror (null when the API isn't available or the fit fails). */
export function fitOverlay(st: LloydState, cpa: CpaGeom | null, zrM: number, window: { t0: number; t1: number }) {
  const fit = acousticsV11.fitLloydsMirror
  if (!fit || !(window.t1 > window.t0)) return null
  const { s, rCpaM } = effective(st, cpa)
  const basis = st.basis === 'cpaFit' && !cpa ? 'none' : st.basis
  const speed = basis === 'cpaFit' && cpa ? cpa.speedMps : st.manSpeedMps
  const rangeSource = basis === 'none' || rCpaM === null ? 'none' as const : { kind: basis, rCPA: rCpaM, speed, tCPA: s.tCpaS }
  try {
    const r = fit(overlaySpacingSamples(s, window.t0, window.t1), { zrM, rangeSource })
    return r.ok && r.depthRatio > 0 ? r : null
  } catch { return null }
}

export function lloydText(st: LloydState, cpa: CpaGeom | null, zrM: number | null, window?: { t0: number; t1: number }): string {
  const { rCpaM } = effective(st, cpa)
  const basis = st.basis === 'cpaFit' && !cpa ? 'none' : st.basis
  if (!zrM) return `LM BASIS ${BASIS_LABEL[basis]}  NO HYDROPHONE DEPTH`
  const rd = lloydReadout(basis, st.k, zrM, rCpaM)
  const f = window ? fitOverlay(st, cpa, zrM, window) : null
  const ratio = f ? f.depthRatio : rd.depthRatio
  const zs = f && Number.isFinite(f.zs) ? f.zs : rd.zsM
  return basis === 'none'
    ? `LM BASIS NONE  R/zs ${ratio.toFixed(1)} (RELATIVE)`
    : `LM BASIS ${BASIS_LABEL[basis]}  ZS ${zs.toFixed(0)} M  R/zs ${ratio.toFixed(1)}`
}

/** Striation hyperbolas (n = 1..) drawn over the scrolling waterfall. */
export function LloydsOverlay({ ctx, st, cpa, nowS }: { ctx: OverlayCtx; st: LloydState; cpa: CpaGeom | null; nowS: number }) {
  const { view, width, historyS, dir } = ctx
  const { s } = effective(st, cpa)
  const lines: string[] = []
  const spacingPx = (s.k / (view.hi - view.lo)) * width
  if (spacingPx >= MIN_SPACING_PX) for (let n = 1; n <= LM_MAX_N; n++) {
    if (n * s.k > view.hi) break // minimum of each hyperbola is n·K at CPA
    const pts: string[] = []
    for (let j = 0; j <= 48; j++) {
      const ago = (historyS * j) / 48, f = striationHz(s, n, nowS - ago)
      if (f > view.hi * 1.5) { if (pts.length) { lines.push(pts.join(' ')); pts.length = 0 } continue }
      pts.push(`${freqToX(f, view, width).toFixed(1)},${pctFromAgo(ago, historyS, dir).toFixed(2)}`)
    }
    if (pts.length > 1) lines.push(pts.join(' '))
  }
  return (
    <svg className="lm-curves" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden>
      {lines.map((p, i) => <polyline key={i} points={p} />)}
    </svg>
  )
}
