import { TRAFFIC_STOPS, trafficLabel } from '../scenarios/acousticsApi'

/** Surface traffic (shipping noise) 0..1 with labelled stops: none, light, moderate, heavy. */
export function TrafficSlider({ value, onChange, id = 'traffic' }: { value: number; onChange: (v: number) => void; id?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>Surface traffic <b data-testid="traffic-label">{trafficLabel(value)}</b></label>
      <input id={id} type="range" min={0} max={1} step={0.05} value={value} list={`${id}-stops`}
        onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={trafficLabel(value)} />
      <datalist id={`${id}-stops`}>{TRAFFIC_STOPS.map((s) => <option key={s.v} value={s.v} label={s.label} />)}</datalist>
      <div className="stops" aria-hidden>{TRAFFIC_STOPS.map((s) => <span key={s.v} style={{ left: `${s.v * 100}%` }}>{s.label}</span>)}</div>
    </div>
  )
}
