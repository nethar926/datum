import {
  LINE_WEIGHTS, MAX_POINTS, MIN_POINTS, NAV_PATTERNS, PLANE_MODES, PLANE_MODE_LABEL, TRAIL_PATTERNS,
  applyPlaneRoute, clearPlanePoints, clearPlaneRoute, planeState, setPlaneAltitudeFt, setPlaneArm, setPlaneMode,
  setPlaneNavStyle, setPlaneRadiusNmi, setPlaneSpeedKts, setPlaneTrailStyle, type PlaneLineWeight,
} from './planeRoute'

export function PlaneMenu({ simT, fallback }: { simT: number; fallback: { x: number; y: number } }) {
  const s = planeState()
  const canFly = s.mode === 'pointToPoint'
    ? s.points.length >= MIN_POINTS && s.points.length <= MAX_POINTS
    : s.radiusNmi > 0 && s.speedKts > 0
  return (
    <div className="plane-menu" data-testid="plane-menu" role="dialog" aria-label="Plane menu">
      <div className="plane-menu-head">Plane</div>
      <div className="plane-menu-modes" role="group" aria-label="Route mode">
        {PLANE_MODES.map((m) => (
          <button key={m} type="button" aria-label={PLANE_MODE_LABEL[m]} aria-pressed={s.mode === m}
            className={s.mode === m ? 'on' : undefined}
            onClick={() => setPlaneMode(m)}>{PLANE_MODE_LABEL[m]}</button>
        ))}
      </div>
      <label className="plane-menu-field">Speed
        <input type="number" min={1} value={s.speedKts} aria-label="Speed knots"
          onChange={(e) => setPlaneSpeedKts(Number(e.target.value))} />
        <span>kts</span>
      </label>
      <label className="plane-menu-field">Altitude
        <input type="number" min={0} value={s.altitudeFt} aria-label="Altitude feet"
          onChange={(e) => setPlaneAltitudeFt(Number(e.target.value))} />
        <span>ft</span>
      </label>
      {s.mode !== 'pointToPoint' ? (
        <>
          <label className="plane-menu-field">Radius
            <input type="number" min={0.1} step={0.1} value={s.radiusNmi} aria-label="Radius nautical miles"
              onChange={(e) => setPlaneRadiusNmi(Number(e.target.value))} />
            <span>nMi</span>
          </label>
          <button type="button" aria-label="Tap the route centre"
            onClick={() => setPlaneArm(s.arm === 'centre' ? 'none' : 'centre')}>
            {s.centre == null ? 'Tap centre' : (s.arm === 'centre' ? 'Tapping centre…' : 'Centre set — retap')}
          </button>
        </>
      ) : (
        <>
          <div>Points {s.points.length}/{MAX_POINTS}  (need {MIN_POINTS}…{MAX_POINTS})</div>
          <div className="plane-menu-row">
            <button type="button" aria-label="Tap points"
              onClick={() => setPlaneArm(s.arm === 'points' ? 'none' : 'points')}>
              {s.arm === 'points' ? 'Tapping points…' : 'Tap points'}
            </button>
            <button type="button" aria-label="Clear points" onClick={() => clearPlanePoints()}>Clear</button>
          </div>
        </>
      )}
      <div className="plane-menu-row">
        <button type="button" className="fly" disabled={!canFly} onClick={() => applyPlaneRoute(simT, fallback)}>Fly route</button>
        <button type="button" onClick={() => clearPlaneRoute()}>Clear</button>
      </div>
      <div className="plane-menu-style" role="group" aria-label="Trail">
        <span>Trail</span>
        {TRAIL_PATTERNS.map((p) => (
          <button key={p} type="button" aria-label={`Trail ${p}`} aria-pressed={s.trailStyle.pattern === p}
            className={s.trailStyle.pattern === p ? 'on' : undefined}
            onClick={() => setPlaneTrailStyle({ pattern: p, weight: s.trailStyle.weight })}>{p}</button>
        ))}
        {LINE_WEIGHTS.map((w) => (
          <button key={w} type="button" aria-label={`Trail ${w}`} aria-pressed={s.trailStyle.weight === w}
            className={s.trailStyle.weight === w ? 'on' : undefined}
            onClick={() => setPlaneTrailStyle({ pattern: s.trailStyle.pattern, weight: w as PlaneLineWeight })}>{w}</button>
        ))}
      </div>
      <div className="plane-menu-style" role="group" aria-label="Nav">
        <span>Nav</span>
        {NAV_PATTERNS.map((p) => (
          <button key={p} type="button" aria-label={`Nav ${p}`} aria-pressed={s.navStyle.pattern === p}
            className={s.navStyle.pattern === p ? 'on' : undefined}
            onClick={() => setPlaneNavStyle({ pattern: p, weight: s.navStyle.weight })}>{p}</button>
        ))}
        {LINE_WEIGHTS.map((w) => (
          <button key={w} type="button" aria-label={`Nav ${w}`} aria-pressed={s.navStyle.weight === w}
            className={s.navStyle.weight === w ? 'on' : undefined}
            onClick={() => setPlaneNavStyle({ pattern: s.navStyle.pattern, weight: w as PlaneLineWeight })}>{w}</button>
        ))}
      </div>
    </div>
  )
}
