import { useEffect, useRef, useState } from 'react'
import {
  ALI_WINDOW_S, aliBars, aliLabel, aliHzAt, aliSnap, drawAliBars, integrateFromHistory,
  type AliBearingAmp, type AliBar,
} from './ali'
import type { LevelHistory } from './levelHistory'
import type { PaletteId } from '../gl/colormap'

/** Amplitude bar chart under the gram. Taller bar = more amplitude. Selected bar and Send use accent-tinted glass. */
export function AliStripView({ hist, rowRateHz, palette: _palette, floor, ceil, f0, fBin, fLo, fHi, testId,
  integrationMode = 'sti', integrationSpanS = 0, onSend, bearingAmps }: {
  hist: LevelHistory
  rowRateHz: number
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
  onSend?: (hz: number) => void
  /** Sonya's per-bearing amplitude seam; when present, bars come from these samples. */
  bearingAmps?: AliBearingAmp[] | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<AliBar[]>([])
  const [selectedHz, setSelectedHz] = useState<number | null>(null)
  const selectedRef = useRef<number | null>(null)
  selectedRef.current = selectedHz

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
      const bars = aliBars(row, bearingAmps, { f0, fBin, fLo, fHi, floor, ceil })
      barsRef.current = bars
      const accent = getComputedStyle(c).getPropertyValue('--glass-accent-tint').trim()
        || getComputedStyle(c).getPropertyValue('--tint').trim()
        || '#30d158'
      drawAliBars(ctx, bars, { fLo, fHi, selectedHz: selectedRef.current, accent: accent.startsWith('rgb') || accent.startsWith('#') ? accent : '#30d158' })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [hist, rowRateHz, floor, ceil, f0, fBin, fLo, fHi, bearingAmps])

  const pick = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    const raw = aliHzAt(clientX - rect.left, rect.width, fLo, fHi)
    const span = Math.max(1e-9, fHi - fLo)
    return aliSnap(raw, barsRef.current, Math.max(span * 0.02, 1))
  }

  return (
    <div
      className="ali-chart"
      data-testid={testId}
      data-under="1"
      role="img"
      aria-label={aliLabel(rowRateHz, ALI_WINDOW_S, integrationMode, integrationSpanS)}
      onPointerUp={(e) => {
        const hz = pick(e.clientX, e.currentTarget)
        const windowHz = Math.max((fHi - fLo) * 0.02, 1)
        if (selectedHz != null && Math.abs(selectedHz - hz) <= windowHz) {
          onSend?.(hz)
        } else {
          setSelectedHz(hz)
        }
      }}
    >
      <div className="ali-glass" aria-hidden />
      <canvas ref={canvasRef} aria-hidden />
      {selectedHz != null && onSend && (
        <button
          type="button"
          className="ali-send"
          data-testid={testId ? `${testId}-send` : 'ali-send'}
          onPointerUp={(e) => { e.stopPropagation(); onSend(selectedHz) }}
          onClick={(e) => { e.stopPropagation(); onSend(selectedHz) }}
        >Send bearing</button>
      )}
    </div>
  )
}
