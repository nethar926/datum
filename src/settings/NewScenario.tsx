import { useEffect, useState } from 'react'
import { acousticsV11, trafficLabel, type Difficulty, type ScenarioParams } from '../scenarios/acousticsApi'
import { applyPlant, loadSimStart, parseSeed, randomSeed, plantOfWeights, PLANT_PICKS, saveSimStart, COMING_SOON_LABEL, isPlantComingSoon, type PlantPick, type SimStartPrefs } from './simStart'
import { TrafficSlider } from './TrafficSlider'
import { SCENARIOS, SCENARIO_LABEL } from '../scenarios/training'

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

/** New-sim screen. Random is the default: three difficulties and Diesel / Any, then Start.
 * Nuke stays listed as Coming soon (disabled). Advanced opens the full manual setup. */
export function NewScenario({ onStart, onStartTraining, onClose, activeRun = false }: { onStart: (p: ScenarioParams, difficulty: 'easy' | 'regular' | 'difficult') => void; onStartTraining: (id: string, traffic: number) => void; onClose: () => void; activeRun?: boolean }) {
  const [scenarioId, setScenarioId] = useState('generated')
  const [trafficOn, setTrafficOn] = useState(true)
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
  const raw = custom ?? preset(prefs.diff, prefs.plant, seed)
  const p = raw ? { ...raw, surfaceTraffic: trafficOn ? raw.surfaceTraffic : 0 } : null
  useEffect(() => saveSimStart(prefs), [prefs])
  const pick = (patch: Partial<SimStartPrefs>) => { setPrefs((v) => ({ ...v, ...patch })); setCustom(null) }
  const edit = (patch: Partial<ScenarioParams>) => { if (raw) setCustom(api.clampParams ? api.clampParams({ ...raw, ...patch }) : { ...raw, ...patch }) }
  const editOp = (patch: Partial<ScenarioParams['opState']>) => p && edit({ opState: { ...p.opState, ...patch } })
  // Radiogroup follows the trainee pick; weights alone look like diesel after nuclear is zeroed.
  const plantSelRaw = custom && p ? plantOfWeights(p.rarityWeights) : prefs.plant
  const plantNow = isPlantComingSoon(plantSelRaw) ? 'any' : plantSelRaw
  const subs = p ? `${p.subCount} sub${p.subCount === 1 ? '' : 's'}` : ''

  return (
    <div className="modal-scrim" role="dialog" aria-modal aria-labelledby="ns-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" data-testid="sim-start">
        <div className="modal-head"><h2 id="ns-title">Scenario</h2><button onClick={onClose} aria-label="Close">✕</button></div>
        <p className="ns-seed-note" data-testid="ns-start-note">Changes apply only when you press Start.{activeRun ? ' Starting replaces the current run.' : ''}</p>
        <label className="field">Scenario
          <select className="ios-select" data-testid="scenario-select" aria-label="Scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            <option value="generated">Procedural sim</option>
            {SCENARIOS.map((id) => <option key={id} value={id}>{SCENARIO_LABEL[id]}</option>)}
          </select>
        </label>
        <label className="ios-row"><span className="row-label">Surface traffic<small>For the next start, not the current run</small></span>
          <input type="checkbox" role="switch" className="ios-switch" aria-label="Surface traffic" data-testid="ns-traffic-toggle" checked={trafficOn} onChange={(e) => setTrafficOn(e.target.checked)} />
        </label>
        {scenarioId !== 'generated' ? <p className="ns-summary">Preplanned training field. Press Start to load it.</p> : !p ? (
          <p className="empty-note static" data-testid="ns-pending">Difficulty presets arrive with the next acoustics update. Until then the training field scenario runs.</p>
        ) : (<>
          <div className="ns-group">
            <span className="seg-label">RANDOM</span>
            <div className="seg big" role="radiogroup" aria-label="Difficulty" data-testid="ns-diff">
              {DIFFS.map((d) => <button key={d.id} role="radio" aria-checked={!custom && prefs.diff === d.id} aria-pressed={!custom && prefs.diff === d.id} onClick={() => pick({ diff: d.id })}>{d.label}</button>)}
            </div>
            <span className="seg-label">BOATS</span>
            <div className="seg big" role="radiogroup" aria-label="Boats" data-testid="ns-plant">
              {PLANT_PICKS.map((d) => {
                const soon = !!d.comingSoon || isPlantComingSoon(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={!soon && plantNow === d.id}
                    aria-pressed={!soon && plantNow === d.id}
                    aria-disabled={soon || undefined}
                    disabled={soon}
                    className={soon ? 'coming-soon' : undefined}
                    data-coming-soon={soon ? '1' : undefined}
                    data-testid={d.id === 'nuclear' ? 'ns-plant-nuclear' : undefined}
                    onClick={soon ? undefined : () => custom
                      ? setCustom(applyPlant({ ...custom, rarityWeights: preset(prefs.diff, 'any', seed)!.rarityWeights }, d.id))
                      : pick({ plant: d.id })}
                  >
                    {d.label}
                    {soon && <span className="ns-coming-soon" data-testid="ns-plant-coming-soon">{COMING_SOON_LABEL}</span>}
                  </button>
                )
              })}
            </div>
            <label className="seg-label" htmlFor="ns-seed">SEED</label>
            <div className="ns-seed">
              <input id="ns-seed" data-testid="ns-seed" className={seedBad ? 'bad' : ''} inputMode="numeric" autoComplete="off" spellCheck={false} value={seedText}
                aria-invalid={seedBad} aria-describedby="ns-seed-note" onChange={(e) => typeSeed(e.target.value)} onFocus={(e) => e.target.select()} />
              <button className="btn ns-randomize" data-testid="ns-seed-new" aria-label={`Randomize within ${plantNow === 'any' ? 'any plant' : 'diesel'}`} title="New random scenario, same plant filter" onClick={() => setSeed(randomSeed())}>⚄ Randomize</button>
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
            {trafficOn && <TrafficSlider id="ns-traffic" value={p.surfaceTraffic} onChange={(v) => edit({ surfaceTraffic: v })} />}
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
          <button className="primary" disabled={scenarioId === 'generated' && (!p || seedBad)} data-testid="ns-start" onClick={() => { if (scenarioId !== 'generated') { onStartTraining(scenarioId, trafficOn ? raw?.surfaceTraffic ?? 0.5 : 0); return }; if (!p || seedBad) return; setPrefs((v) => { const n = { ...v, lastSeed: seed }; saveSimStart(n); return n }); onStart({ ...p, seed }, prefs.diff) }}>{activeRun ? 'Start new run' : 'Start'}</button>
        </div>
      </div>
    </div>
  )
}
