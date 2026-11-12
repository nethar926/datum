import { useEffect, useMemo, useRef, useState } from 'react'
import type { GramConfig } from '../engine/contract'
import type { SimClient } from '../engine/client'
import type { PaletteId } from '../gl/colormap'
import { LevelHistory } from './levelHistory'
import { BearingHistory } from './brgFreq'
import { niceTicks, type FreqView } from './axis'
import { placeFreqAxisTicks } from './freqAxis'
import { BFI_WINDOW_S, bfiPointsFromHistory, drawBfi } from './bfi'
import { rowPeriodS, rowRateHz } from './rowPeriod'

interface Props {
  client: SimClient
  configs: GramConfig[]
  streamIndex: number
  view: FreqView
  palette?: PaletteId
}

type Rings = { power: LevelHistory; brg: BearingHistory; stream: number; newestRowSimT: number | null }

/**
 * Main (or companion) BFI display: frequency against bearing, gram colormap, ~30 s fade.
 * Subscribes to the same engine rows as the gram (`bearingDeg` + dB). DIFAR only.
 */
export function BfiPlot({ client, configs, streamIndex, view, palette = 'green' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const histRef = useRef<Rings | null>(null)
  const rafRef = useRef(0)
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(400)
  const cfg = configs[streamIndex] ?? configs[0]
  const rate = cfg ? rowRateHz(cfg, undefined, 0.5) : 0.5
  const period = cfg ? rowPeriodS(cfg, undefined, 2) : 2
  // Enough history for the 30 s window plus a couple of extra rows (age 30 is dropped).
  const rows = Math.max(16, Math.ceil(BFI_WINDOW_S / Math.max(period, 1e-12)) + 2)
  const bins = cfg?.bins ?? 1
  const streamId = cfg?.streamId ?? -1

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      setWidth(Math.max(1, el.clientWidth - 44))
      setHeight(Math.max(1, el.clientHeight - 44))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    histRef.current = { power: new LevelHistory(rows, bins), brg: new BearingHistory(rows, bins), stream: -1, newestRowSimT: null }
    const off = client.onRows((rowsMsg) => {
      const rings = histRef.current
      const cfgNow = { streamId, bins }
      if (!rings) return
      if (rings.stream !== cfgNow.streamId) {
        rings.power.clear()
        rings.brg.clear()
        rings.newestRowSimT = null
        rings.stream = cfgNow.streamId
      }
      const n = rowsMsg.streamIds.length
      if (!n) return
      const b = cfgNow.bins
      if (rowsMsg.data.length !== n * b) return
      const bd = rowsMsg.bearingDeg
      for (let k = 0; k < n; k++) {
        if (rowsMsg.streamIds[k] !== cfgNow.streamId) continue
        const o = k * b
        rings.power.push(rowsMsg.data, o)
        if (bd && bd.length === rowsMsg.data.length) rings.brg.push(bd, o)
        // Newest row's sim time (row clock). Held on pause — no new row, tNewest stays.
        rings.newestRowSimT = rowsMsg.simT
      }
    })
    return () => { off(); histRef.current = null }
  }, [client, streamId, bins, rows])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !cfg) return
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      const ctx = c.getContext('2d')
      const rings = histRef.current
      if (!ctx || !rings) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round((c.clientWidth || 1) * dpr))
      const h = Math.max(1, Math.round((c.clientHeight || 1) * dpr))
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      const pts = bfiPointsFromHistory(rings.power, rings.brg, {
        f0: cfg.f0, fBin: cfg.fBin, fLo: view.lo, fHi: view.hi, rowRateHz: rate,
        tNewestRowSim: rings.newestRowSimT ?? undefined,
        rowPeriodS: period,
      })
      drawBfi(ctx, pts, { fLo: view.lo, fHi: view.hi, floor: cfg.dbFloor, ceil: cfg.dbCeil, palette })
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [cfg, view.lo, view.hi, rate, period, palette])

  const brgTicks = useMemo(() => {
    const step = width < 360 ? 90 : 45
    const ticks: number[] = []
    for (let d = 0; d <= 360; d += step) ticks.push(d)
    return placeFreqAxisTicks(ticks, { lo: 0, hi: 360 }, width, '°')
  }, [width])
  const freqTicks = useMemo(() => niceTicks(view.lo, view.hi, Math.max(3, Math.floor(height / 36))), [view, height])
  const ch = cfg?.channel ?? 0
  const fmt = (f: number) => {
    const a = Math.abs(f)
    if (a >= 100 || Number.isInteger(f)) return String(Math.round(f))
    if (a >= 10) return f.toFixed(1).replace(/\.0$/, '')
    return String(f)
  }
  const label = `BFI · ${fmt(view.lo)}–${fmt(view.hi)} Hz · ${BFI_WINDOW_S} s · B${ch}`

  return (
    <div className="gram bfi-plot" ref={boxRef} data-testid="bfi-frame" role="img" aria-label={label}>
      <canvas ref={canvasRef} data-testid="bfi-canvas" />
      <div className="axis axis-y" data-testid="bfi-freq-axis" aria-hidden>
        {freqTicks.map((t) => {
          const frac = (t - view.lo) / Math.max(1e-12, view.hi - view.lo)
          const top = (1 - frac) * 100
          const last = t === freqTicks[freqTicks.length - 1]
          return (
            <span key={t} style={{ top: `clamp(9px, ${top}%, calc(100% - 9px))` }}>
              {fmt(t)}{last ? ' Hz' : ''}
            </span>
          )
        })}
      </div>
      <div className="axis axis-x" data-testid="bfi-brg-axis" aria-hidden>
        {brgTicks.map((t) => (
          <span key={t.f} style={{ left: t.left }}>
            <i className="tick-x" style={{ left: '50%', top: -6 }} />{t.label}
          </span>
        ))}
      </div>
      <div className="bfi-label" data-testid="bfi-label">{label}</div>
    </div>
  )
}
