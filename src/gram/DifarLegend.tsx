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

/**
 * Compact 44 pt glass control that opens the DIFAR wheel popover.
 * Replaces the always-on overlay legend so the gram stays clear of chrome.
 */
export function DifarWheelButton({ omni = false, wheel = DEFAULT_WHEEL, open = false, onOpen }: {
  omni?: boolean; wheel?: DifarWheelSettings; open?: boolean; onOpen?: () => void
}) {
  const custom = !isDefaultWheel(wheel)
  const label = omni
    ? 'DIFAR bearing colour wheel (omni buoy, no bearing). Tap to adjust.'
    : custom
      ? 'DIFAR bearing colour wheel (custom). Tap to rotate, null or isolate bearings, or change steps and look'
      : 'DIFAR bearing colour wheel. Tap to rotate, null or isolate bearings, or change steps and look'
  return (
    <button type="button"
      className={`btn icon glass wheel-btn${custom ? ' custom' : ''}${open ? ' open' : ''}`}
      data-testid="difar-wheel-btn"
      data-custom={custom ? '1' : '0'}
      data-omni={omni ? '1' : '0'}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={omni ? 'OMNI · NO BRG — tap to open wheel' : custom ? 'BRG · CUSTOM — tap to open wheel' : 'BRG = HUE — tap to open wheel'}
      onClick={onOpen}
    ><span className="wheel-hue-ring" style={{ background: isDefaultWheel(wheel) ? DIFAR_CONIC : wheelConic(wheel) }} aria-hidden /></button>
  )
}

/** @deprecated Prefer DifarWheelButton — kept as an alias so older imports keep typechecking during the move. */
export const DifarLegend = DifarWheelButton
