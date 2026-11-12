import { useState } from 'react'
import {
  ALTITUDE_FEET_OPTIONS, DETUNED_LABEL, INTEGRATION_TIME_S_OPTIONS,
  START_MODE_LABEL, UNPLACED_LAYOUT_LABEL,
  loadSequencePrefs, phaseDetail, phaseLabel, preferredAltitudeFeet, saveSequencePrefs,
  symbolFill, type MappedGramPhase, type SequencePrefs, type StartMode, type UnplacedLayout,
} from './buoySequence'

/** Variable-colour buoy glyph: waves light in step with `symbolFill` (0…1). */
export function BuoySymbolFill({ value, size = 16 }: { value: number; size?: number }) {
  const v = Math.min(1, Math.max(0, value))
  // Three wave rings, stepped with the five phases (0, 0.25, 0.5, 0.75, 1).
  const rings = [0.15, 0.4, 0.7]
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="buoy-symbol-fill" data-testid="buoy-symbol-fill" data-fill={v.toFixed(3)} aria-hidden>
      <circle cx="4.5" cy="8" r="1.6" fill="currentColor" opacity={v >= 0.01 ? 1 : 0.22} />
      {rings.map((thr, i) => {
        const r = 3.2 + i * 2.4
        const on = v >= thr
        const mid = on ? Math.min(1, (v - thr) / 0.25 + 0.35) : 0.12
        return (
          <path key={i}
            d={`M ${4.5 + r * 0.15} ${8 - r} A ${r} ${r} 0 0 1 ${4.5 + r * 0.15} ${8 + r}`}
            fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity={mid} />
        )
      })}
    </svg>
  )
}

export function BuoyPhaseStatus({
  phase, rate = 1, playing = true, detuned = false,
}: {
  phase: MappedGramPhase
  rate?: number
  playing?: boolean
  detuned?: boolean
}) {
  const fill = symbolFill(phase)
  const label = detuned ? DETUNED_LABEL : phaseLabel(phase)
  const detail = detuned ? null : phaseDetail(phase, rate, playing)
  return (
    <div className="gram-buoy-status" data-testid="gram-buoy-status" data-phase={phase.name} data-fill={fill.toFixed(3)}>
      <BuoySymbolFill value={fill} />
      <span className="gram-buoy-label">{label}</span>
      {detail && <span className="gram-buoy-detail">{detail}</span>}
    </div>
  )
}

function setPref(patch: Partial<SequencePrefs>, current: SequencePrefs, set: (p: SequencePrefs) => void) {
  const next = { ...current, ...patch }
  set(next)
  saveSequencePrefs(next)
}

/** Settings / New-scenario Advanced: start mode, altitude, integration. */
export function BuoySequenceSettings({ testId = 'buoy-sequence-settings' }: { testId?: string }) {
  const [prefs, setPrefs] = useState(loadSequencePrefs)
  const ft = preferredAltitudeFeet(prefs)
  const integ = prefs.integrationTimeS
  return (
    <div className="ios-section" data-testid={testId}>
      <h3>Advanced</h3>
      <div className="ios-group">
        <div className="ios-row">
          <span className="row-label">Start mode</span>
          <div className="seg ios-seg" role="group" aria-label="Start mode" data-testid="start-mode-seg">
            {(['placed', 'unplaced'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={prefs.startMode === k} data-testid={`start-mode-${k}`}
                onClick={() => setPref({ startMode: k }, prefs, setPrefs)}>{START_MODE_LABEL[k as StartMode]}</button>
            ))}
          </div>
        </div>
        {prefs.startMode === 'unplaced' && (
          <div className="ios-row">
            <span className="row-label">On Start</span>
            <div className="seg ios-seg" role="group" aria-label="Unplaced on Start" data-testid="unplaced-layout-seg">
              {(['pattern', 'manual'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={prefs.unplacedLayout === k} data-testid={`unplaced-${k}`}
                  onClick={() => setPref({ unplacedLayout: k }, prefs, setPrefs)}>
                  {k === 'pattern' ? 'Standard pattern' : 'Manual'}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="ios-row">
          <span className="row-label">Drop altitude</span>
          <div className="seg ios-seg" role="group" aria-label="Drop altitude" data-testid="altitude-seg">
            {ALTITUDE_FEET_OPTIONS.map((o) => (
              <button key={o} type="button" aria-pressed={ft === o} data-testid={`altitude-${o}`}
                onClick={() => setPref({ dropAltitudeM: o * 0.3048 }, prefs, setPrefs)}>{o} ft</button>
            ))}
          </div>
        </div>
        <div className="ios-row">
          <span className="row-label">Integration</span>
          <div className="seg ios-seg" role="group" aria-label="Integration time" data-testid="integration-seg">
            {INTEGRATION_TIME_S_OPTIONS.map((s) => (
              <button key={s} type="button" aria-pressed={integ === s} data-testid={`integration-${s}`}
                onClick={() => setPref({ integrationTimeS: s }, prefs, setPrefs)}>{s} s</button>
            ))}
          </div>
        </div>
      </div>
      <p className="ios-foot">
        {prefs.startMode === 'placed'
          ? 'Placed: buoys already in the water; grams start on Start. '
          : prefs.unplacedLayout === 'pattern'
            ? 'Unplaced: grams show Buoy Loaded. A standard field drops on Start. '
            : 'Unplaced: grams show Buoy Loaded. Nothing lays until you pick a pattern. '}
        Drop altitude (default 1,500 ft) and integration (5–10 s, default 5) are passed to the engine when it accepts them — the app never counts phase time itself.
        {UNPLACED_LAYOUT_LABEL[prefs.unplacedLayout as UnplacedLayout] ? '' : ''}
      </p>
    </div>
  )
}

/** Compact Advanced fields for the New scenario accordion (same prefs). */
export function BuoySequenceAdvancedFields() {
  const [prefs, setPrefs] = useState(loadSequencePrefs)
  const ft = preferredAltitudeFeet(prefs)
  return (
    <div className="ns-seq" data-testid="ns-buoy-sequence">
      <div className="field">
        <label>Start mode</label>
        <div className="seg" role="group" aria-label="Start mode">
          {(['placed', 'unplaced'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={prefs.startMode === k} data-testid={`ns-start-mode-${k}`}
              onClick={() => setPref({ startMode: k }, prefs, setPrefs)}>{START_MODE_LABEL[k]}</button>
          ))}
        </div>
      </div>
      {prefs.startMode === 'unplaced' && (
        <div className="field">
          <label>On Start</label>
          <div className="seg" role="group" aria-label="Unplaced on Start">
            {(['pattern', 'manual'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={prefs.unplacedLayout === k} data-testid={`ns-unplaced-${k}`}
                onClick={() => setPref({ unplacedLayout: k }, prefs, setPrefs)}>
                {k === 'pattern' ? 'Standard pattern' : 'Manual'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label>Drop altitude <b>{ft} ft</b></label>
        <div className="seg" role="group" aria-label="Drop altitude">
          {ALTITUDE_FEET_OPTIONS.map((o) => (
            <button key={o} type="button" aria-pressed={ft === o} data-testid={`ns-altitude-${o}`}
              onClick={() => setPref({ dropAltitudeM: o * 0.3048 }, prefs, setPrefs)}>{o} ft</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Integration <b>{prefs.integrationTimeS} s</b></label>
        <div className="seg" role="group" aria-label="Integration time">
          {INTEGRATION_TIME_S_OPTIONS.map((s) => (
            <button key={s} type="button" aria-pressed={prefs.integrationTimeS === s} data-testid={`ns-integration-${s}`}
              onClick={() => setPref({ integrationTimeS: s }, prefs, setPrefs)}>{s} s</button>
          ))}
        </div>
      </div>
    </div>
  )
}
