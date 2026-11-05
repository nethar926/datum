import { freqToX } from './axis'
import { cpaModelHz, type CpaFit, type CpaSample } from './cpa'
import type { OverlayCtx } from './Gram'

const fmtClock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Readout text for the LOFAR header. */
export function cpaReadout(marks: readonly CpaSample[], fit: CpaFit | null, ready: boolean, min: number): string {
  if (!marks.length) return 'CPA: CLICK ALONG ONE TONAL'
  if (marks.length < min) return `CPA: ${marks.length}/${min} MARKS`
  if (!ready) return `CPA: ${marks.length} MARKS · FIT PENDING`
  if (!fit || !fit.ok) return `CPA: NO FIT${fit?.reason ? ` (${fit.reason})` : ''}`
  return `CPA T+${fmtClock(fit.tCpaS)}  ${(fit.speedMps * 1.943844).toFixed(1)} KT  R ${(fit.rCpaM / 1000).toFixed(2)} KM  F0 ${fit.f0.toFixed(2)}`
}

/** Marks (crosses), the fitted S-curve and the CPA time line, positioned against the scrolling waterfall. */
export function CpaOverlay({ ctx, marks, fit, nowS }: { ctx: OverlayCtx; marks: readonly CpaSample[]; fit: CpaFit | null; nowS: number }) {
  const { view, width, historyS } = ctx
  const yPct = (t: number) => ((nowS - t) / historyS) * 100
  let curve: string | null = null
  if (fit?.ok && marks.length) {
    const t0 = Math.min(marks[0].tS, fit.tCpaS) - 60, t1 = Math.max(marks[marks.length - 1].tS, fit.tCpaS) + 60
    const pts: string[] = []
    for (let k = 0; k <= 64; k++) {
      const t = t0 + ((t1 - t0) * k) / 64
      pts.push(`${freqToX(cpaModelHz(fit, t), view, width).toFixed(1)},${yPct(t).toFixed(2)}`)
    }
    curve = pts.join(' ')
  }
  return (
    <>
      {curve && (
        <svg className="cpa-curve" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden><polyline points={curve} /></svg>
      )}
      {fit?.ok && <div className="cpa-tline" style={{ top: `${yPct(fit.tCpaS)}%` }}><span>CPA</span></div>}
      {marks.map((m) => (
        <div key={m.tS} className="cpa-mark" style={{ left: freqToX(m.fHz, view, width), top: `${yPct(m.tS)}%` }} />
      ))}
    </>
  )
}
