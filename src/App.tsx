import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { SimClient } from './engine/client'
import type { Band } from './engine/contract'
import { Lofar } from './gram/Lofar'
import { clampView, type FreqView } from './gram/axis'
import { TacticalPlot } from './tactical/TacticalPlot'

const RATES = [1, 4, 16]
const BAND_MAX: Record<Band, number> = { lofar1k: 1000, lofar2k: 2000 }
const fmtT = (s: number) => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` }

export default function App() {
  const client = useMemo(() => new SimClient(), [])
  const st = useSyncExternalStore(client.subscribe, client.getStatus)
  const [stream, setStream] = useState(0)
  const [view, setView] = useState<FreqView>({ lo: 0, hi: 1000 })
  const [truth, setTruth] = useState(false)

  useEffect(() => {
    client.start()
    const q = new URLSearchParams(location.search)
    if (q.has('autoplay')) { client.setRate(Number(q.get('rate')) || 16); client.setPlaying(true) }
    return () => client.dispose()
  }, [client])

  const changeBand = (b: Band) => { client.setBand(b); setView({ lo: 0, hi: BAND_MAX[b] }) }
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
          <label className="seg" style={{ padding: '2px 8px', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> Truth
          </label>
        </div>
        <span className="readout">T+{fmtT(st.simT)}</span>
      </header>

      <main className="workspace">
        <section className="panel">
          <div className="panel-head">
            <h2>LOFAR</h2>
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
                onView={(v) => setView(clampView(v, BAND_MAX[st.band]))} />
            )}
            {st.error && <div className="gl-error">Simulation error: {st.error}</div>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Tactical</h2>
            <span className="readout">
              {st.tactical ? `A/C HDG ${st.tactical.aircraft.hdgDeg.toFixed(0).padStart(3, '0')} · ${(st.tactical.aircraft.gsMps * 1.943844).toFixed(0)} KT · ${st.tactical.aircraft.altM} M` : ''}
            </span>
          </div>
          <div className="panel-body plot">
            <TacticalPlot client={client} showTruth={truth} selectedChannel={cfg?.channel} />
          </div>
        </section>
      </main>
    </div>
  )
}
