import { useRef } from 'react'
import { freqToX } from './axis'
import type { OverlayCtx } from './Gram'
import { BASIS_LABEL, kThrough, lloydReadout, nearestNull, striationHz, type LloydBasis, type Striation } from './lloyds'

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

export function lloydText(st: LloydState, cpa: CpaGeom | null, zrM: number | null): string {
  const { rCpaM } = effective(st, cpa)
  const basis = st.basis === 'cpaFit' && !cpa ? 'none' : st.basis
  if (!zrM) return `LM BASIS ${BASIS_LABEL[basis]}  NO HYDROPHONE DEPTH`
  const rd = lloydReadout(basis, st.k, zrM, rCpaM)
  return basis === 'none'
    ? `LM BASIS NONE  zs/R ${rd.depthRatio.toFixed(3)} (RELATIVE)`
    : `LM BASIS ${BASIS_LABEL[basis]}  ZS ${rd.zsM.toFixed(0)} M`
}

/** Striation hyperbolas (n = 1..) drawn over the scrolling waterfall. */
export function LloydsOverlay({ ctx, st, cpa, nowS }: { ctx: OverlayCtx; st: LloydState; cpa: CpaGeom | null; nowS: number }) {
  const { view, width, historyS } = ctx
  const { s } = effective(st, cpa)
  const lines: string[] = []
  const spacingPx = (s.k / (view.hi - view.lo)) * width
  if (spacingPx >= MIN_SPACING_PX) for (let n = 1; n <= LM_MAX_N; n++) {
    if (n * s.k > view.hi) break // minimum of each hyperbola is n·K at CPA
    const pts: string[] = []
    for (let j = 0; j <= 48; j++) {
      const ago = (historyS * j) / 48, f = striationHz(s, n, nowS - ago)
      if (f > view.hi * 1.5) { if (pts.length) { lines.push(pts.join(' ')); pts.length = 0 } continue }
      pts.push(`${freqToX(f, view, width).toFixed(1)},${((ago / historyS) * 100).toFixed(2)}`)
    }
    if (pts.length > 1) lines.push(pts.join(' '))
  }
  return (
    <svg className="lm-curves" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden>
      {lines.map((p, i) => <polyline key={i} points={p} />)}
    </svg>
  )
}
