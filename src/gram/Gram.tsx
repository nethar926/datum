import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GramConfig, Tactical } from '../engine/contract'
import { fillLineBearings, type GramMode } from './difarBearing'
import { BearingHistory, BRG_RECENT_ROWS, sampleBearingAt } from './brgFreq'
import type { SimClient } from '../engine/client'
import { WaterfallRenderer } from '../gl/waterfall'
import { NORM_CEIL_DB, NORM_FLOOR_DB, bakeMaps, texturesFor } from './bands'
import type { DifarWheelSettings, PaletteId } from '../gl/colormap'
import { contrastRange } from './contrast'
import { AutoLevel } from './autoLevel'
import { SplitWindowNormalizer } from './whiten'
import { LevelHistory } from './levelHistory'
import { freqToX, niceTicks, xToFreq, zoomView, type FreqView } from './axis'
import { placeFreqAxisTicks } from './freqAxis'
import { bandLimitHz, fullView, minSpanOf } from './res'
import { DOUBLE_TAP_MS, LONG_PRESS_MS, applyTwoFingerPan, classifyTwoFinger, exceedsSlop, fingerExactCursor, isThreeFingerSwipeDown, pinchView, type PanAxis } from '../touch/gestures'
import { formatZuluHms, isReviewing, returnToLive, viewNowS } from '../touch/scrollBack'
import { isLockTap } from './cursorLock'
import { holdAfterThreeFingerSwipe, isCursorFrozen, nextHoldOnTap, showLockIcon, toggleLockButton, type CursorHold } from './cursorState'
import { IcLock } from '../ui/icons'
import { agoFromY, formatZulu, newestAtBottom, pctFromAgo, timeTickAges, type GramDir, DEFAULT_GRAM_DIR } from './timeAxis'
import { AXIS_Y_EDGE_CLAMP_PX } from './lockVsTimeAxis'
import { horzAtPointer, horzSimS, horzZulu, liveReadout, readoutHz } from './horz'
import { AliStripView } from './AliStrip'
import { rowRateHz } from './rowPeriod'
import { estimateCursorReadout, estimateSelLabelSize, placeSelMarkerLabel, type Rect as ReadoutRect } from './selMarkerLabel'


export interface OverlayCtx { view: FreqView; width: number; cfg: GramConfig; historyS: number; dir: GramDir }
interface Props {
  /** Streams of one kind (all with equal bins), in display order; streamIndex selects among them. */
  client: SimClient; configs: GramConfig[]; streamIndex: number; view: FreqView; onView: (v: FreqView) => void
  label?: string; testId?: string; historyRows?: number; unit?: string
  /** Drawn above the waterfall (cursors, markers); gets the live view and pixel width. */
  overlay?: (o: OverlayCtx) => React.ReactNode
  /** When set, clicks call this with (Hz, seconds before the newest row) instead of onSelectHz. */
  onPickPoint?: (hz: number, agoS: number) => void
  /** When set, pointer drags on the waterfall call this (overlay dragging); clicks are suppressed. */
  onDragPoint?: (phase: 'start' | 'move' | 'end', hz: number, agoS: number, shift: boolean) => void
  /**
   * HORZ: a thin full-width horizontal hairline at the pointer row that reads time (Zulu at the time-axis edge).
   * The Hz readout is the finger's x position. Works on mouse hover and on touch/mouse drag. Cursor chrome only
   * (not a crosshair mode, not a bearing fix).
   */
  horz?: boolean; nowS?: number
  /** ALI: Automatic Line Integration strip at the newest-data edge (LOFAR only). */
  ali?: boolean
  auto?: boolean; normalized?: boolean; palette?: PaletteId
  /**
   * When set, each incoming row is copied through this into scratch and pushed to the raw ring
   * (DEMON clamp+whiten). Skips the default split-window copy into the normalized ring.
   */
  preprocessRow?: (src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number) => void
  /** Cache-bust key when preprocessRow identity changes (e.g. 'demon'). */
  normKey?: string
  /** Colour-scale gain about the dB midpoint (1 = engine range). Applies to LOFAR and DIFAR. */
  contrast?: number
  /** DIFAR operator wheel (rotation, steps, look, null/isolate sectors). */
  wheel?: DifarWheelSettings; selectedHz?: number | null; onSelectHz?: (hz: number) => void
  /** 'difar' colours each bin by bearing (hue) with intensity as brightness; 'lofar' uses the palette. */
  mode?: GramMode
  /** Latest tactical frame, used for per-bin bearings until the engine streams them. */
  tactical?: Tactical
  /** Gram handoff indicator (RES/filter/vernier change filling); fades in/out, never blocks input. */
  handoff?: { label: string; active: boolean }
  /** Tap/click the frequency axis to center the view on that Hz (m3-fe-center). */
  onCenterFreq?: (hz: number) => void
  /** Live cursor frequency (mouse move / touch scrub); null when the cursor leaves. */
  onCursorHz?: (hz: number | null) => void
  /** Optional suffix merged into the top-left cursor readout (e.g. listen FOCUS note). Never covers rows. */
  cursorSuffix?: string | null
  /** Filled each frame with a sampler: Hz → DIFAR bearing deg (circular mean over recent rows), or null. */
  bearingAtRef?: React.MutableRefObject<((hz: number) => number | null) | null>
  /** Filled with a sampler that copies one LevelHistory row (agoS seconds) for COMB peak snap. */
  rowSamplerRef?: React.MutableRefObject<((agoS: number, dest: Float32Array) => boolean) | null>
  /** Newest-at-bottom (default) or newest-at-top. */
  dir?: GramDir
  /** Wall-clock ms (UTC) corresponding to sim t=0; used for Zulu Y labels. */
  zuluOriginMs?: number
  /**
   * CURLOCK: when true, onDragPoint moves are ignored (HARM/LM locked by the parent). Taps still fire
   * onDragLockTap when dragLockable so the parent can unlock.
   */
  dragLocked?: boolean
  /** When true, a classified tap calls onDragLockTap instead of falling through to default-cursor lock. */
  dragLockable?: boolean
  onDragLockTap?: () => void
  /** When true (sim paused), two-finger vertical pan scrolls back in time up to 15 min. */
  paused?: boolean
  /** Seconds before the live edge currently shown (0 = live). */
  scrollBackS?: number
  onScrollBack?: (s: number) => void
  onReturnToLive?: () => void
}
// Auto range: noise floor sits just above black, tonals reach the bright end of the phosphor palette.
const AUTO_BELOW_DB = 4, AUTO_SPAN_DB = 32
// Normalized view: background sits at ~0 dB, so a fixed range from just below it shows weak tonals
// (NORM_FLOOR_DB / NORM_CEIL_DB live in ./bands so the handoff bake maps onto the same scale).

/**
 * Gram waterfall (LOFAR, DEMON): WebGL2 ring textures, frequency axis below, time axis right, cursor readout.
 * Accepts gramRows for its own streams only (matched by streamId), so several panes can share one client.
 */
export function Gram({ client, configs, streamIndex, view, onView, auto = true, normalized = true, palette = 'green', contrast = 1, wheel, selectedHz = null, onSelectHz, mode = 'lofar', tactical,
  label = 'LOFAR waterfall', testId = 'lofar', historyRows = 600, unit = 'Hz', overlay, onPickPoint, onDragPoint, horz = false, ali = false, nowS = 0, handoff, onCenterFreq, onCursorHz, cursorSuffix = null, bearingAtRef, rowSamplerRef, dir = DEFAULT_GRAM_DIR, zuluOriginMs, dragLocked = false, dragLockable = false, onDragLockTap, paused = false, scrollBackS = 0, onScrollBack, onReturnToLive, preprocessRow, normKey = '' }: Props) {
  const HISTORY_ROWS = historyRows
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WaterfallRenderer | null>(null)
  // Key-scoped so a successful rebuild on a new rendererKey hides a prior failure without setState(null).
  const [glFail, setGlFail] = useState<{ key: string; msg: string } | null>(null)
  // Bumped when a lost WebGL context is not restored (iOS backgrounding): remounts the canvas with a fresh context.
  const [glGen, setGlGen] = useState(0)
  const [pressHint, setPressHint] = useState(false)
  const [cursor, setCursor] = useState<number | null>(null)
  // Cursor hold: free → tap anchors → tap releases; three-finger swipe-down / lock btn → locked.
  const [cursorHold, setCursorHold] = useState<CursorHold>('free')
  const cursorLocked = isCursorFrozen(cursorHold)
  const cursorRef = useRef<number | null>(null)
  const [cross, setCross] = useState<{ hz: number; agoS: number; x: number; db: number } | null>(null)
  const [hoverAgo, setHoverAgo] = useState<number | null>(null)
  /** Hz at the pointer's x, even when the vertical hairline is locked. Cleared when the pointer lifts. */
  const [fingerHz, setFingerHz] = useState<number | null>(null)
  const histRef = useRef<LevelHistory | null>(null)
  useLayoutEffect(() => { cursorRef.current = cursor }, [cursor])
  const brgHistRef = useRef<BearingHistory | null>(null)
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(400)
  const gramBoxRef = useRef<HTMLDivElement>(null)
  const readoutElRef = useRef<HTMLDivElement>(null)
  const [readoutBox, setReadoutBox] = useState<ReadoutRect | null>(null)
  const cfg = configs[streamIndex] ?? configs[0]
  const fBin = cfg?.fBin ?? 1, rowRate = rowRateHz(cfg, undefined, 0.5)
  const fMax = cfg ? cfg.f0 + (cfg.bins - 1) * cfg.fBin : 1000
  const fMin = cfg?.f0 ?? 0, minSpan = minSpanOf(cfg)
  const full = (): FreqView => (cfg ? fullView(cfg) : { lo: 0, hi: fMax })
  const limitHz = bandLimitHz(cfg)
  // Bumped in the wheel effect so the RAF draw key changes after setWheel — ref, not state, to avoid set-state-in-effect.
  const wheelTickRef = useRef(0)
  const viewRef = useRef({ view, streamIndex, cfg, auto, normalized, palette, mode, contrast })
  const tacRef = useRef(tactical)
  // Latest props for the RAF/handoff closures — layout effect so render stays ref-free (oxlint react/refs).
  const preprocessRef = useRef(preprocessRow)
  useLayoutEffect(() => {
    viewRef.current = { view, streamIndex, cfg, auto, normalized, palette, mode, contrast }
    tacRef.current = tactical
    preprocessRef.current = preprocessRow
  }, [view, streamIndex, cfg, auto, normalized, palette, mode, contrast, tactical, preprocessRow])
  // Streams the renderer is drawing right now. A handoff promote swaps this synchronously (before React
  // re-renders with the new configs), so the frame loop never pairs new textures with the old grid.
  const liveRef = useRef(configs), promotedRef = useRef<GramConfig[] | null>(null), epochRef = useRef(0)
  // m3-fe-drop: buoys joined the field (same streams + new ones at the end, same grid) → grow the renderer in place.
  const growRef = useRef<((cs: GramConfig[]) => void) | null>(null), growTo = useRef<GramConfig[] | null>(null)
  const fillReqRef = useRef(0)
  // Render-phase sync is required: epochRef feeds rendererKey (a React key) in this same commit, and liveRef
  // must match before the frame loop runs. State/effect deferral either loops on new configs[] each render
  // or pairs new configs with the old WebGL grid for a frame. oxlint react/refs forbids this pattern.
  /* oxlint-disable react/refs -- WebGL lifetime sync; see comment above */
  if (configs[0]?.streamId === liveRef.current[0]?.streamId) {
    const prev = liveRef.current
    const grew = configs !== prev && configs.length > prev.length && configs[0]?.bins === prev[0]?.bins && prev.every((c, i) => configs[i].streamId === c.streamId)
    if (grew) growTo.current = configs
    // Same ids but a different grid without a handoff (legacy hot-swap setGram): rebuild the renderer.
    else if (configs[0]?.bins !== prev[0]?.bins || configs.length !== prev.length) epochRef.current++
    else if (
      configs !== prev && (
        configs[0]?.res !== prev[0]?.res || configs[0]?.filter !== prev[0]?.filter ||
        configs[0]?.fBin !== prev[0]?.fBin || configs[0]?.f0 !== prev[0]?.f0 || configs[0]?.fcHz !== prev[0]?.fcHz
      )
    ) {
      // RES / filter / vernier switch: seed a filling state immediately so stale rows never redraw.
      fillReqRef.current++
    }
    liveRef.current = configs
  } else if (
    // CUT scrubber seek: new CutSession → new stream ids, same bins/count. Remap in place; onCutSeek clears the ring.
    client.isSeekingCut() &&
    configs.length === liveRef.current.length &&
    configs[0]?.bins === liveRef.current[0]?.bins
  ) {
    liveRef.current = configs
  }
  else if (liveRef.current !== promotedRef.current) { liveRef.current = configs; epochRef.current++ } // a new stream set (restart), not a handoff
  // One renderer per stream set lifetime: handoffs (RES, filter, vernier, band) swap banks inside it, even when
  // the bin count changes (RES 1024 ↔ band 2048). A restart (new set, not a handoff) bumps the epoch → rebuild.
  const rendererKey = `${epochRef.current}:${glGen}:${normKey}`
  /* oxlint-enable react/refs */
  const glError = glFail && glFail.key === rendererKey ? glFail.msg : null

  const hasConfigs = configs.length > 0
  useEffect(() => {
    const canvas = canvasRef.current
    const cs0 = liveRef.current
    if (!canvas || !cs0.length || !cs0[0].bins) return
    // Geometry-dependent CPU state; rebuilt only when a handoff changes bins or family (never per frame).
    const mk = (cs: GramConfig[]) => {
      const b = cs[0].bins
      return { bins: b, filtered: cs[0].res !== undefined, norm: new SplitWindowNormalizer(b), scratch: new Float32Array(b), brgRow: new Float32Array(b) }
    }
    // Single mutable runtime box: oxlint react/immutability flags reassigning effect `let`s from nested
    // RAF/row/handoff callbacks. Property writes on a const box are the same semantics without the lint.
    const g0 = mk(cs0)
    const rt: {
      r: WaterfallRenderer
      N: number
      g: ReturnType<typeof mk>
      pg: ReturnType<typeof mk>
      level: AutoLevel
      hist: LevelHistory
      brgHist: BearingHistory
      histStream: number
      pendingCfgs: GramConfig[]
      live: Map<number, number>
      pending: Map<number, number>
      dirty: boolean
      raf: number
      lostTimer: number
      lastKey: string
      drainHandle: number
      fillApplied: number
    } = {
      r: null!,
      N: cs0.length,
      g: g0,
      pg: g0,
      level: null!,
      hist: null!,
      brgHist: null!,
      histStream: viewRef.current.streamIndex,
      pendingCfgs: [],
      live: new Map(),
      pending: new Map(),
      dirty: true,
      raf: 0,
      lostTimer: 0,
      lastKey: '',
      drainHandle: -1,
      fillApplied: 0,
    }
    cs0.forEach((c, i) => rt.live.set(c.streamId, i))
    try {
      rt.r = new WaterfallRenderer(canvas, rt.g.bins, HISTORY_ROWS, texturesFor(cs0), rt.N)
    } catch (e) {
      // Defer so we don't synchronously setState in the effect body (oxlint react/set-state-in-effect).
      const msg = e instanceof Error ? e.message : String(e)
      queueMicrotask(() => setGlFail({ key: rendererKey, msg }))
      return
    }
    const r = rt.r
    rendererRef.current = r
    rt.level = new AutoLevel(rt.N)
    rt.hist = new LevelHistory(HISTORY_ROWS, rt.g.bins); histRef.current = rt.hist
    rt.brgHist = new BearingHistory(BRG_RECENT_ROWS, rt.g.bins); brgHistRef.current = rt.brgHist
    if (bearingAtRef) bearingAtRef.current = (hz) => {
      const c = viewRef.current.cfg; if (!c) return null
      return sampleBearingAt(rt.brgHist, c, hz)
    }
    if (rowSamplerRef) rowSamplerRef.current = (agoS, dest) => {
      const c = viewRef.current.cfg; if (!c) return false
      const agoRows = agoS * rowRateHz(c, undefined, 0.5)
      return rt.hist.copyRow(agoRows, dest)
    }
    const startPending = (cs: GramConfig[]) => {
      rt.pending = new Map(); cs.forEach((c, i) => rt.pending.set(c.streamId, i)); rt.pendingCfgs = cs
      rt.pg = cs[0].bins === rt.g.bins && (cs[0].res !== undefined) === rt.g.filtered ? rt.g : mk(cs)
      r.beginPending(cs[0].bins, texturesFor(cs))
    }
    const pc0 = client.pendingConfigs()
    if (pc0 && pc0.length === rt.N) startPending(pc0)
    const offHandoff = client.onHandoff((h) => {
      if (h.type === 'pending') { if (h.configs.length === rt.N && h.configs[0]?.bins) startPending(h.configs); return }
      if (h.type === 'drop') { rt.pending.clear(); rt.pendingCfgs = []; rt.pg = rt.g; r.dropPending(); return }
      if (h.to.length !== rt.N) return
      // No pending bank (context lost/restored mid-handoff): route the new ids into a fresh bank of the new size.
      if (!r.hasPending()) { r.beginPending(h.to[0].bins, texturesFor(h.to)); rt.pg = mk(h.to) }
      r.promotePending(bakeMaps(h.from, h.to, texturesFor(h.from), texturesFor(h.to)))
      if (rt.pg !== rt.g) {
        rt.g = rt.pg; rt.hist = new LevelHistory(HISTORY_ROWS, rt.g.bins); histRef.current = rt.hist
        rt.brgHist = new BearingHistory(BRG_RECENT_ROWS, rt.g.bins); brgHistRef.current = rt.brgHist
        rt.level = new AutoLevel(rt.N)
      } else { rt.hist.clear(); rt.brgHist.clear() }
      rt.live = rt.pending; rt.pending = new Map(); rt.pendingCfgs = []
      liveRef.current = h.to; promotedRef.current = h.to
      rt.dirty = true
    })
    const offSeek = client.onCutSeek((n) => {
      // Cut seek announces the LOFAR stream id. Remap only if this pane owns it (cut LOFAR gram).
      // DEMON panes must keep their own stream map — a blind remap would swallow DEMON rows.
      const owns = rt.live.has(n.streamId) || liveRef.current.some((c) => c.streamId === n.streamId)
      if (owns) {
        rt.live = new Map([[n.streamId, 0]])
        if (n.replace) { rt.hist.clear(); rt.brgHist.clear(); r.clearHistory() }
        rt.dirty = true
        return
      }
      // Sibling DEMON pane on Cuts: seek does not bulk-post DEMON; clear so playback fills fresh.
      if (n.replace && liveRef.current.some((c) => c.kind === 'demon')) {
        rt.hist.clear(); rt.brgHist.clear(); r.clearHistory()
        rt.live = new Map()
        liveRef.current.forEach((c, i) => rt.live.set(c.streamId, i))
        rt.dirty = true
      }
    })
    const off = client.onRows((rows) => {
      if (viewRef.current.streamIndex !== rt.histStream) { rt.hist.clear(); rt.brgHist.clear(); rt.histStream = viewRef.current.streamIndex }
      const n = rows.streamIds.length
      if (!n) return
      const bd = (rows as { bearingDeg?: Float32Array }).bearingDeg
      for (let k = 0; k < n; k++) {
        const id = rows.streamIds[k]
        const s = rt.live.get(id)
        if (s === undefined) {
          // Pending handoff set: fills the hidden bank while the displayed bank keeps scrolling.
          const p = rt.pending.get(id)
          if (p === undefined || rows.data.length !== n * rt.pg.bins) continue
          const b = rt.pg.bins, o = k * b
          r.pushPendingRow(p, rows.data, o)
          if (!rt.pg.filtered) { rt.pg.norm.apply(rows.data, o, rt.pg.scratch, 0); r.pushPendingRow(rt.N + p, rt.pg.scratch, 0) }
          if (bd && bd.length === rows.data.length) r.pushPendingBearing(p, bd, o)
          else { const tac = tacRef.current, c = rt.pendingCfgs[p]; fillLineBearings(rt.pg.brgRow, c, tac?.buoys.find((x) => x.channel === c.channel), tac?.bearings); r.pushPendingBearing(p, rt.pg.brgRow, 0) }
          continue
        }
        if (rows.data.length !== n * rt.g.bins) continue // another pane's streams (different bin count)
        const b = rt.g.bins, o = k * b
        const prep = preprocessRef.current
        if (prep) {
          // DEMON (etc.): clamp+whiten into scratch, push as the raw ring that normalized={false} draws.
          prep(rows.data, o, rt.g.scratch, 0)
          r.pushRow(s, rt.g.scratch, 0); rt.level.update(s, rt.g.scratch, 0, b)
          if (s === rt.histStream) rt.hist.push(rt.g.scratch, 0)
        } else {
          r.pushRow(s, rows.data, o); rt.level.update(s, rows.data, o, b)
          if (s === rt.histStream) rt.hist.push(rows.data, o)
          // RES grams arrive engine-filtered (NB = TPSW), so the display normalizer only runs on band/legacy grams.
          if (!rt.g.filtered) { rt.g.norm.apply(rows.data, o, rt.g.scratch, 0); r.pushRow(rt.N + s, rt.g.scratch, 0) }
        }
        // Bearing ring stays row-aligned with the power ring (NaN rows for omni buoys).
        // Engine per-bin bearings when streamed; else interim colouring from the tracked line bearings.
        if (bd && bd.length === rows.data.length) {
          r.pushBearing(s, bd, o)
          if (s === rt.histStream) rt.brgHist.push(bd, o)
        } else {
          const tac = tacRef.current, c = liveRef.current[s]
          fillLineBearings(rt.g.brgRow, c, tac?.buoys.find((x) => x.channel === c.channel), tac?.bearings)
          r.pushBearing(s, rt.g.brgRow, 0)
          if (s === rt.histStream) rt.brgHist.push(rt.g.brgRow, 0)
        }
      }
      rt.dirty = true
    })
    const offDrain = client.onDrainProgress((ev) => {
      const s = rt.live.get(ev.streamId)
      if (s === undefined) return
      if (rt.drainHandle !== ev.handleId) {
        r.beginFilling(s, ev.totalRows)
        rt.hist.seedFilling(ev.totalRows)
        rt.drainHandle = ev.handleId
        rt.fillApplied = fillReqRef.current
      }
      r.applyLanded(s, ev)
      if (s === rt.histStream) {
        const lo = ev.fromRow, bins = ev.bins
        for (let k = ev.fromRow; k <= ev.toRow; k++) {
          if (k < ev.filledFrom) continue
          rt.hist.writeAge(ev.totalRows - 1 - k, ev.data, (k - lo) * bins)
        }
      }
      rt.dirty = true
    })
    growRef.current = (cs: GramConfig[]) => {
      const old = rt.N, n = cs.length
      if (n <= old || cs[0]?.bins !== rt.g.bins) return
      // Raw rings 0..N-1 (+ normalized N..2N-1 on band/legacy grams): keep each old ring, add empty ones.
      const order: number[] = []
      for (let i = 0; i < n; i++) order.push(i < old ? i : -1)
      if (!rt.g.filtered) for (let i = 0; i < n; i++) order.push(i < old ? old + i : -1)
      r.addStreams(order, n)
      rt.N = n; rt.level = rt.level.resized(n)
      cs.forEach((c, i) => rt.live.set(c.streamId, i))
      // A handoff in flight re-announces at the new size; pick it up if it already has.
      rt.pending = new Map(); rt.pendingCfgs = []; rt.pg = rt.g
      const pc = client.pendingConfigs()
      if (pc && pc.length === rt.N && pc[0]?.bins) startPending(pc)
      rt.dirty = true
    }
    if (growTo.current && growTo.current.length > rt.N) growRef.current(growTo.current)
    growTo.current = null
    const ro = new ResizeObserver(() => { rt.dirty = true; setWidth(canvas.clientWidth); setHeight(canvas.clientHeight) })
    ro.observe(canvas)
    const frame = () => {
      if (fillReqRef.current !== rt.fillApplied) {
        rt.fillApplied = fillReqRef.current
        const n = HISTORY_ROWS
        for (let s = 0; s < rt.N; s++) r.beginFilling(s, n)
        rt.hist.seedFilling(n)
        rt.dirty = true
      }
      const { view: pv, streamIndex: s, cfg: pc, auto: a, normalized: nz, palette: pal, mode: md, contrast: k } = viewRef.current
      // Just promoted, React not caught up yet: draw the new stream over its full band (allocates for ≤ 2 frames).
      const live = liveRef.current[s] ?? liveRef.current[0], c = live ?? pc
      const v = live && pc && live.streamId !== pc.streamId ? fullView(live) : pv
      const key = `${v.lo},${v.hi},${s},${a},${nz},${pal},${md},${c?.streamId},${c?.dbFloor},${c?.dbCeil},${k},${wheelTickRef.current}`
      if ((rt.dirty || key !== rt.lastKey) && c) {
        const fl = rt.level.get(s), useAuto = a && Number.isFinite(fl)
        const dbFloor = useAuto ? fl - AUTO_BELOW_DB : c.dbFloor, dbCeil = useAuto ? fl - AUTO_BELOW_DB + AUTO_SPAN_DB : c.dbCeil
        const range = { binLo: (v.lo - c.f0) / c.fBin, binHi: (v.hi - c.f0) / c.fBin }
        const difar = md === 'difar' ? s : undefined
        // RES grams: the colour scale comes only from gramConfig (NB 0–30 dB, BB 40–110 dB).
        if (c.res !== undefined) r.draw(s, { ...range, ...contrastRange(c.dbFloor, c.dbCeil, k) }, difar)
        else if (nz) r.draw(rt.N + s, { ...range, ...contrastRange(NORM_FLOOR_DB, NORM_CEIL_DB, k) }, difar)
        else r.draw(s, { ...range, ...contrastRange(dbFloor, dbCeil, k) }, difar)
        rt.dirty = false; rt.lastKey = key
      }
      rt.raf = requestAnimationFrame(frame)
    }
    rt.raf = requestAnimationFrame(frame)
    // iOS may drop the context while backgrounded and never fire 'restored'; rebuild on return if still lost.
    const checkLost = () => {
      if (document.visibilityState !== 'visible' || !r.isLost()) return
      clearTimeout(rt.lostTimer)
      rt.lostTimer = window.setTimeout(() => { if (r.isLost()) setGlGen((gen) => gen + 1) }, 1000)
    }
    const onLost = () => { if (document.visibilityState === 'visible') checkLost() }
    document.addEventListener('visibilitychange', checkLost); canvas.addEventListener('webglcontextlost', onLost)
    const onShow = () => { rt.dirty = true }
    window.addEventListener('pageshow', onShow)
    return () => {
      cancelAnimationFrame(rt.raf); clearTimeout(rt.lostTimer); off(); offDrain(); offSeek(); offHandoff(); ro.disconnect()
      document.removeEventListener('visibilitychange', checkLost); canvas.removeEventListener('webglcontextlost', onLost); window.removeEventListener('pageshow', onShow)
      r.dispose(); rendererRef.current = null; histRef.current = null; brgHistRef.current = null
      if (bearingAtRef) bearingAtRef.current = null
      if (rowSamplerRef) rowSamplerRef.current = null
      growRef.current = null
    }
  }, [client, hasConfigs, rendererKey, HISTORY_ROWS, bearingAtRef, rowSamplerRef])

  useLayoutEffect(() => { const cs = growTo.current; if (cs && growRef.current) { growTo.current = null; growRef.current(cs) } }, [configs])

  // Palette swap: one LUT upload on the live renderer (runs after a renderer is (re)created); the frame loop redraws on key change.
  useEffect(() => { rendererRef.current?.setPalette(palette) }, [palette, rendererKey, client])
  useEffect(() => { rendererRef.current?.setFlip(newestAtBottom(dir)) }, [dir, rendererKey, client])
  useEffect(() => {
    if (!wheel) return
    rendererRef.current?.setWheel(wheel)
    wheelTickRef.current += 1
  }, [wheel, rendererKey, client])

  const ticks = useMemo(() => niceTicks(view.lo, view.hi, Math.max(3, Math.floor(width / 90))), [view, width])
  const freqLabels = useMemo(() => placeFreqAxisTicks(ticks, view, width, unit), [ticks, view, width, unit])
  const historyS = HISTORY_ROWS / rowRate
  const timeTicks = useMemo(() => timeTickAges(historyS, height), [historyS, height])
  // Stable fallback when the parent omits zuluOriginMs (e.g. DemonPane). App/Cuts always pass the prop.
  const [zuluFallback] = useState(() => Date.now() - nowS * 1000)
  const zuluOrigin = zuluOriginMs ?? zuluFallback

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const anchor = xToFreq(e.clientX - rect.left, view, rect.width)
    onView(zoomView(view, anchor, e.deltaY < 0 ? 1.25 : 0.8, fMax, minSpan, fMin))
  }
  // Pointer gestures (mouse, pen, touch).
  // One finger: cursor sits EXACTLY under the finger while free; tap anchors / releases; long-press crosshair; double-tap full band.
  // Two fingers: pinch (bandwidth) vs pan (Hz; vertical scroll-back when paused) — disambiguated by distance vs centroid.
  // Three fingers: swipe down while anchored → lock (visible lock button too).
  type P = { id: number; x: number; y: number; x0: number; y0: number; t0: number; type: string }
  const ptr = useRef(new Map<number, P>())
  const g = useRef({
    pinch: null as null | { v: FreqView; a0: number; b0: number; ax0: number; ay0: number; bx0: number; by0: number },
    twoKind: 'undecided' as 'pinch' | 'pan' | 'undecided',
    panAxis: null as PanAxis | null,
    panStart: null as null | { v: FreqView; cx: number; cy: number; scroll0: number },
    threeStartYs: null as number[] | null,
    dragging: false, moved: false, longFired: false, longTimer: 0,
    lastTap: { t: 0, x: 0, y: 0, holdBefore: 'free' as CursorHold },
    /** Cursor Hz before this gesture — restored on an anchor/lock tap so the tap point never jumps the cursor. */
    hzAtDown: null as number | null,
    holdAtDown: 'free' as CursorHold,
    /** dragLockable captured at pointerdown — ignore mid-gesture re-renders after a place. */
    dragLockableAtDown: false,
  })
  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    // Finger-exact: no touch offset — hairline under the contact.
    const pt = fingerExactCursor(e.clientX - r.left, e.clientY - r.top)
    return { x: pt.x, y: pt.y, w: r.width, h: r.height }
  }
  const displayNow = viewNowS(nowS, scrollBackS)
  const ago = (y: number, h: number) => agoFromY(y, h, historyS, dir) + scrollBackS
  const showAt = (x: number, y: number, w: number, h: number, withCross: boolean) => {
    // Clamp to the configured band so off-canvas pointers never show negative Hz.
    const hz = Math.max(fMin, Math.min(fMax, xToFreq(x, view, w)))
    const agoS = ago(y, h)
    const next = horzAtPointer({ x, y, w, h, hzAtX: hz, agoS, horz, locked: cursorLocked, cursorHz: cursorRef.current })
    setFingerHz(next.fingerHz)
    if (next.hoverAgo !== null) setHoverAgo(next.hoverAgo)
    if (!cursorLocked) { setCursor(next.cursorHz); onCursorHz?.(next.cursorHz) }
    if (withCross) {
      const hist = histRef.current
      // Crosshair dB stays on the hairline Hz when locked; the live readout uses finger x for Hz.
      const sampleHz = cursorLocked && cursorRef.current !== null ? cursorRef.current : hz
      const db = hist && cfg ? hist.at(agoS * rowRate, (sampleHz - cfg.f0) / fBin) : NaN
      setCross({ hz: sampleHz, agoS, x, db })
    }
  }
  // Live cross dB: as nowS advances (App re-renders on new rows), re-sample hist under the
  // fixed (hz, agoS) hairline. Same cell-under-finger behaviour as the old render-time histRef
  // read, without touching refs during render. Bail out with the same state object when unchanged
  // so we allocate and re-render only when the dB value actually moves.
  useEffect(() => {
    setCross((c) => {
      if (!c || !cfg) return c
      const hist = histRef.current
      const db = hist ? hist.at(c.agoS * rowRate, (c.hz - cfg.f0) / fBin) : NaN
      if (Object.is(db, c.db)) return c
      return { hz: c.hz, agoS: c.agoS, x: c.x, db }
    })
  }, [nowS, cfg, rowRate, fBin])
  const restorePreGestureCursor = () => {
    const hz = g.current.hzAtDown
    setCursor(hz); onCursorHz?.(hz)
    if (hz === null) setHoverAgo(null)
  }
  const applyHoldTap = () => {
    // Restore first so an anchor tap never commits the tap-point Hz.
    restorePreGestureCursor()
    const hz = g.current.hzAtDown
    const next = nextHoldOnTap(cursorHold)
    if (next === 'anchored' && hz === null) return // nothing to anchor
    setCursorHold(next)
    if (cursorHold === 'free' && hz !== null) onSelectHz?.(hz)
  }
  const onLockBtn = () => {
    setCursorHold((h) => toggleLockButton(h, cursorRef.current !== null))
  }
  const onPDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic or already-released pointer */ }
    const { x, y, w, h } = local(e), G = g.current
    ptr.current.set(e.pointerId, { id: e.pointerId, x, y, x0: x, y0: y, t0: e.timeStamp, type: e.pointerType })
    clearTimeout(G.longTimer)
    if (ptr.current.size === 3) {
      // Three-finger: track Ys for swipe-down lock; cancel pinch/pan.
      G.pinch = null; G.panStart = null; G.twoKind = 'undecided'; G.panAxis = null
      G.threeStartYs = [...ptr.current.values()].map((p) => p.y)
      G.moved = true; setPressHint(false); return
    }
    if (ptr.current.size === 2) {
      if (G.dragging) { G.dragging = false; const p0 = [...ptr.current.values()][0]; onDragPoint?.('end', xToFreq(p0.x, view, w), ago(p0.y, h), false) }
      const [a, b] = [...ptr.current.values()]
      G.pinch = { v: view, a0: a.x, b0: b.x, ax0: a.x, ay0: a.y, bx0: b.x, by0: b.y }
      G.panStart = { v: view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, scroll0: scrollBackS }
      G.twoKind = 'undecided'; G.panAxis = null
      G.threeStartYs = null
      G.moved = true; setPressHint(false); return
    }
    if (ptr.current.size > 3) return
    G.moved = false; G.longFired = false; G.pinch = null; G.panStart = null; G.twoKind = 'undecided'; G.panAxis = null; G.threeStartYs = null
    G.hzAtDown = cursorRef.current
    G.holdAtDown = cursorHold
    G.dragLockableAtDown = dragLockable
    setCross(null)
    if (onDragPoint && !dragLocked) { G.dragging = true; onDragPoint('start', xToFreq(x, view, w), ago(y, h), e.shiftKey) }
    else G.dragging = false
    if (e.pointerType !== 'mouse') {
      // Touch drag (and a locked hairline): showAt updates finger Hz and HORZ ago; locked Hz stays put.
      showAt(x, y, w, h, false)
      setPressHint(true)
      G.longTimer = window.setTimeout(() => {
        const p = ptr.current.get(e.pointerId); if (!p || G.moved || ptr.current.size !== 1) return
        G.longFired = true; setPressHint(false)
        if (cursorLocked) {
          const hist = histRef.current
          const hz = cursorRef.current
          if (hz !== null) {
            const agoS = ago(p.y, h)
            const db = hist && cfg ? hist.at(agoS * rowRate, (hz - cfg.f0) / fBin) : NaN
            setCross({ hz, agoS, x: p.x, db })
          }
        } else showAt(p.x, p.y, w, h, true)
      }, LONG_PRESS_MS)
    }
  }
  const onPMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y, w, h } = local(e), G = g.current, p = ptr.current.get(e.pointerId)
    if (!p) {
      if (e.pointerType === 'mouse' && !cursorLocked) showAt(x, y, w, h, false)
      return
    }
    p.x = x; p.y = y
    if (ptr.current.size >= 3 && G.threeStartYs) {
      const ys = [...ptr.current.values()].map((q) => q.y)
      if (isThreeFingerSwipeDown(G.threeStartYs, ys)) {
        setCursorHold((h0) => holdAfterThreeFingerSwipe(h0, true))
        G.threeStartYs = null
      }
      return
    }
    if (ptr.current.size >= 2 && (G.pinch || G.panStart)) {
      const [a, b] = [...ptr.current.values()]
      if (G.twoKind === 'undecided' && G.pinch) {
        G.twoKind = classifyTwoFinger(
          { x: G.pinch.ax0, y: G.pinch.ay0 }, { x: G.pinch.bx0, y: G.pinch.by0 },
          { x: a.x, y: a.y }, { x: b.x, y: b.y },
        )
      }
      if (G.twoKind === 'pinch' && G.pinch) {
        onView(pinchView(G.pinch.v, G.pinch.a0, G.pinch.b0, a.x, b.x, w, fMax, minSpan, fMin)); return
      }
      if (G.twoKind === 'pan' && G.panStart) {
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
        const dx = cx - G.panStart.cx, dy = cy - G.panStart.cy
        // Lock to frequency or time on the first decisive movement; hold until the fingers lift.
        const r = applyTwoFingerPan({
          axis: G.panAxis, dx, dy, paused: paused && !!onScrollBack,
          startView: G.panStart.v, width: w, fMax, minSpan, fMin,
          scroll0: G.panStart.scroll0, height: h, visibleHistoryS: historyS,
          sign: newestAtBottom(dir) ? 1 : -1,
        })
        G.panAxis = r.axis
        if (r.axis === 'frequency') onView(r.view)
        else if (r.axis === 'time' && paused && onScrollBack) onScrollBack(r.scrollBackS)
        return
      }
      // Undecided: wait for a clearer signal.
      return
    }
    if (!G.moved && exceedsSlop(p.x0, p.y0, x, y)) { G.moved = true; clearTimeout(G.longTimer); setPressHint(false) }
    if (G.dragging && G.moved && !dragLocked) onDragPoint?.('move', xToFreq(x, view, w), ago(y, h), e.shiftKey)
    // Free or locked, mouse or touch: HORZ follows y, Hz readout follows x; locked hairline stays.
    showAt(x, y, w, h, G.longFired)
  }
  const onPUp = (e: React.PointerEvent<HTMLCanvasElement>, cancel = false) => {
    const { x, y, w, h } = local(e), G = g.current, p = ptr.current.get(e.pointerId)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    ptr.current.delete(e.pointerId); clearTimeout(G.longTimer); setPressHint(false)
    if (!ptr.current.size) setFingerHz(null)
    if (!p) return
    if (G.threeStartYs) { if (ptr.current.size < 3) G.threeStartYs = null; return }
    if (G.pinch || G.panStart) {
      if (ptr.current.size < 2) { G.pinch = null; G.panStart = null; G.twoKind = 'undecided'; G.panAxis = null }
      return
    }
    const dt = e.timeStamp - p.t0
    const tap = !cancel && !G.moved && !G.longFired && isLockTap(x - p.x0, y - p.y0, dt)
    if (G.dragging) {
      G.dragging = false
      if (tap && G.dragLockableAtDown && onDragLockTap) {
        onDragPoint?.('end', xToFreq(x, view, w), ago(y, h), e.shiftKey)
        onDragLockTap()
        return
      }
      onDragPoint?.('end', xToFreq(x, view, w), ago(y, h), e.shiftKey)
      if (G.moved && !cursorLocked && !onPickPoint && cursorRef.current !== null) onSelectHz?.(cursorRef.current)
      return
    }
    if (tap && (dragLocked || G.dragLockableAtDown) && onDragLockTap) { onDragLockTap(); return }
    if (cancel || G.moved || G.longFired) return
    const hz = Math.max(fMin, Math.min(fMax, xToFreq(x, view, w))), lt = G.lastTap
    if (p.type !== 'mouse' && e.timeStamp - lt.t < DOUBLE_TAP_MS && !exceedsSlop(lt.x, lt.y, x, y, 24)) {
      G.lastTap = { t: 0, x: 0, y: 0, holdBefore: 'free' }
      if (!onPickPoint && !dragLockable) setCursorHold(lt.holdBefore)
      restorePreGestureCursor()
      onView(full()); return
    }
    if (onPickPoint) { G.lastTap = { t: e.timeStamp, x, y, holdBefore: G.holdAtDown }; onPickPoint(hz, ago(y, h)); return }
    if (tap || isLockTap(x - p.x0, y - p.y0, dt)) {
      G.lastTap = { t: e.timeStamp, x, y, holdBefore: G.holdAtDown }
      applyHoldTap(); return
    }
    G.lastTap = { t: e.timeStamp, x, y, holdBefore: G.holdAtDown }
    onSelectHz?.(hz)
  }

  const selLabelText = selectedHz !== null ? selectedHz.toFixed(fBin < 0.1 ? 2 : 1) : ''
  const liveHz = readoutHz(fingerHz, cursor)
  const horzTime = (ago: number) => horzSimS({ ageS: ago, periodS: 1 / rowRate, rowPhaseS: cfg?.rowPhaseS, simTime: nowS })
  const horzZuluText = horz && hoverAgo !== null ? horzZulu(horzTime(hoverAgo), zuluOrigin, scrollBackS) : null
  const liveText = liveReadout({
    hz: liveHz, fBin, f0: cfg?.f0 ?? 0, unit, horzZulu: horzZuluText,
    crosshair: !!cross, db: cross && Number.isFinite(cross.db) ? cross.db : (cross ? null : undefined),
    suffix: cursorSuffix ?? '',
  })
  const cursorReadoutText = cross ? null : liveText
  useLayoutEffect(() => {
    // Measure the live top-left readout so the sel-marker label clears real glyphs (FOCUS etc.).
    const gEl = gramBoxRef.current, rEl = readoutElRef.current
    if (!gEl || !rEl || cross) { setReadoutBox(null); return }
    const gb = gEl.getBoundingClientRect(), rb = rEl.getBoundingClientRect()
    setReadoutBox({ x: rb.left - gb.left, y: rb.top - gb.top, w: rb.width, h: rb.height })
  }, [cursorReadoutText, cross, width, height, selectedHz, cursorSuffix])
  const selPlace = (() => {
    if (selectedHz === null || selectedHz < view.lo || selectedHz > view.hi) return null
    const size = estimateSelLabelSize(selLabelText)
    const markerX = freqToX(selectedHz, view, width)
    // Prefer the measured box; fall back to a text estimate before the first layout pass.
    const readout = readoutBox ?? estimateCursorReadout(cursorReadoutText)
    return { markerX, ...placeSelMarkerLabel({ markerX, gramW: width, labelW: size.w, labelH: size.h, readout }) }
  })()

  const crossText = liveText ?? ''

  return (
    <div className="gram" ref={gramBoxRef} data-testid={`${testId}-frame`} data-dir={dir} data-cursor-hold={cursorHold} data-cursor-locked={cursorLocked ? '1' : '0'} data-drag-locked={dragLocked ? '1' : '0'} data-drag-lockable={dragLockable ? '1' : '0'} data-paused={paused ? '1' : '0'} data-reviewing={isReviewing(scrollBackS) ? '1' : '0'}>
      {glError ? <div className="gl-error">{glError}</div> : (
        <canvas key={glGen} ref={canvasRef} data-testid={testId} onWheel={onWheel}
          onPointerDown={onPDown} onPointerMove={onPMove} onPointerUp={(e) => onPUp(e)} onPointerCancel={(e) => onPUp(e, true)}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !ptr.current.size && !cursorLocked) { setCursor(null); setCross(null); setHoverAgo(null); setFingerHz(null); onCursorHz?.(null) } }}
          onContextMenu={(e) => e.preventDefault()}
          className={pressHint ? 'pressing' : undefined}
          style={{ touchAction: 'none', cursor: onPickPoint ? 'crosshair' : onDragPoint ? 'ew-resize' : undefined }}
          onDoubleClick={() => onView(full())} aria-label={label} />
      )}
      {cfg && <div key={rendererKey} className="gram-veil" aria-hidden />}
      {handoff && <div className={`handoff-badge${handoff.active ? ' on' : ''}`} data-testid={`${testId}-handoff`} data-active={handoff.active ? '1' : '0'} aria-live="polite">{handoff.label}</div>}
      {limitHz !== null && freqToX(limitHz, view, width) < width && (
        <div className="band-limit" data-testid={`${testId}-band-limit`} style={{ left: Math.max(0, freqToX(limitHz, view, width)), width: width - Math.max(0, freqToX(limitHz, view, width)) }}
          title={`Above ${limitHz.toFixed(0)} Hz is past the simulated band`}><span>BAND LIMIT</span></div>
      )}
      <div className="axis axis-y" data-testid={`${testId}-time-axis`} data-dir={dir} aria-hidden>
        {timeTicks.map((t) => {
          const top = pctFromAgo(t, historyS, dir)
          const sim = displayNow - t
          const label = t < 1e-6
            ? (isReviewing(scrollBackS) ? formatZuluHms(sim, zuluOrigin) : 'now')
            : (isReviewing(scrollBackS) ? formatZuluHms(sim, zuluOrigin) : formatZulu(sim, zuluOrigin))
          return <span key={t} style={{ top: `clamp(${AXIS_Y_EDGE_CLAMP_PX}px, ${top}%, calc(100% - ${AXIS_Y_EDGE_CLAMP_PX}px)` }}>{label}</span>
        })}
      </div>
      <div className="axis axis-x" data-testid={`${testId}-freq-axis`} role="slider" aria-label="Frequency axis · tap to center"
        aria-valuemin={fMin} aria-valuemax={fMax} aria-valuenow={selectedHz ?? (view.lo + view.hi) / 2}
        title={onCenterFreq ? 'Tap or click to center on this frequency' : undefined}
        onPointerDown={(e) => {
          if (!onCenterFreq) return
          // Prevent the canvas above from seeing this as a scrub; still fire center.
          e.preventDefault(); e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          onCenterFreq(xToFreq(e.clientX - rect.left, view, rect.width))
        }}
        onClick={(e) => {
          if (!onCenterFreq) return
          const rect = e.currentTarget.getBoundingClientRect()
          onCenterFreq(xToFreq(e.clientX - rect.left, view, rect.width))
        }}>
        {freqLabels.map((t) => (
          <span key={t.f} style={{ left: t.left }}>
            <i className="tick-x" style={{ left: '50%', top: -6 }} />{t.label}
          </span>
        ))}
      </div>
      <div />
      {selPlace && (
        <div className="sel-marker" data-testid={`${testId}-sel-marker`} style={{ left: selPlace.markerX }} aria-hidden>
          <span
            data-testid={`${testId}-sel-label`}
            data-side={selPlace.side}
            style={selPlace.side === 'right'
              ? { top: selPlace.top, left: 8, right: 'auto' }
              : { top: selPlace.top, right: 8, left: 'auto' }}
          >{selLabelText}</span>
        </div>
      )}
      {cfg && overlay && <div className="gram-layer" style={{ width }}>{overlay({ view, width, cfg, historyS, dir })}</div>}
      {horz && hoverAgo !== null && (
        <div className="horz-layer" aria-hidden data-testid={`${testId}-horz`} style={{ top: `calc((100% - 44px) * ${(pctFromAgo(hoverAgo, historyS, dir) / 100).toFixed(5)})` }}>
          <i className="horz-line" /><span className="horz-zulu" data-testid={`${testId}-horz-zulu`}>{horzZulu(horzTime(hoverAgo), zuluOrigin, scrollBackS)}</span>
        </div>
      )}
      {ali && mode !== 'demon' && cfg && histRef.current && (() => {
        const band = normalized
          ? contrastRange(NORM_FLOOR_DB, NORM_CEIL_DB, contrast)
          : contrastRange(cfg.dbFloor ?? 40, cfg.dbCeil ?? 110, contrast)
        return (
          <AliStripView
            hist={histRef.current!}
            rowRateHz={rowRateHz(cfg, undefined, 0.5)}
            dir={dir ?? 'bottom'}
            palette={palette}
            floor={band.dbFloor}
            ceil={band.dbCeil}
            f0={cfg.f0 ?? 0}
            fBin={cfg.fBin ?? 1}
            fLo={view.lo}
            fHi={view.hi}
            testId={`${testId}-ali`}
          />
        )
      })()}
      {cross && (
        <div className="gram-layer cross-layer" style={{ width }} aria-hidden>
          <div className="cross-h" style={{ top: `${pctFromAgo(cross.agoS, historyS, dir)}%` }} />
          <div className="cross-v" style={{ left: cross.x }} />
        </div>
      )}
      {liveText && (cross
        ? <div className="cursor-readout cross-readout" data-testid={`${testId}-cross`}>{liveText}</div>
        : <div className={`cursor-readout${cursorHold !== 'free' ? ' held' : ''}${showLockIcon(cursorHold) ? ' locked' : ''}`} ref={readoutElRef} data-testid={`${testId}-cursor`} data-hold={cursorHold} data-locked={showLockIcon(cursorHold) ? '1' : '0'}>{showLockIcon(cursorHold) && <IcLock size={11} className="cursor-lock-ic" />}<span>{liveText}</span></div>)}
      <button type="button" className={`cursor-lock-btn${showLockIcon(cursorHold) ? ' on' : ''}`} data-testid={`${testId}-lock-btn`}
        aria-pressed={showLockIcon(cursorHold)} aria-label={showLockIcon(cursorHold) ? 'Unlock cursor' : 'Lock cursor'}
        title={showLockIcon(cursorHold) ? 'Unlock' : 'Lock (or three-finger swipe down while anchored)'}
        onPointerDown={(e) => { e.stopPropagation() }}
        onClick={(e) => { e.stopPropagation(); onLockBtn() }}>
        <IcLock size={14} />
      </button>
      {isReviewing(scrollBackS) && (
        <div className="scrollback-bar" data-testid={`${testId}-scrollback`}>
          <span className="scrollback-zulu" data-testid={`${testId}-scrollback-zulu`}>{formatZuluHms(displayNow, zuluOrigin)}</span>
          <button type="button" className="btn scrollback-live" data-testid={`${testId}-return-live`}
            onClick={() => { onReturnToLive?.(); onScrollBack?.(returnToLive()) }}>Return to Live</button>
        </div>
      )}
    </div>
  )
}
