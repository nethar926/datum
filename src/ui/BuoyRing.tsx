import { BUOY_STATUS_COLOR, BUOY_STATUS_LABEL, type BuoyHealth } from '../tactical/detune'

export function buoyTuneActions(health: BuoyHealth) {
  return { canTune: health === 'detuned', canDetune: health === 'working' || health === 'integrating' }
}

/** Existing receiver actions arranged around the selected buoy, not a new engine control. */
export function BuoyRing({ channel, directional, health, onTune, onDetune }: {
  channel: number; directional: boolean; health: BuoyHealth; onTune: () => void; onDetune: () => void
}) {
  const { canTune, canDetune } = buoyTuneActions(health)
  return <div className="buoy-ring" role="group" aria-label={`Selected buoy ${channel} controls`} data-testid="buoy-actions">
    <div className="buoy-ring-track" aria-hidden="true" />
    <div className="buoy-ring-center">
      <svg viewBox="0 0 48 48" width="44" height="44" role="img" aria-label={directional ? 'DIFAR buoy' : 'Omnidirectional buoy'}>
        <path d="M24 4v12M16 8a12 12 0 0 0 0 16M32 8a12 12 0 0 1 0 16" fill="none" stroke="currentColor" strokeWidth="2" />
        {directional ? <path d="M24 18L36 40H12Z" fill="none" stroke="currentColor" strokeWidth="2.5" /> : <circle cx="24" cy="29" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />}
      </svg>
      <strong>CH {channel}</strong>
      <span style={{ color: BUOY_STATUS_COLOR[health] }}>{BUOY_STATUS_LABEL[health]}</span>
    </div>
    <button type="button" className="btn buoy-ring-tune" data-testid="buoy-tune" disabled={!canTune}
      onClick={onTune} title="Tune: re-acquire the lowest free RX channel">TUNE</button>
    <button type="button" className="btn buoy-ring-detune" data-testid="buoy-detune" disabled={!canDetune}
      onClick={onDetune} title="Detune: stop feeding and free the RX channel">DETUNE</button>
  </div>
}
