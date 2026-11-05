import { difarRgb } from '../gl/colormap'

const css = (r: number, g: number, b: number) => `rgb(${r} ${g} ${b})`
/** CSS conic gradient sampled from difarRgb every 10° (the same full 360° wheel the gram uses), clockwise from north. */
export const DIFAR_CONIC = `conic-gradient(from 0deg, ${Array.from({ length: 37 }, (_, i) => { const [r, g, b] = difarRgb(i * 10); return `${css(r, g, b)} ${i * 10}deg` }).join(', ')})`

/** Small compass legend for the DIFAR gram: bearing hue wheel with N/E/S/W ticks. */
export function DifarLegend({ omni = false }: { omni?: boolean }) {
  return (
    <div className="difar-legend" data-testid="difar-legend" aria-label="DIFAR bearing colour wheel: north red, east yellow, south blue, west violet">
      <div className="difar-wheel" style={{ background: DIFAR_CONIC }}>
        <span className="n">N</span><span className="e">E</span><span className="s">S</span><span className="w">W</span>
        <i />
      </div>
      <div className="difar-note">{omni ? 'OMNI · NO BRG' : 'BRG = HUE'}</div>
    </div>
  )
}
