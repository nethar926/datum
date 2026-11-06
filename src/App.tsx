import { TruthPanel } from './gram/TruthPanel'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Compendium } from './compendium/Compendium'
import { SimClient } from './engine/client'
import type { Band } from './engine/contract'
import { Gram } from './gram/Gram'
// DemonPane (src/gram/DemonPane.tsx) is kept but off the display layout for now.
import { isGramMode, type GramMode } from './gram/difarBearing'
import { DifarLegend } from './gram/DifarLegend'
import { DifarApplet } from './gram/DifarApplet'
import { loadWheel, saveWheel } from './gram/wheelSettings'
import type { DifarWheelSettings } from './gl/colormap'
import { NewScenario } from './settings/NewScenario'
import { SeedChip } from './settings/SeedChip'
import { TrafficSlider } from './settings/TrafficSlider'
import { LloydsOverlay, lloydText, useLloydDrag, type CpaGeom, type LloydState } from './gram/LloydsOverlay'
import { DopplerOverlay, DopplerReadout } from './gram/DopplerOverlay'
import { RulerStore } from './gram/dopplerRuler'
import { acousticsV11 } from './scenarios/acousticsApi'
import { clampView, type FreqView } from './gram/axis'
import { RES_MAX, RES_MIN, clampRes, fullView, geometryKey, minSpanOf, resReadout, vernierLabel } from './gram/res'
import type { GramFilter, GramSettings, LofarBandPresetId } from './engine/contract'
import { BAND_IDS, BAND_KEY, bandEdges, bandReadout, isBandId, parseBandChoice } from './gram/bands'
import { TacticalPlot } from './tactical/TacticalPlot'
import { DropBar } from './tactical/DropBar'
import { DropController } from './tactical/dropController'
import { dropCapturesPlot } from './tactical/fieldMode'
import { bearingTo, type FixSource, type ManualBearings } from './tactical/manual'
import { OperatorLog } from './log/operatorLog'
import { SCENARIOS, SCENARIO_LABEL } from './scenarios/training'
import { harmText, harmonicSeries, nearestHarmonic, ratioText } from './gram/harmonics'
import { familyFundamentals, familyLabel, snapToFamily, truthEdaName } from './gram/truthFamilies'
import { freqToX } from './gram/axis'
import { CONTRAST_DEFAULT, CONTRAST_KEY, CONTRAST_MAX, CONTRAST_MIN, CONTRAST_STEP, clampContrast, loadContrast } from './gram/contrast'
import { ctrLabel, parseHz, planCenter } from './gram/center'
import { ARM_IDLE, armLabel, cancelArm, isArmed, isPickFreq, pickBuoy, toggleArm, togglePickFreq, type BearingArm } from './tactical/bearingArm'
import { OMNI_BRG_MSG, NO_BRG_MSG, formatBrgHud, bearingFromTracked } from './gram/brgFreq'
import { PALETTE_IDS, isPaletteId, type PaletteId } from './gl/colormap'
import { useLayout } from './touch/useLayout'
import { Sheet } from './touch/Sheet'
import { installAudioUnlock } from './touch/audioUnlock'

const RATES = [1, 4, 16]
const GRAM_MODE_KEY = 'datum.gramMode'
const GRAM_KEY = 'datum.gram'
/** Saved band picker (datum.band: last preset, default LF, and whether the band gram is on); ?band=ELF|…|off overrides. */
const loadBand = () => {
  let b = parseBandChoice(null)
  try { b = parseBandChoice(localStorage.getItem(BAND_KEY)) } catch { /* private mode */ }
  const qb = new URLSearchParams(location.search).get('band')?.toUpperCase()
  if (isBandId(qb)) b = { preset: qb, on: true }
  else if (qb === 'OFF' || qb === 'RES') b = { ...b, on: false }
  return b
}
/** Saved RES level and NB/BB filter (default RES 5, NB) plus the band gram when on; ?res= / ?filter= override (?res= means RES on). */
const loadGram = (): GramSettings => {
  let res = 5, filter: GramFilter = 'NB'
  try { const v = JSON.parse(localStorage.getItem(GRAM_KEY) ?? 'null'); if (v && Number.isFinite(v.res)) res = clampRes(v.res); if (v?.filter === 'BB' || v?.filter === 'NB') filter = v.filter } catch { /* private mode */ }
  const q = new URLSearchParams(location.search), qr = Number(q.get('res')), qf = q.get('filter')?.toUpperCase()
  if (q.has('res') && Number.isFinite(qr)) res = clampRes(qr)
  if (qf === 'NB' || qf === 'BB') filter = qf
  const b = loadBand()
  return b.on && !(q.has('res') && !q.has('band')) ? { res, filter, band: b.preset } : { res, filter }
}
const loadGramMode = (): GramMode => { try { const v = localStorage.getItem(GRAM_MODE_KEY); return isGramMode(v) ? v : 'lofar' } catch { return 'lofar' } }
const BAND_MAX: Record<Band, number> = { lofar1k: 1000, lofar2k: 2000 }
const fmtT = (s: number) => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` }

const PALETTE_LABEL: Record<PaletteId, string> = { green: 'Green', amber: 'Amber', red: 'Red' }
const PALETTE_KEY = 'datum.palette'
const loadPalette = (): PaletteId => { try { const u = new URLSearchParams(location.search).get('palette'); if (isPaletteId(u)) return u; const v = localStorage.getItem(PALETTE_KEY); return isPaletteId(v) ? v : 'green' } catch { return 'green' } }

export default function App() {
  const client = useMemo(() => new SimClient(), [])
  const st = useSyncExternalStore(client.subscribe, client.getStatus)
  const [stream, setStream] = useState(0)
  const [view, setView] = useState<FreqView>({ lo: 0, hi: 1000 })
  const [truth, setTruth] = useState(false)
  const [vernierPick, setVernierPick] = useState(false)
  // LOFAR phosphor: green (default), amber or red. Amplitude only, no hue coding. DIFAR ignores it (bearing wheel).
  const [palette, setPalette] = useState<PaletteId>(loadPalette)
  const [contrast, setContrast] = useState<number>(loadContrast)
  const [wheel, setWheel] = useState<DifarWheelSettings>(loadWheel)
  const [wheelOpen, setWheelOpen] = useState(false)
  useEffect(() => { saveWheel(wheel) }, [wheel])
  useEffect(() => { try { localStorage.setItem(CONTRAST_KEY, String(contrast)) } catch { /* private mode */ } }, [contrast])
  useEffect(() => { try { localStorage.setItem(PALETTE_KEY, palette) } catch { /* private mode */ } }, [palette])
  const [gramMode, setGramMode] = useState<GramMode>(loadGramMode)
  useEffect(() => { try { localStorage.setItem(GRAM_MODE_KEY, gramMode) } catch { /* private mode */ } }, [gramMode])
  const [allBearings, setAllBearings] = useState(false)
  const [showAuto, setShowAuto] = useState(true)
  const [showManual, setShowManual] = useState(true)
  const [fixSource, setFixSource] = useState<FixSource>('both')
  const [manual, setManual] = useState<ManualBearings>({})
  const log = useMemo(() => new OperatorLog(), [])
  const drop = useMemo(() => new DropController(), [])
  const logCount = useSyncExternalStore(log.subscribe, log.size)
  const onManual = (buoyId: number, deg: number | null, final: boolean) => {
    setManual((m) => { const n = { ...m }; if (deg === null) delete n[buoyId]; else n[buoyId] = deg; return n })
    if (final) log.add({ simT: client.status.simT, kind: 'bearing', buoyId, data: deg === null ? { source: 'manual', cleared: true } : { source: 'manual', brgDeg: Math.round(deg * 10) / 10 } })
  }
  const [selHz, setSelHz] = useState<number | null>(null)
  const [cursorHz, setCursorHz] = useState<number | null>(null)
  const [ctrFlash, setCtrFlash] = useState<number | null>(null)
  const ctrTimer = useRef(0)
  const [brgFlash, setBrgFlash] = useState<string | null>(null)
  const brgTimer = useRef(0)
  const bearingAtRef = useRef<((hz: number) => number | null) | null>(null)
  const [hzField, setHzField] = useState('')
  const [brgArm, setBrgArm] = useState<BearingArm>(ARM_IDLE)
  const [harmProbeOn, setHarmProbeOn] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCmp, setShowCmp] = useState(false)
  const layout = useLayout(), phone = layout !== 'wide'
  const [menuOpen, setMenuOpen] = useState(false)
  const [tacOpen, setTacOpen] = useState(false)
  const [truthSheet, setTruthSheet] = useState(false)
  useEffect(() => { if (!phone) { setMenuOpen(false); setTruthSheet(false) } if (layout !== 'phoneLandscape') setTacOpen(false) }, [layout, phone])
  useEffect(() => installAudioUnlock(), [])
  const [tool, setTool] = useState<'select' | 'dop' | 'lm' | 'harm'>('select')
  const [crossOn, setCrossOn] = useState(false)
  const [harmF0, setHarmF0] = useState<number | null>(null)
  const [harmK, setHarmK] = useState<number | null>(null)
  const [harmFam, setHarmFam] = useState<string | null>(null)
  const harmGrab = useRef<number | null>(null)
  const [harmProbe, setHarmProbe] = useState<number | null>(null)
  const harmDrag = (phase: 'start' | 'move' | 'end', hz: number, _ago = 0, shift = false) => {
    // Shift-click (or PROBE toggle on touch) with a fundamental set drops a ratio probe instead of moving harmonics.
    if ((shift || harmProbeOn) && harmF0 !== null) { if (hz > 0) { setHarmProbe(hz); setHarmProbeOn(false) }; harmGrab.current = null; return }
    if (phase === 'start') {
      if (harmF0 === null) {
        // Truth on: snap to the nearest engine line family (CSR/CFR/EFR/EDA) whose harmonic is under the click.
        const snap = truth ? snapToFamily(hz, familyFundamentals(st.tactical?.truth?.contacts), Math.max(0.5, 3 * (cfg?.fBin ?? 0.5))) : null
        if (snap) { setHarmF0(snap.fund.hz); setHarmK(snap.k); setHarmFam(familyLabel(snap.fund)); harmGrab.current = null; return }
        setHarmF0(hz); harmGrab.current = 1; setHarmK(1); setHarmFam(null); return
      }
      const k = nearestHarmonic(harmF0, hz); harmGrab.current = k; setHarmK(k); return
    }
    const k = harmGrab.current
    if (k !== null && hz > 0) { setHarmF0(hz / k); setHarmFam(null) }
    if (phase === 'end') harmGrab.current = null
  }
  const dopMode = tool === 'dop'
  // One gram arm at a time: DOP drops vernier/PROBE/BRG/drop; BRG/drop/HARM/LM/PROBE/vernier drop DOP.
  const armDop = (on: boolean) => {
    if (on) {
      setVernierPick(false); setHarmProbeOn(false); setBrgArm(ARM_IDLE)
      if (dropCapturesPlot(drop.state)) drop.dispatch({ type: 'disarm' })
    }
    setTool(on ? 'dop' : 'select')
  }
  const [lm, setLm] = useState<LloydState>({ basis: 'cpaFit', k: 40, tCpaS: 0, tauS: 300, manRangeM: 2000, manSpeedMps: 4 })
  // Doppler ruler (f0 at CPA, f1 on the approach leg, f2 mirrored): its pass geometry also feeds Lloyd's mirror.
  const ruler = useMemo(() => new RulerStore(acousticsV11.fitCpaFromDoppler), [])
  const rulerCommit = useSyncExternalStore(ruler.subscribe, ruler.getCommitted)
  useEffect(() => { ruler.clear() }, [ruler, stream, st.band])
  const cpaGeom: CpaGeom | null = useMemo(() => {
    if (!ruler.placed || !(ruler.geom.speedMps > 0)) return null
    const g = ruler.fit?.ok ? ruler.fit : ruler.geom
    return { tCpaS: g.tCpaS, rCpaM: g.rCpaM, speedMps: g.speedMps }
  }, [ruler, rulerCommit]) // eslint-disable-line react-hooks/exhaustive-deps
  const lmDrag = useLloydDrag(lm, setLm, cpaGeom, st.simT)
  const toggleLm = () => {
    if (tool === 'lm') { setTool('select'); return }
    if (lm.tCpaS === 0) setLm({ ...lm, tCpaS: st.simT - 100 })
    setBrgArm(ARM_IDLE); setVernierPick(false); setHarmProbeOn(false)
    setTool('lm')
  }

  useEffect(() => {
    client.setGram(loadGram())
    client.start()
    const q = new URLSearchParams(location.search)
    const gm = q.get('gram'); if (isGramMode(gm)) setGramMode(gm)
    if (q.has('autoplay')) { client.setRate(Number(q.get('rate')) || 16); client.setPlaying(true) }
    return () => client.dispose()
  }, [client])

  const changeBand = (b: Band) => { client.setBand(b); setView({ lo: 0, hi: BAND_MAX[b] }); setSelHz(null) }
  const lofarCfgs = useMemo(() => st.configs.filter((c) => c.kind === 'lofar'), [st.configs])
  const cfg = lofarCfgs[stream]
  const gram = st.gram
  const filter: GramFilter = cfg?.filter ?? gram?.filter ?? 'NB'
  // Last picked band preset (shown "armed" while RES is on, so the picker state is always visible).
  const [lastBand, setLastBand] = useState<LofarBandPresetId>(() => loadBand().preset)
  const bandOn = !!gram?.band, wantBand = gram?.band ?? lastBand
  useEffect(() => { if (gram) try {
    localStorage.setItem(GRAM_KEY, JSON.stringify({ res: gram.res, filter: gram.filter }))
    localStorage.setItem(BAND_KEY, JSON.stringify({ preset: gram.band ?? lastBand, on: !!gram.band }))
  } catch { /* private mode */ } }, [gram, lastBand])
  // New RES / vernier grid: show the whole new band (the old view is on a different frequency grid). Layout
  // effect, so the waterfall never draws a frame with the old view on the new grid after a handoff swap.
  const geo = geometryKey(lofarCfgs)
  useLayoutEffect(() => { if (cfg) setView(fullView(cfg)) }, [geo]) // eslint-disable-line react-hooks/exhaustive-deps
  // RES / filter controls act on the requested settings (st.gram), which lead the display during a handoff.
  const wantRes = gram?.res ?? cfg?.res ?? 5, wantFilter: GramFilter = gram?.filter ?? filter
  // RES −/+ on a band gram leaves the band (RES on again), stepping from the saved RES level.
  const stepRes = (d: number) => { const r = clampRes(wantRes + d); if (bandOn) client.setGram({ res: r, band: null }); else if (r !== wantRes) client.setGram({ res: r }) }
  const pickBand = (id: LofarBandPresetId) => { setLastBand(id); if (!(bandOn && wantBand === id)) client.setGram({ band: id }) }
  const bandSeg = (testId: string) => (
    <div className="seg band-seg" role="group" aria-label="LOFAR band preset" data-testid={testId} data-mode={bandOn ? 'band' : 'res'}
      title={bandOn ? 'Analytic band gram (RES off). RES −/+ returns to RES.' : 'RES is on. Tap a band for the analytic band gram (turns RES off): the engine runs RES and band presets as separate stream types.'}>
      {BAND_IDS.map((id) => <button key={id} aria-pressed={bandOn && wantBand === id} className={!bandOn && lastBand === id ? 'armed' : undefined}
        onClick={() => pickBand(id)} title={`${id} · 0–${bandEdges(id)[1]} Hz${bandOn ? '' : ' (turns RES off)'}`}>{id}</button>)}
    </div>
  )
  const setFilter = (f: GramFilter) => { if (f !== wantFilter) client.setGram({ filter: f }) }
  const centerVernier = (hz: number) => { setVernierPick(false); client.setGram({ vernierHz: Math.max(0, hz) }) }
  const vernierOff = () => { setVernierPick(false); client.setGram({ vernierHz: null }) }
  const vLabel = vernierLabel(cfg)
  const onVernier = () => {
    if (vLabel) { vernierOff(); return }
    if (selHz !== null) { centerVernier(selHz); return }
    if (!vernierPick) { setBrgArm(ARM_IDLE); if (tool === 'dop') setTool('select') }
    setVernierPick(!vernierPick)
  }
  const viewDigits = (cfg?.fBin ?? 1) < 0.1 ? 2 : (cfg?.fBin ?? 1) < 1 ? 1 : 0
  const probeName = truth && harmProbe !== null ? truthEdaName(st.tactical?.truth?.contacts, harmProbe, Math.max(0.5, 3 * (cfg?.fBin ?? 0.5))) : null
  const buoy = st.tactical?.buoys[stream]
  const simTopHz = BAND_MAX[st.band]
  const flashCtr = (hz: number) => {
    setCtrFlash(hz); clearTimeout(ctrTimer.current)
    ctrTimer.current = window.setTimeout(() => setCtrFlash(null), 1600)
  }
  const applyCenter = (hz: number) => {
    const plan = planCenter({ hz, cfg, view, bandOn, res: wantRes, simTopHz, minSpan: minSpanOf(cfg) })
    flashCtr(plan.hz)
    if (plan.kind === 'none') return
    if (plan.gram) client.setGram(plan.gram)
    // View-only pan keeps the current span. Handoffs (vernier / band→res) land on the new full band via geometryKey.
    if (plan.kind === 'view') setView(plan.view)
  }
  const centerFromSelection = () => {
    // DOP armed with a ruler on the gram: C centers on its f0 (the line at CPA).
    const hz = tool === 'dop' && ruler.placed ? ruler.s.f0Hz : selHz ?? cursorHz
    if (hz !== null) applyCenter(hz)
  }
  const submitHzField = () => {
    const hz = parseHz(hzField)
    if (Number.isFinite(hz)) { applyCenter(hz); setHzField('') }
  }
  // Selected buoy for B-arm shortcut: live DIFAR on the current gram channel.
  const selectedDifarId = (() => {
    const b = buoy
    return b && b.kind === 'difar' && b.state === 'live' ? b.id : null
  })()
  const flashBrg = (msg: string) => {
    setBrgFlash(msg); clearTimeout(brgTimer.current)
    brgTimer.current = window.setTimeout(() => setBrgFlash(null), 1800)
  }
  const disarmOthersForBrg = () => {
    setShowManual(true)
    if (dropCapturesPlot(drop.state)) drop.dispatch({ type: 'disarm' })
    setVernierPick(false); setHarmProbeOn(false)
    if (tool === 'dop' || tool === 'lm' || tool === 'harm') setTool('select')
  }
  /** Send a manual bearing from DIFAR per-bin data at hz for the current buoy. */
  const sendBrgAtFreq = (hz: number): boolean => {
    const b = buoy
    if (!b) { flashBrg(NO_BRG_MSG); return true }
    if (b.kind !== 'difar') { flashBrg(OMNI_BRG_MSG); return true }
    if (b.state !== 'live') { flashBrg(NO_BRG_MSG); return true }
    const sampled = bearingAtRef.current?.(hz) ?? null
    const deg = sampled ?? bearingFromTracked(st.tactical?.bearings, b.id, hz)
    if (deg === null) { flashBrg(NO_BRG_MSG); return true }
    onManual(b.id, deg, true)
    setBrgArm(ARM_IDLE)
    flashBrg(formatBrgHud(deg, hz, b.channel))
    return true
  }
  /** Desktop/iPad: if the pointer is over the gram, B sends BRG at cursorHz; else arm tactical. */
  const tryBrgFromCursor = (): boolean => {
    if (cursorHz === null) return false
    return sendBrgAtFreq(cursorHz)
  }
  const toggleBrg = () => {
    // Phone/touch has no hover: arm pick-freq when a live DIFAR is on screen; else tactical pick-buoy.
    if (phone) {
      setBrgArm((a) => {
        if (isArmed(a)) return ARM_IDLE
        disarmOthersForBrg()
        if (selectedDifarId !== null) return togglePickFreq(ARM_IDLE)
        return toggleArm(ARM_IDLE, null)
      })
      return
    }
    setBrgArm((a) => {
      const next = toggleArm(a, selectedDifarId)
      if (isArmed(next)) disarmOthersForBrg()
      return next
    })
  }
  const onBrgButton = () => {
    if (!phone && cursorHz !== null) { tryBrgFromCursor(); return }
    toggleBrg()
  }
  // Drop pattern arm clears the bearing arm (and the reverse is in toggleBrg).
  const dropCapturing = useSyncExternalStore(drop.subscribe, () => dropCapturesPlot(drop.state))
  useEffect(() => {
    if (!dropCapturing) return
    setBrgArm(ARM_IDLE)
    setTool((t) => (t === 'dop' ? 'select' : t))
  }, [dropCapturing])
  const keyRef = useRef({ centerFromSelection, toggleBrg, tryBrgFromCursor, brgArm, dopMode, rulerPlaced: false })
  keyRef.current = { centerFromSelection, toggleBrg, tryBrgFromCursor, brgArm, dopMode, rulerPlaced: ruler.placed }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const r = keyRef.current
      if (k === 'c') { e.preventDefault(); r.centerFromSelection(); return }
      if (k === 'b') {
        e.preventDefault()
        if (r.tryBrgFromCursor()) return
        r.toggleBrg()
        return
      }
      if (k === 'Escape') {
        if (isArmed(r.brgArm)) { e.preventDefault(); setBrgArm(cancelArm()); return }
        // DopplerOverlay clears a placed ruler; if DOP is armed with nothing placed, drop the arm.
        if (r.dopMode && !r.rulerPlaced) { e.preventDefault(); setTool('select'); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toolsRow = (
    <div className="panel-head gram-tools" data-testid="gram-tools">
      {!phone && <span className="seg-label">TOOLS</span>}
            <div className="seg" role="group" aria-label="Doppler ruler">
              <button aria-pressed={dopMode} onClick={() => armDop(!dopMode)} data-testid="dop-tool"
                title="Doppler ruler: tap a line at CPA to place f0, drag f1 onto the approach leg (f2 mirrors). Drag f2 to fine-tune it alone, tap it to re-link. Keys: arrows nudge, Shift ×10, Esc clears.">DOP</button>
              {ruler.placed && <button onClick={() => applyCenter(ruler.s.f0Hz)} data-testid="dop-center" title="Center the gram on f0 (C while DOP is armed). Finer RES is the way to see a sub-Hz shift.">CTR f0</button>}
              {ruler.placed && !ruler.s.linked && <button onClick={() => ruler.relink()} data-testid="dop-link" title="Re-link f2 to the mirror of f1">Link</button>}
              {ruler.placed && <button onClick={() => ruler.clear()} data-testid="dop-clear">Clear</button>}
            </div>
            <div className="seg" role="group" aria-label="Harmonic cursor">
              <button aria-pressed={tool === 'harm'} onClick={() => {
                if (tool === 'harm') { setTool('select'); return }
                setBrgArm(ARM_IDLE); setVernierPick(false); setHarmProbeOn(false); setTool('harm')
              }} title="Harmonic cursor: click a line to set the fundamental, drag any marker to adjust, shift-click (or PROBE) another line to read its ratio to the fundamental (e.g. LOP ×27.75)">HARM</button>
              {harmF0 !== null && <button aria-pressed={harmProbeOn} onClick={() => {
                if (!harmProbeOn) { setBrgArm(ARM_IDLE); if (dopMode) setTool('harm') }
                setHarmProbeOn((v) => !v)
              }} title="Next tap sets a ratio probe (touch stand-in for shift-click)" data-testid="harm-probe-btn">PROBE</button>}
              {harmF0 !== null && <button onClick={() => { setHarmF0(null); setHarmK(null); setHarmFam(null); setHarmProbe(null); setHarmProbeOn(false) }}>Clear</button>}
            </div>
            <div className="seg" role="group" aria-label="Cross cursor">
              <button aria-pressed={crossOn} onClick={() => setCrossOn(!crossOn)} title="Time / frequency crosshair with level readout">CROSS</button>
            </div>
            <div className="seg" role="group" aria-label="Lloyd's mirror">
              <button aria-pressed={tool === 'lm'} onClick={toggleLm} title="Lloyd's mirror striations: drag a curve onto the interference nulls (shift-drag moves CPA time)">LM</button>
            </div>
            <div className="contrast" data-testid="contrast">
              <button className="contrast-label" onClick={() => setContrast(CONTRAST_DEFAULT)} aria-label="Reset contrast to 1.0" title="Gram contrast (tap to reset to 1.0×)" data-testid="contrast-reset">CON {contrast.toFixed(2)}×</button>
              <input type="range" min={CONTRAST_MIN} max={CONTRAST_MAX} step={CONTRAST_STEP} value={contrast} aria-label="Gram contrast" data-testid="contrast-slider"
                onChange={(e) => setContrast(clampContrast(Number(e.currentTarget.value)))} onDoubleClick={() => setContrast(CONTRAST_DEFAULT)} />
            </div>
            <span className="readout">
              {cfg ? `${view.lo.toFixed(viewDigits)}–${view.hi.toFixed(viewDigits)} HZ  Δf ${cfg.fBin < 0.1 ? cfg.fBin.toFixed(3) : cfg.fBin.toFixed(2)}` : 'STARTING'}
              {buoy ? `  ${buoy.state.toUpperCase()}  ${buoy.hydrophoneDepthM}M  BATT ${(buoy.batteryFrac * 100).toFixed(0)}%` : ''}
              {buoy?.rx ? `  AGC ${buoy.rx.gainDb >= 0 ? '+' : ''}${buoy.rx.gainDb.toFixed(0)}` : ''}
            </span>
            {buoy?.rx?.overload && <span className="ovld" data-testid="ovld">OVLD</span>}
    </div>
  )

  return (
    <div className={`app layout-${layout}`} data-layout={layout}>
      {showNew && <NewScenario onClose={() => setShowNew(false)} onStart={(p) => { setShowNew(false); client.start(p.seed, 'generated', st.band, p); client.setPlaying(true) }} />}
      {phone ? (
        <header className="toolbar compact">
          <div className="brand">DATUM</div>
          <button className={`btn ${st.playing ? '' : 'primary'}`} onClick={() => client.setPlaying(!st.playing)} disabled={!st.configs.length}>
            {st.playing ? 'Pause' : 'Play'}
          </button>
          <div className="seg" role="group" aria-label="Sim rate">
            {RATES.map((r) => <button key={r} aria-pressed={st.rate === r} onClick={() => client.setRate(r)}>{r}×</button>)}
          </div>
          <span className="readout">T+{fmtT(st.simT)}</span>
          <button className="btn icon" data-testid="menu-open" aria-label="More controls" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>☰</button>
        </header>
      ) : (
      <header className="toolbar">
        <div className="brand">DATUM<small>Acoustic operator trainer · fictional patrol aircraft</small></div>
        <div className="group">
          <button className="btn" onClick={() => setShowNew(true)}>New</button>
          <select className="btn scn-select" data-testid="scenario-select" aria-label="Scenario"
            value={(SCENARIOS as readonly string[]).includes(st.scenarioId) ? st.scenarioId : ''}
            onChange={(e) => { ruler.clear(); client.start(7, e.target.value, st.band, undefined); client.setPlaying(true) }}>
            {!(SCENARIOS as readonly string[]).includes(st.scenarioId) && <option value="">Generated</option>}
            {SCENARIOS.map((id) => <option key={id} value={id}>{SCENARIO_LABEL[id]}</option>)}
          </select>
          {st.scenarioId === 'generated' && <SeedChip seed={st.seed} />}
          <button className={`btn ${st.playing ? '' : 'primary'}`} onClick={() => client.setPlaying(!st.playing)} disabled={!st.configs.length}>
            {st.playing ? 'Pause' : 'Play'}
          </button>
          <div className="seg" role="group" aria-label="Sim rate">
            {RATES.map((r) => <button key={r} aria-pressed={st.rate === r} onClick={() => client.setRate(r)}>{r}×</button>)}
          </div>
        </div>
        <div className="group">
          <div className="seg" role="group" aria-label="LOFAR band">
            <button aria-pressed={st.band === 'lofar1k'} onClick={() => changeBand('lofar1k')}>0–1 kHz</button>
            <button aria-pressed={st.band === 'lofar2k'} onClick={() => changeBand('lofar2k')}>0–2 kHz</button>
          </div>
        </div>
        <div className="group">
        </div>
        <div className="group">
          <label className="seg" style={{ padding: '2px 8px', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> Truth
          </label>
        </div>
        <div className="group">
          <button className="btn" data-testid="cmp-open" onClick={() => setShowCmp(true)} title="Recognition guide for every fictional class">Compendium</button>
        </div>
        <div className="group" style={{ position: 'relative' }}>
          <button className="btn" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>Settings</button>
        </div>
        <span className="readout">LOG {logCount}  T+{fmtT(st.simT)}</span>
        {showSettings && (
          <div className="popover" role="dialog" aria-label="Settings" data-testid="settings">
            <TrafficSlider value={st.surfaceTraffic} onChange={(v) => client.setSurfaceTraffic(v)} />
            <label className="check" title="Off = ideal receiver with unlimited dynamic range (for comparison)">
              <input type="checkbox" data-testid="rx-toggle" checked={st.receiver} onChange={(e) => client.setReceiver(e.target.checked)} /> Realistic receiver (AGC, limited range)
            </label>
          </div>
        )}
      </header>
      )}
      {phone && (
        <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Controls" testId="menu-sheet">
          <div className="sheet-row"><span className="seg-label">SCENARIO</span><button className="btn" onClick={() => { setMenuOpen(false); setShowNew(true) }}>New</button><select className="btn scn-select" data-testid="scenario-select" aria-label="Scenario"
            value={(SCENARIOS as readonly string[]).includes(st.scenarioId) ? st.scenarioId : ''}
            onChange={(e) => { ruler.clear(); client.start(7, e.target.value, st.band, undefined); client.setPlaying(true) }}>
            {!(SCENARIOS as readonly string[]).includes(st.scenarioId) && <option value="">Generated</option>}
            {SCENARIOS.map((id) => <option key={id} value={id}>{SCENARIO_LABEL[id]}</option>)}
          </select>{st.scenarioId === 'generated' && <SeedChip seed={st.seed} />}</div>
          <div className="sheet-row"><span className="seg-label">LOFAR</span><div className="seg" role="group" aria-label="LOFAR palette" data-testid="palette-seg">
            {PALETTE_IDS.map((id) => <button key={id} aria-pressed={palette === id} onClick={() => setPalette(id)} title={gramMode === 'difar' ? 'LOFAR colour (DIFAR uses the bearing wheel)' : `LOFAR amplitude in ${PALETTE_LABEL[id].toLowerCase()}`}>{PALETTE_LABEL[id]}</button>)}
          </div></div>
          <div className="sheet-row"><span className="seg-label">GRAM BAND</span>{bandSeg('band-seg-sheet')}</div>
          <div className="sheet-row"><span className="seg-label">BAND</span><div className="seg" role="group" aria-label="LOFAR band">
            <button aria-pressed={st.band === 'lofar1k'} onClick={() => changeBand('lofar1k')}>0–1 kHz</button>
            <button aria-pressed={st.band === 'lofar2k'} onClick={() => changeBand('lofar2k')}>0–2 kHz</button>
          </div></div>
          <div className="sheet-row"><label className="seg" style={{ padding: '2px 8px', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> Truth
          </label><button className="btn" data-testid="cmp-open" onClick={() => { setMenuOpen(false); setShowCmp(true) }} title="Recognition guide for every fictional class">Compendium</button><span className="readout">LOG {logCount}</span></div>
          <div className="sheet-col">
            <TrafficSlider value={st.surfaceTraffic} onChange={(v) => client.setSurfaceTraffic(v)} />
            <label className="check" title="Off = ideal receiver with unlimited dynamic range (for comparison)">
              <input type="checkbox" data-testid="rx-toggle" checked={st.receiver} onChange={(e) => client.setReceiver(e.target.checked)} /> Realistic receiver (AGC, limited range)
            </label>
          </div>
        </Sheet>
      )}
      {showCmp && <div className={phone ? "cmp-sheet" : undefined}><Compendium onClose={() => setShowCmp(false)} /></div>}

      <main className="workspace">
        <div className="workspace-left">
        <section className="panel gram-panel">
          <div className="panel-head">
            <h2 data-testid="gram-title">{gramMode === 'difar' ? 'DIFAR' : 'LOFAR'} · {filter}</h2>
            <div className="seg" role="group" aria-label="Gram mode">
              <button aria-pressed={gramMode === 'lofar'} onClick={() => setGramMode('lofar')} title={`Amplitude as ${PALETTE_LABEL[palette].toLowerCase()} brightness`}>LOFAR</button>
              <button aria-pressed={gramMode === 'difar'} onClick={() => setGramMode('difar')} title="Bearing as hue (N red, E yellow, S blue, W violet), intensity as brightness">DIFAR</button>
            </div>
            <div className="seg filter-seg" role="group" aria-label="Gram filter" data-testid="filter-seg">
              <button aria-pressed={wantFilter === 'NB'} onClick={() => setFilter('NB')} title="Narrowband: background-normalized (TPSW), 0–30 dB above the local noise">NB</button>
              <button aria-pressed={wantFilter === 'BB'} onClick={() => setFilter('BB')} title="Broadband: absolute level, 40–110 dB">BB</button>
            </div>
            {!phone && <span className="seg-label">RES</span>}
            <div className="seg res-step" role="group" aria-label="Resolution" data-testid="res-step">
              <button className="icon" onClick={() => stepRes(-1)} disabled={!cfg || (!bandOn && wantRes <= RES_MIN)} aria-label="Finer resolution (RES down)" title="Finer bins, narrower band">−</button>
              <span key={cfg?.res ?? cfg?.bandPreset} className="res-read" data-testid="res-readout" aria-live="polite">{bandReadout(cfg) ?? resReadout(cfg, layout === 'phonePortrait')}</span>
              <button className="icon" onClick={() => stepRes(1)} disabled={!cfg || (!bandOn && wantRes >= RES_MAX)} aria-label="Coarser resolution (RES up)" title="Wider bins, wider band">+</button>
            </div>
            {!phone && <span className="seg-label">BAND</span>}
            {bandSeg('band-seg')}
            <button disabled={bandOn && !vLabel} className={`btn vernier${vLabel ? ' on' : vernierPick ? ' pick' : ''}`} data-testid="vernier" aria-pressed={!!vLabel || vernierPick} onClick={onVernier}
              title={vLabel ? 'Back to the full band' : bandOn ? 'Vernier needs RES (band presets use the analytic band gram)' : 'Center the band on a line: uses the selected line, or tap one on the gram'}>
              {vLabel ? <>{vLabel} <span aria-hidden>✕</span></> : vernierPick ? 'VERNIER · tap a line' : layout === 'phonePortrait' ? 'VERNIER' : selHz !== null ? `VERNIER · ${selHz.toFixed(viewDigits + 1)} Hz` : 'VERNIER OFF · tap a line'}
            </button>
            {selHz !== null && (
              <button className="btn center-btn" data-testid="center-btn" onClick={() => applyCenter(selHz)}
                title="Center the gram on the selected line (C)">CENTER</button>
            )}
            {!phone && (
              <form className="hz-field" data-testid="hz-field" onSubmit={(e) => { e.preventDefault(); submitHzField() }} title="Type a frequency and Enter to center (optional)">
                <input inputMode="decimal" enterKeyHint="go" aria-label="Center frequency Hz" placeholder="Hz" value={hzField}
                  onChange={(e) => setHzField(e.target.value)} />
              </form>
            )}
            {ctrFlash !== null && <span className="ctr-readout" data-testid="ctr-readout" aria-live="polite">{ctrLabel(ctrFlash, cfg?.fBin)}</span>}
            {brgFlash !== null && <span className="ctr-readout brg-readout" data-testid="brg-readout" aria-live="polite">{brgFlash}</span>}
            {cfg?.bandLimited && <span className="band-limit-tag" data-testid="band-limit-tag" title="Part of this band is above the simulated top frequency">BAND LIMIT</span>}
            {!phone && <span className="seg-label">BUOY</span>}
            <div className="seg" role="group" aria-label="Buoy channel">
              {lofarCfgs.map((c, i) => (
                <button key={c.streamId} aria-pressed={i === stream} onClick={() => setStream(i)}>
                  {c.channel}{st.tactical?.buoys[i]?.kind === 'difar' ? 'D' : 'O'}
                </button>
              ))}
            </div>
            {layout === 'phoneLandscape' && <button className="btn icon tac-toggle" data-testid="tac-open" aria-expanded={tacOpen} onClick={() => setTacOpen(!tacOpen)} title="Tactical plot">TAC</button>}
          </div>
          {layout !== 'phonePortrait' && toolsRow}
          <div className="panel-body">
            {lofarCfgs.length > 0 && (
              <Gram client={client} configs={lofarCfgs} streamIndex={stream} view={view}
                onView={(v) => setView(cfg ? clampView(v, fullView(cfg).hi, minSpanOf(cfg), cfg.f0) : clampView(v, BAND_MAX[st.band]))}
                normalized={filter === 'NB'} palette={palette} contrast={contrast} wheel={wheel} selectedHz={selHz} onSelectHz={setSelHz}
                mode={gramMode} tactical={st.tactical} handoff={st.handoff}
                onCenterFreq={applyCenter} onCursorHz={setCursorHz} bearingAtRef={bearingAtRef}
                onPickPoint={isPickFreq(brgArm) ? (hz) => { sendBrgAtFreq(hz) }
                  : vernierPick ? (hz) => centerVernier(hz)
                  : dopMode ? (hz, ago) => ruler.tap(hz, st.simT - ago)
                  : harmProbeOn && harmF0 !== null ? (hz) => { setHarmProbe(hz); setHarmProbeOn(false) } : undefined}
                onDragPoint={isPickFreq(brgArm) || vernierPick || (harmProbeOn && harmF0 !== null) ? undefined : tool === 'lm' ? lmDrag : tool === 'harm' ? harmDrag : undefined}
                crosshair={crossOn} nowS={st.simT}
                overlay={ruler.placed || dopMode || tool === 'lm' || harmF0 !== null ? (ctx) => (<>
                  {harmF0 !== null && harmonicSeries(harmF0, ctx.view.hi).map((f, i) => f >= ctx.view.lo && (
                    <div key={`h${i}`} className="harm-marker lofar" style={{ left: freqToX(f, ctx.view, ctx.width) }}><span>{i === 0 ? 'F' : i + 1}</span></div>))}
                  {harmF0 !== null && harmProbe !== null && harmProbe >= ctx.view.lo && harmProbe <= ctx.view.hi && (
                    <div className="harm-marker lofar probe" data-testid="harm-probe" style={{ left: freqToX(harmProbe, ctx.view, ctx.width) }}><span>×{(harmProbe / harmF0).toFixed(2)}</span></div>)}
                  {tool === 'lm' && <LloydsOverlay ctx={ctx} st={lm} cpa={cpaGeom} nowS={st.simT} />}
                  {(ruler.placed || dopMode) && <DopplerOverlay ctx={ctx} store={ruler} nowS={st.simT} active={dopMode} />}
                </>) : undefined} />
            )}
            {(tool === 'harm' || harmF0 !== null) && <div className="gram-note readout harm-note" data-testid="harm-readout">{harmText(harmF0, harmK, cfg ? fullView(cfg).hi : BAND_MAX[st.band], harmFam ?? undefined)}{harmF0 !== null && harmProbe !== null && `   ${ratioText(harmF0, harmProbe)}${probeName ? '  ' + probeName : ''}`}</div>}
            {(dopMode || ruler.placed) && <DopplerReadout store={ruler} fBin={cfg?.fBin ?? 1} />}
            {tool === 'lm' && (
              <div className="lm-panel" data-testid="lm-panel">
                <div className="seg" role="group" aria-label="Lloyd's mirror basis">
                  {(['cpaFit', 'manual', 'none'] as const).map((b) => (
                    <button key={b} aria-pressed={lm.basis === b ? !(b === 'cpaFit' && !cpaGeom) : b === 'none' && lm.basis === 'cpaFit' && !cpaGeom} disabled={b === 'cpaFit' && !cpaGeom} onClick={() => setLm({ ...lm, basis: b })}
                      title={b === 'cpaFit' && !cpaGeom ? 'Needs a CPA fit first' : undefined}>{b === 'cpaFit' ? 'CPA fit' : b === 'manual' ? 'Manual' : 'None'}</button>))}
                </div>
                {lm.basis === 'manual' && <>
                  <label>Range km <input type="number" step={0.1} min={0.1} value={(lm.manRangeM / 1000).toFixed(1)} onChange={(e) => setLm({ ...lm, manRangeM: Math.max(100, Number(e.target.value) * 1000) })} /></label>
                  <label>Speed kt <input type="number" step={0.5} min={0.5} value={(lm.manSpeedMps * 1.943844).toFixed(1)} onChange={(e) => setLm({ ...lm, manSpeedMps: Math.max(0.25, Number(e.target.value) / 1.943844) })} /></label>
                </>}
                {(lm.basis === 'none' || (lm.basis === 'cpaFit' && !cpaGeom)) &&
                  <label>Width s <input type="number" step={10} min={10} value={lm.tauS.toFixed(0)} onChange={(e) => setLm({ ...lm, tauS: Math.max(10, Number(e.target.value)) })} /></label>}
                {lm.basis !== 'cpaFit' && (
                  <div className="seg" role="group" aria-label="Lloyd CPA time" data-testid="lm-cpa-nudge">
                    <button type="button" onClick={() => setLm({ ...lm, tCpaS: lm.tCpaS - 10 })} title="CPA time −10 s">CPA −</button>
                    <button type="button" onClick={() => setLm({ ...lm, tCpaS: lm.tCpaS + 10 })} title="CPA time +10 s">CPA +</button>
                  </div>
                )}
                <span className="lm-read" data-testid="lm-readout">{lloydText(lm, cpaGeom, buoy?.hydrophoneDepthM ?? null, { t0: Math.max(0, st.simT - 300), t1: st.simT })}</span>
              </div>
            )}
            {gramMode === 'difar' && <DifarLegend omni={!!buoy && buoy.kind !== 'difar'} wheel={wheel} onOpen={() => setWheelOpen(true)} />}
            {gramMode === 'difar' && wheelOpen && <DifarApplet wheel={wheel} onChange={setWheel} onClose={() => setWheelOpen(false)} />}
            {st.error && <div className="gl-error">Simulation error: {st.error}</div>}
          </div>
          {layout === 'phonePortrait' && toolsRow}
        </section>
        </div>
        {layout === 'phoneLandscape' && <div className={`tac-scrim${tacOpen ? ' open' : ''}`} onClick={() => setTacOpen(false)} aria-hidden />}
        <section className={`panel tac-panel${tacOpen ? ' open' : ''}`} data-testid="tac-panel">
          <div className="panel-head">
            <h2>Tactical</h2>
            {layout === 'phoneLandscape' && <button className="btn icon" onClick={() => setTacOpen(false)} aria-label="Close tactical">✕</button>}
            <span className="seg-label">BRG</span>
            <div className="seg" role="group" aria-label="Bearings shown">
              <button aria-pressed={!allBearings} onClick={() => setAllBearings(false)}>{selHz === null ? 'Sel' : `${selHz.toFixed(1)} Hz`}</button>
              <button aria-pressed={allBearings} onClick={() => setAllBearings(true)}>All</button>
            </div>
            <div className="seg" role="group" aria-label="Bearing layers">
              <button aria-pressed={showAuto} onClick={() => setShowAuto(!showAuto)} title="DIFAR-computed bearings (solid)">Auto</button>
              <button aria-pressed={showManual} onClick={() => setShowManual(!showManual)} title="Operator bearing cursors (dashed). Drag from a DIFAR buoy; double-click it to clear.">Man</button>
              <button className={`brg-btn${isArmed(brgArm) ? ' armed' : ''}`} data-testid="brg-btn" aria-pressed={isArmed(brgArm)}
                onClick={onBrgButton}
                title="Hover a DIFAR gram line and press B to send that bearing. On touch: BRG then tap the gram (or a buoy on the plot to aim). Esc cancels. Drag still works.">{armLabel(brgArm)}</button>
            </div>
            <span className="seg-label">FIX</span>
            <div className="seg" role="group" aria-label="Fix from">
              {(['auto', 'manual', 'both'] as const).map((f) => <button key={f} aria-pressed={fixSource === f} onClick={() => setFixSource(f)}
                title={f === 'auto' ? 'Fix from auto bearings' : f === 'manual' ? 'Fix from manual bearings' : 'Fix from both (manual overrides auto per buoy)'}>{f === 'auto' ? 'A' : f === 'manual' ? 'M' : 'A+M'}</button>)}
            </div>
          </div>
          <div className="panel-body plot">
            {st.tactical && <div className="plot-corner readout" data-testid="ac-readout">
              {`A/C HDG ${st.tactical.aircraft.hdgDeg.toFixed(0).padStart(3, '0')}  ${(st.tactical.aircraft.gsMps * 1.943844).toFixed(0)} KT  ${st.tactical.aircraft.altM} M`}</div>}
            <TacticalPlot client={client} showTruth={truth} selectedChannel={cfg?.channel} selectedHz={selHz} allBearings={allBearings}
              showAuto={showAuto} showManual={showManual} manual={manual} fixSource={fixSource}
              onManual={(id, deg, final) => {
                onManual(id, deg, final)
                if (final && deg !== null && isArmed(brgArm)) setBrgArm(ARM_IDLE)
              }}
              drop={drop}
              arm={brgArm}
              onArmPick={(id) => setBrgArm(pickBuoy(brgArm, id))}
              onArmAim={(id, wx, wy) => {
                const b = st.tactical?.buoys.find((x) => x.id === id); if (!b) return
                const deg = bearingTo(b, wx, wy); if (deg === null) return
                onManual(id, deg, true); setBrgArm(ARM_IDLE)
              }} />
            <DropBar client={client} drop={drop} tactical={st.tactical} log={log} buoyLifeS={st.params ? st.params.buoyLifeMin * 60 : undefined} />
            {truth && st.tactical?.truth && !phone && <TruthPanel contacts={st.tactical.truth.contacts} />}
            {truth && st.tactical?.truth && phone && <button className="btn truth-chip" data-testid="truth-open" onClick={() => setTruthSheet(true)}>TRUTH · {st.tactical.truth.contacts.filter((c) => c.active !== false).length}</button>}
          </div>
        </section>
      </main>
      {phone && truth && st.tactical?.truth && (
        <Sheet open={truthSheet} onClose={() => setTruthSheet(false)} title="Truth" testId="truth-sheet">
          <TruthPanel contacts={st.tactical.truth.contacts} />
        </Sheet>
      )}
    </div>
  )
}
