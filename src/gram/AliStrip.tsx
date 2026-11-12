import { useEffect, useRef } from 'react'
import { ALI_WINDOW_S, aliEdgeIsTop, aliLabel, drawAliStrip, integrateFromHistory } from './ali'
import { newestAtBottom, type GramDir } from './timeAxis'
import type { LevelHistory } from './levelHistory'
import type { PaletteId } from '../gl/colormap'

/** Dark-tinted glass ALI strip. The canvas is a sibling on top of the glass so the data is not blurred. */
export function AliStripView({ hist, rowRateHz, dir, palette, floor, ceil, f0, fBin, fLo, fHi, testId,
  integrationMode = 'sti', integrationSpanS = 0 }: {
  hist: LevelHistory
  rowRateHz: number
  dir: GramDir
  palette?: PaletteId
  floor: number
  ceil: number
  f0: number
  fBin: number
  fLo: number
  fHi: number
  testId?: string
  integrationMode?: 'sti' | 'lsti'
  integrationSpanS?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const top = aliEdgeIsTop(newestAtBottom(dir))
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const ctx = c.getContext('2d')
      if (!ctx) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round((c.clientWidth || 1) * dpr))
      const h = Math.max(1, Math.round((c.clientHeight || 1) * dpr))
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      const row = integrateFromHistory(hist, rowRateHz)
      if (!row.length) { ctx.clearRect(0, 0, w, h); return }
      drawAliStrip(ctx, row, { f0, fBin, fLo, fHi, floor, ceil, palette })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [hist, rowRateHz, palette, floor, ceil, f0, fBin, fLo, fHi])
  return (
    <div
      className={`ali-strip${top ? ' edge-top' : ' edge-bottom'}`}
      data-testid={testId}
      data-edge={top ? 'top' : 'bottom'}
      role="img"
      aria-label={aliLabel(rowRateHz, ALI_WINDOW_S, integrationMode, integrationSpanS)}
    >
      <div className="ali-glass" aria-hidden />
      <canvas ref={canvasRef} aria-hidden />
    </div>
  )
}
