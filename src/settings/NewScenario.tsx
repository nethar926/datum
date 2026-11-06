import { useEffect, useState } from 'react'
import { acousticsV11, trafficLabel, type Difficulty, type ScenarioParams } from '../scenarios/acousticsApi'
import { applyPlant, loadSimStart, parseSeed, randomSeed, plantOfWeights, PLANT_PICKS, saveSimStart, type PlantPick, type SimStartPrefs } from './simStart'
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

/** New-sim screen. Random is the default: three difficulties and Diesel / Nuke / Any, then Start.
 * Advanced opens the full manual setup; the sliders show exactly what will run. */
export function NewScenario({ onStart, onClose }: { onStart: (p: ScenarioParams) => void; onClose: () => void }) {
  const api = acousticsV11
  const [prefs, setPrefs] = useState<SimStartPrefs>(loadSimStart)
  const [seed, setSeedRaw] = useState(randomSeed)
  const [seedText, setSeedText] = useState(() => String(seed))
  const seedBad = parseSeed(seedText) === null
  const setSeed = (s: number) => { setSeedRaw(s); setSeedText(String(s)); if (custom) setCustom({ ...custom, seed: s }) }
  const typeSeed = (t: string) => { setSeedText(t); const v = parseSeed(t); if (v !== null) { setSeedRaw(v); if (custom) setCustom({ ...custom, seed: v }) } }
  const [adv, setAdv] = useState(false)
  const [custom, setCustom] = useState<ScenarioParams | null>(null)
  const preset = (d: Difficulty, pl: PlantPick, s: number) => api.presetToParams ? applyPlant(api.presetToParams(d, s), pl) : null
  const p = custom ?? preset(prefs.diff, prefs.plant, seed)
  useEffect(() => saveSimStart(prefs), [prefs])
  const pick = (patch: Partial<SimStartPrefs>) => { setPrefs((v) => ({ ...v, ...patch })); setCustom(null) }
  const edit = (patch: Partial<ScenarioParams>) => { if (p) setCustom(api.clampParams ? api.clampParams({ ...p, ...patch }) : { ...p, ...patch }) }
  const editOp = (patch: Partial<ScenarioParams['opState']>) => p && edit({ opState: { ...p.opState, ...patch } })
  const plantNow = p ? plantOfWeights(p.rarityWeights) : prefs.plant
  const subs = p ? `${p.subCount} sub${p.subCount === 1 ? '' : 's'}` : ''

  return (
    <div className="modal-scrim" role="dialog" aria-modal aria-labelledby="ns-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" data-testid="sim-start">
        <div className="modal-head"><h2 id="ns-title">New sim</h2><button onClick={onClose} aria-label="Close">✕</button></div>
        {!p ? (
          <p className="empty-note static" data-testid="ns-pending">Difficulty presets arrive with the next acoustics update. Until then the training field scenario runs.</p>
        ) : (<>
          <div className="ns-group">
            <span className="seg-label">RANDOM</span>
            <div className="seg big" role="radiogroup" aria-label="Difficulty" data-testid="ns-diff">
              {DIFFS.map((d) => <button key={d.id} role="radio" aria-checked={!custom && prefs.diff === d.id} aria-pressed={!custom && prefs.diff === d.id} onClick={() => pick({ diff: d.id })}>{d.label}</button>)}
            </div>
            <span className="seg-label">BOATS</span>
            <div className="seg big" role="radiogroup" aria-label="Boats" data-testid="ns-plant">
              {PLANT_PICKS.map((d) => <button key={d.id} role="radio" aria-checked={plantNow === d.id} aria-pressed={plantNow === d.id}
                onClick={() => custom ? setCustom(applyPlant({ ...custom, rarityWeights: preset(prefs.diff, 'any', seed)!.rarityWeights }, d.id)) : pick({ plant: d.id })}>{d.label}</button>)}
            </div>
            <label className="seg-label" htmlFor="ns-seed">SEED</label>
            <div className="ns-seed">
              <input id="ns-seed" data-testid="ns-seed" className={seedBad ? 'bad' : ''} inputMode="numeric" autoComplete="off" spellCheck={false} value={seedText}
                aria-invalid={seedBad} aria-describedby="ns-seed-note" onChange={(e) => typeSeed(e.target.value)} onFocus={(e) => e.target.select()} />
              <button className="btn" data-testid="ns-seed-new" aria-label="New random seed" onClick={() => setSeed(randomSeed())}>New</button>
              {prefs.lastSeed !== undefined && prefs.lastSeed !== seed && <button className="btn" data-testid="ns-seed-last" onClick={() => setSeed(prefs.lastSeed!)}>Last {prefs.lastSeed}</button>}
            </div>
            <p id="ns-seed-note" className={`ns-seed-note${seedBad ? ' bad' : ''}`}>{seedBad ? 'Seed is a whole number, 0 to 4294967295' : 'Same seed and settings replay the same scenario'}</p>
            <p className="ns-summary" data-testid="ns-summary">
              {custom ? 'CUSTOM · ' : ''}{subs} · {PLANT_PICKS.find((x) => x.id === plantNow)!.label.toUpperCase()} · SEA {p.seaState} · {trafficLabel(p.surfaceTraffic).toUpperCase()} TRAFFIC
            </p>
          </div>
          <button className="btn ns-adv-toggle" aria-expanded={adv} aria-controls="ns-adv" data-testid="ns-advanced" onClick={() => setAdv((v) => !v)}>
            <span className={`chev ${adv ? 'open' : ''}`} aria-hidden>▸</span> Advanced{custom ? ' · custom' : ''}
          </button>
          {adv && <div className="fields ns-adv" id="ns-adv" data-testid="ns-adv">
            <Num label="Submarines" value={p.subCount} min={1} max={6} step={1} onChange={(v) => edit({ subCount: v })} />
            <Num label="Sea state" value={p.seaState} min={0} max={6} step={1} onChange={(v) => edit({ seaState: v })} />
            <TrafficSlider id="ns-traffic" value={p.surfaceTraffic} onChange={(v) => edit({ surfaceTraffic: v })} />
            <Range label="Speed" unit="kt" value={p.opState.speedKn} min={0} max={30} step={1} onChange={(v) => editOp({ speedKn: v })} />
            <Range label="Depth" unit="m" value={p.opState.depthM} min={0} max={400} step={5} onChange={(v) => editOp({ depthM: v })} />
            <Num label="Quiet running" value={p.opState.quietProb} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => editOp({ quietProb: v })} />
            <Range label="CPA range" unit="km" value={p.cpaRangeKm} min={0.1} max={10} step={0.1} onChange={(v) => edit({ cpaRangeKm: v })} />
            <Num label="Buoy life" value={p.buoyLifeMin} min={10} max={480} step={10} fmt={(v) => `${Math.round(v)} min`} onChange={(v) => edit({ buoyLifeMin: v })} />
            <label className="check"><input type="checkbox" checked={p.opState.cavitationAllowed} onChange={(e) => editOp({ cavitationAllowed: e.target.checked })} /> Cavitation allowed</label>
            {custom && <button className="btn" data-testid="ns-back-random" onClick={() => setCustom(null)}>Back to {DIFFS.find((d) => d.id === prefs.diff)!.label} preset</button>}
          </div>}
        </>)}
        <div className="modal-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!p || seedBad} data-testid="ns-start" onClick={() => { if (!p || seedBad) return; setPrefs((v) => { const n = { ...v, lastSeed: seed }; saveSimStart(n); return n }); onStart({ ...p, seed }) }}>Start</button>
        </div>
      </div>
    </div>
  )
}
