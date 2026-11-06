import { DEFAULT_WHEEL, wheelRgb, type DifarWheelSettings } from '../gl/colormap'
import { isDefaultWheel } from './wheelSettings'

const css = (r: number, g: number, b: number) => `rgb(${r} ${g} ${b})`
/** CSS conic gradient sampled from the operator wheel every 2° (hard steps stay crisp), clockwise from north. */
export function wheelConic(w: DifarWheelSettings = DEFAULT_WHEEL, stepDeg = 2): string {
  const n = Math.round(360 / stepDeg), stops: string[] = []
  for (let i = 0; i <= n; i++) { const d = i * stepDeg, [r, g, b] = wheelRgb(d % 360, w); stops.push(`${css(r, g, b)} ${d}deg`) }
  return `conic-gradient(from 0deg, ${stops.join(', ')})`
}
/** Default wheel, kept for tests and static use. */
export const DIFAR_CONIC = (() => {
  const stops = Array.from({ length: 37 }, (_, i) => { const [r, g, b] = wheelRgb(i * 10); return `${css(r, g, b)} ${i * 10}deg` })
  return `conic-gradient(from 0deg, ${stops.join(', ')})`
})()

/** Compass legend for the DIFAR gram. Tap to open the wheel applet; shows a dot when settings differ from default. */
export function DifarLegend({ omni = false, wheel = DEFAULT_WHEEL, onOpen }: { omni?: boolean; wheel?: DifarWheelSettings; onOpen?: () => void }) {
  const custom = !isDefaultWheel(wheel)
  return (
    <button type="button" className={`difar-legend${custom ? ' custom' : ''}`} data-testid="difar-legend" onClick={onOpen}
      aria-label="DIFAR bearing colour wheel: tap to rotate, null or isolate bearings, or change steps and look" title="Tap to adjust the bearing wheel">
      <div className="difar-wheel" style={{ background: isDefaultWheel(wheel) ? DIFAR_CONIC : wheelConic(wheel) }}>
        <span className="n">N</span><span className="e">E</span><span className="s">S</span><span className="w">W</span>
        <i />
      </div>
      <div className="difar-note">{omni ? 'OMNI · NO BRG' : custom ? 'BRG · CUSTOM' : 'BRG = HUE'}</div>
    </button>
  )
}
