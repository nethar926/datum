import { useState } from 'react'
import { acousticsV11, type Difficulty, type ScenarioParams } from '../scenarios/acousticsApi'
import { TrafficSlider } from './TrafficSlider'

const DIFFS: { id: Difficulty; label: string }[] = [{ id: 'easy', label: 'Easy' }, { id: 'regular', label: 'Regular' }, { id: 'difficult', label: 'Difficult' }]

function Num({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="field">
      <label>{label} <b>{fmt ? fmt(value) : value}</b></label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  )
}
function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: [number, number]; min: number; max: number; step: number; unit: string; onChange: (v: [number, number]) => void }) {
  return (
    <div className="field">
      <label>{label} <b>{value[0]}–{value[1]} {unit}</b></label>
      <div className="pair">
        <input type="range" min={min} max={max} step={step} value={value[0]} aria-label={`${label} min`} onChange={(e) => onChange([Math.min(Number(e.target.value), value[1]), value[1]])} />
        <input type="range" min={min} max={max} step={step} value={value[1]} aria-label={`${label} max`} onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0])])} />
      </div>
    </div>
  )
}

/** New-scenario screen: a difficulty preset fills plain, editable parameters; the sliders show exactly what will run. */
export function NewScenario({ onStart, onClose }: { onStart: (p: ScenarioParams) => void; onClose: () => void }) {
  const api = acousticsV11
  const [seed, setSeed] = useState(() => (Math.random() * 2 ** 31) >>> 0)
  const [diff, setDiff] = useState<Difficulty | 'custom'>('regular')
  const [p, setP] = useState<ScenarioParams | null>(() => api.presetToParams?.('regular', seed) ?? null)
  const pick = (d: Difficulty) => { setDiff(d); setP(api.presetToParams!(d, seed)) }
  const edit = (patch: Partial<ScenarioParams>) => { if (p) { setDiff('custom'); setP(api.clampParams ? api.clampParams({ ...p, ...patch }) : { ...p, ...patch }) } }
  const editOp = (patch: Partial<ScenarioParams['opState']>) => p && edit({ opState: { ...p.opState, ...patch } })

  return (
    <div className="modal-scrim" role="dialog" aria-modal aria-labelledby="ns-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <div className="modal-head"><h2 id="ns-title">New scenario</h2><button onClick={onClose} aria-label="Close">✕</button></div>
        {!p ? (
          <p className="empty-note static" data-testid="ns-pending">Difficulty presets arrive with the next acoustics update. Until then the training field scenario runs.</p>
        ) : (<>
          <div className="seg big" role="radiogroup" aria-label="Difficulty">
            {DIFFS.map((d) => <button key={d.id} role="radio" aria-checked={diff === d.id} aria-pressed={diff === d.id} onClick={() => pick(d.id)}>{d.label}</button>)}
            {diff === 'custom' && <span className="readout">CUSTOM</span>}
          </div>
          <div className="fields">
            <Num label="Submarines" value={p.subCount} min={1} max={6} step={1} onChange={(v) => edit({ subCount: v })} />
            <Num label="Sea state" value={p.seaState} min={0} max={6} step={1} onChange={(v) => edit({ seaState: v })} />
            <TrafficSlider id="ns-traffic" value={p.surfaceTraffic} onChange={(v) => edit({ surfaceTraffic: v })} />
            <Range label="Speed" unit="kt" value={p.opState.speedKn} min={0} max={30} step={1} onChange={(v) => editOp({ speedKn: v })} />
            <Range label="Depth" unit="m" value={p.opState.depthM} min={0} max={400} step={5} onChange={(v) => editOp({ depthM: v })} />
            <Num label="Quiet running" value={p.opState.quietProb} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => editOp({ quietProb: v })} />
            <Range label="CPA range" unit="km" value={p.cpaRangeKm} min={0.1} max={10} step={0.1} onChange={(v) => edit({ cpaRangeKm: v })} />
            <Num label="Buoy life" value={p.buoyLifeMin} min={10} max={480} step={10} fmt={(v) => `${Math.round(v)} min`} onChange={(v) => edit({ buoyLifeMin: v })} />
            <label className="check"><input type="checkbox" checked={p.opState.cavitationAllowed} onChange={(e) => editOp({ cavitationAllowed: e.target.checked })} /> Cavitation allowed</label>
            <div className="field"><label>Seed <b>{seed}</b></label>
              <button onClick={() => { const s = (Math.random() * 2 ** 31) >>> 0; setSeed(s); if (diff !== 'custom') setP(api.presetToParams!(diff, s)); else edit({ seed: s }) }}>New seed</button></div>
          </div>
        </>)}
        <div className="modal-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!p} onClick={() => p && onStart({ ...p, seed })}>Start</button>
        </div>
      </div>
    </div>
  )
}
