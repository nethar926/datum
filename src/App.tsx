import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { SimClient } from './engine/client'
import type { Band } from './engine/contract'
import { Gram } from './gram/Gram'
import { DemonPane } from './gram/DemonPane'
import { NewScenario } from './settings/NewScenario'
import { TrafficSlider } from './settings/TrafficSlider'
import { LloydsOverlay, lloydText, useLloydDrag, type CpaGeom, type LloydState } from './gram/LloydsOverlay'
import { CpaOverlay, cpaReadout } from './gram/CpaOverlay'
import { addSample, cpaFitterReady, MIN_CPA_SAMPLES, runCpaFit, type CpaSample } from './gram/cpa'
import { clampView, type FreqView } from './gram/axis'
import { TacticalPlot } from './tactical/TacticalPlot'
import type { FixSource, ManualBearings } from './tactical/manual'
import { OperatorLog } from './log/operatorLog'
import { PALETTE_IDS, isPaletteId, type PaletteId } from './gl/colormap'

const RATES = [1, 4, 16]
const PALETTE_LABEL: Record<PaletteId, string> = { green: 'Green', amber: 'Amber', gray: 'Gray', multi: 'Multi' }
const PALETTE_KEY = 'datum.palette'
const loadPalette = (): PaletteId => { try { const v = localStorage.getItem(PALETTE_KEY); return isPaletteId(v) ? v : 'green' } catch { return 'green' } }
const BAND_MAX: Record<Band, number> = { lofar1k: 1000, lofar2k: 2000 }
const fmtT = (s: number) => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` }

export default function App() {
  const client = useMemo(() => new SimClient(), [])
  const st = useSyncExternalStore(client.subscribe, client.getStatus)
  const [stream, setStream] = useState(0)
  const [view, setView] = useState<FreqView>({ lo: 0, hi: 1000 })
  const [truth, setTruth] = useState(false)
  const [normalized, setNormalized] = useState(true)
  const [palette, setPalette] = useState<PaletteId>(loadPalette)
  useEffect(() => { try { localStorage.setItem(PALETTE_KEY, palette) } catch { /* private mode */ } }, [palette])
  const [allBearings, setAllBearings] = useState(false)
  const [showAuto, setShowAuto] = useState(true)
  const [showManual, setShowManual] = useState(true)
  const [fixSource, setFixSource] = useState<FixSource>('both')
  const [manual, setManual] = useState<ManualBearings>({})
  const log = useMemo(() => new OperatorLog(), [])
  const logCount = useSyncExternalStore(log.subscribe, log.size)
  const onManual = (buoyId: number, deg: number | null, final: boolean) => {
    setManual((m) => { const n = { ...m }; if (deg === null) delete n[buoyId]; else n[buoyId] = deg; return n })
    if (final) log.add({ simT: client.status.simT, kind: 'bearing', buoyId, data: deg === null ? { source: 'manual', cleared: true } : { source: 'manual', brgDeg: Math.round(deg * 10) / 10 } })
  }
  const [selHz, setSelHz] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [tool, setTool] = useState<'select' | 'cpa' | 'lm'>('select')
  const cpaMode = tool === 'cpa'
  const setCpaMode = (on: boolean) => setTool(on ? 'cpa' : 'select')
  const [lm, setLm] = useState<LloydState>({ basis: 'cpaFit', k: 40, tCpaS: 0, tauS: 300, manRangeM: 2000, manSpeedMps: 4 })
  const [cpaMarks, setCpaMarks] = useState<CpaSample[]>([])
  useEffect(() => { setCpaMarks([]) }, [stream, st.band])
  const cpaFit = useMemo(() => runCpaFit(cpaMarks), [cpaMarks])
  const cpaGeom: CpaGeom | null = cpaFit?.ok ? { tCpaS: cpaFit.tCpaS, rCpaM: cpaFit.rCpaM, speedMps: cpaFit.speedMps } : null
  const lmDrag = useLloydDrag(lm, setLm, cpaGeom, st.simT)
  const toggleLm = () => {
    if (tool === 'lm') { setTool('select'); return }
    if (lm.tCpaS === 0) setLm({ ...lm, tCpaS: st.simT - 100 })
    setTool('lm')
  }

  useEffect(() => {
    client.start()
    const q = new URLSearchParams(location.search)
    const pq = q.get('palette'); if (isPaletteId(pq)) setPalette(pq)
    if (q.has('autoplay')) { client.setRate(Number(q.get('rate')) || 16); client.setPlaying(true) }
    return () => client.dispose()
  }, [client])

  const changeBand = (b: Band) => { client.setBand(b); setView({ lo: 0, hi: BAND_MAX[b] }); setSelHz(null) }
  const lofarCfgs = useMemo(() => st.configs.filter((c) => c.kind === 'lofar'), [st.configs])
  const demonCfgs = useMemo(() => st.configs.filter((c) => c.kind === 'demon'), [st.configs])
  const cfg = lofarCfgs[stream]
  const buoy = st.tactical?.buoys[stream]

  return (
    <div className="app">
      {showNew && <NewScenario onClose={() => setShowNew(false)} onStart={(p) => { setShowNew(false); client.start(p.seed, 'generated', st.band, p); client.setPlaying(true) }} />}
      <header className="toolbar">
        <div className="brand">DATUM<small>Acoustic operator trainer · fictional patrol aircraft</small></div>
        <div className="group">
          <button className="btn" onClick={() => setShowNew(true)}>New</button>
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
          <div className="seg" role="group" aria-label="Gram palette">
            {PALETTE_IDS.map((id) => <button key={id} aria-pressed={palette === id} onClick={() => setPalette(id)}>{PALETTE_LABEL[id]}</button>)}
          </div>
        </div>
        <div className="group">
          <label className="seg" style={{ padding: '2px 8px', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> Truth
          </label>
        </div>
        <div className="group" style={{ position: 'relative' }}>
          <button className="btn" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>Settings</button>
        </div>
        <span className="readout">LOG {logCount}  T+{fmtT(st.simT)}</span>
        {showSettings && (
          <div className="popover" role="dialog" aria-label="Settings" data-testid="settings">
            <TrafficSlider value={st.surfaceTraffic} onChange={(v) => client.setSurfaceTraffic(v)} />
          </div>
        )}
      </header>

      <main className="workspace">
        <div className="workspace-left">
        <section className="panel">
          <div className="panel-head">
            <h2>LOFAR</h2>
            <div className="seg" role="group" aria-label="LOFAR processing">
              <button aria-pressed={normalized} onClick={() => setNormalized(true)} title="Split-window background normalization">Norm</button>
              <button aria-pressed={!normalized} onClick={() => setNormalized(false)}>Raw</button>
            </div>
            <div className="seg" role="group" aria-label="Buoy channel">
              {lofarCfgs.map((c, i) => (
                <button key={c.streamId} aria-pressed={i === stream} onClick={() => setStream(i)}>
                  {c.channel}{st.tactical?.buoys[i]?.kind === 'difar' ? 'D' : 'O'}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="CPA cursor">
              <button aria-pressed={cpaMode} onClick={() => setCpaMode(!cpaMode)} title="Mark points along one tonal's Doppler S-curve to fit CPA time, speed and range">CPA</button>
              {cpaMarks.length > 0 && <button onClick={() => setCpaMarks((m) => m.slice(0, -1))} title="Remove last mark">Undo</button>}
              {cpaMarks.length > 0 && <button onClick={() => setCpaMarks([])}>Clear</button>}
            </div>
            <div className="seg" role="group" aria-label="Lloyd's mirror">
              <button aria-pressed={tool === 'lm'} onClick={toggleLm} title="Lloyd's mirror striations: drag a curve onto the interference nulls (shift-drag moves CPA time)">LM</button>
            </div>
            <span className="readout">
              {cfg ? `${view.lo.toFixed(0)}–${view.hi.toFixed(0)} HZ  Δf ${cfg.fBin.toFixed(2)}` : 'STARTING'}
              {buoy ? `  ${buoy.state.toUpperCase()}  ${buoy.hydrophoneDepthM}M  BATT ${(buoy.batteryFrac * 100).toFixed(0)}%` : ''}
            </span>
          </div>
          <div className="panel-body">
            {lofarCfgs.length > 0 && (
              <Gram client={client} configs={lofarCfgs} streamIndex={stream} view={view}
                onView={(v) => setView(clampView(v, BAND_MAX[st.band]))}
                normalized={normalized} palette={palette} selectedHz={selHz} onSelectHz={setSelHz}
                onPickPoint={cpaMode ? (hz, ago) => setCpaMarks((m) => addSample(m, { tS: st.simT - ago, fHz: hz })) : undefined}
                onDragPoint={tool === 'lm' ? lmDrag : undefined}
                overlay={cpaMarks.length || tool === 'lm' ? (ctx) => (<>
                  {tool === 'lm' && <LloydsOverlay ctx={ctx} st={lm} cpa={cpaGeom} nowS={st.simT} />}
                  {cpaMarks.length > 0 && <CpaOverlay ctx={ctx} marks={cpaMarks} fit={cpaFit} nowS={st.simT} />}
                </>) : undefined} />
            )}
            {(cpaMode || cpaMarks.length > 0) && <div className="gram-note readout" data-testid="cpa-readout">{cpaReadout(cpaMarks, cpaFit, cpaFitterReady(), MIN_CPA_SAMPLES)}</div>}
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
                <span className="lm-read" data-testid="lm-readout">{lloydText(lm, cpaGeom, buoy?.hydrophoneDepthM ?? null)}</span>
              </div>
            )}
            {st.error && <div className="gl-error">Simulation error: {st.error}</div>}
          </div>
        </section>
        <DemonPane client={client} configs={demonCfgs} palette={palette}
          streamIndex={Math.max(0, demonCfgs.findIndex((c) => c.channel === cfg?.channel))} />
        </div>
        <section className="panel">
          <div className="panel-head">
            <h2>Tactical</h2>
            <span className="seg-label">BRG</span>
            <div className="seg" role="group" aria-label="Bearings shown">
              <button aria-pressed={!allBearings} onClick={() => setAllBearings(false)}>{selHz === null ? 'Sel' : `${selHz.toFixed(1)} Hz`}</button>
              <button aria-pressed={allBearings} onClick={() => setAllBearings(true)}>All</button>
            </div>
            <div className="seg" role="group" aria-label="Bearing layers">
              <button aria-pressed={showAuto} onClick={() => setShowAuto(!showAuto)} title="DIFAR-computed bearings (solid)">Auto</button>
              <button aria-pressed={showManual} onClick={() => setShowManual(!showManual)} title="Operator bearing cursors (dashed). Drag from a DIFAR buoy; double-click it to clear.">Man</button>
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
              showAuto={showAuto} showManual={showManual} manual={manual} fixSource={fixSource} onManual={onManual} />
          </div>
        </section>
      </main>
    </div>
  )
}
