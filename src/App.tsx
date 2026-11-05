import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { SimClient } from './engine/client'
import type { Band } from './engine/contract'
import { Lofar } from './gram/Lofar'
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

  useEffect(() => {
    client.start()
    const q = new URLSearchParams(location.search)
    const pq = q.get('palette'); if (isPaletteId(pq)) setPalette(pq)
    if (q.has('autoplay')) { client.setRate(Number(q.get('rate')) || 16); client.setPlaying(true) }
    return () => client.dispose()
  }, [client])

  const changeBand = (b: Band) => { client.setBand(b); setView({ lo: 0, hi: BAND_MAX[b] }); setSelHz(null) }
  const cfg = st.configs[stream]
  const buoy = st.tactical?.buoys[stream]

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">DATUM<small>Acoustic operator trainer · fictional patrol aircraft</small></div>
        <div className="group">
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
        <span className="readout">LOG {logCount}  T+{fmtT(st.simT)}</span>
      </header>

      <main className="workspace">
        <section className="panel">
          <div className="panel-head">
            <h2>LOFAR</h2>
            <div className="seg" role="group" aria-label="LOFAR processing">
              <button aria-pressed={normalized} onClick={() => setNormalized(true)} title="Split-window background normalization">Norm</button>
              <button aria-pressed={!normalized} onClick={() => setNormalized(false)}>Raw</button>
            </div>
            <div className="seg" role="group" aria-label="Buoy channel">
              {st.configs.map((c, i) => (
                <button key={c.streamId} aria-pressed={i === stream} onClick={() => setStream(i)}>
                  {c.channel}{st.tactical?.buoys[i]?.kind === 'difar' ? 'D' : 'O'}
                </button>
              ))}
            </div>
            <span className="readout">
              {cfg ? `${view.lo.toFixed(0)}–${view.hi.toFixed(0)} HZ  Δf ${cfg.fBin.toFixed(2)}` : 'STARTING'}
              {buoy ? `  ${buoy.state.toUpperCase()}  ${buoy.hydrophoneDepthM}M  BATT ${(buoy.batteryFrac * 100).toFixed(0)}%` : ''}
            </span>
          </div>
          <div className="panel-body">
            {st.configs.length > 0 && (
              <Lofar client={client} configs={st.configs} streamIndex={stream} view={view}
                onView={(v) => setView(clampView(v, BAND_MAX[st.band]))}
                normalized={normalized} palette={palette} selectedHz={selHz} onSelectHz={setSelHz} />
            )}
            {st.error && <div className="gl-error">Simulation error: {st.error}</div>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Tactical</h2>
            <div className="seg" role="group" aria-label="Bearings shown">
              <button aria-pressed={!allBearings} onClick={() => setAllBearings(false)}>{selHz === null ? 'Sel' : `${selHz.toFixed(1)} Hz`}</button>
              <button aria-pressed={allBearings} onClick={() => setAllBearings(true)}>All</button>
            </div>
            <div className="seg" role="group" aria-label="Bearing layers">
              <button aria-pressed={showAuto} onClick={() => setShowAuto(!showAuto)} title="DIFAR-computed bearings (solid)">Auto</button>
              <button aria-pressed={showManual} onClick={() => setShowManual(!showManual)} title="Operator bearing cursors (dashed). Drag from a DIFAR buoy; double-click it to clear.">Man</button>
            </div>
            <div className="seg" role="group" aria-label="Fix from">
              {(['auto', 'manual', 'both'] as const).map((f) => <button key={f} aria-pressed={fixSource === f} onClick={() => setFixSource(f)}>{f === 'auto' ? 'Fix A' : f === 'manual' ? 'Fix M' : 'Fix A+M'}</button>)}
            </div>
            <span className="readout">
              {st.tactical ? `A/C HDG ${st.tactical.aircraft.hdgDeg.toFixed(0).padStart(3, '0')} · ${(st.tactical.aircraft.gsMps * 1.943844).toFixed(0)} KT · ${st.tactical.aircraft.altM} M` : ''}
            </span>
          </div>
          <div className="panel-body plot">
            <TacticalPlot client={client} showTruth={truth} selectedChannel={cfg?.channel} selectedHz={selHz} allBearings={allBearings}
              showAuto={showAuto} showManual={showManual} manual={manual} fixSource={fixSource} onManual={onManual} />
          </div>
        </section>
      </main>
    </div>
  )
}
