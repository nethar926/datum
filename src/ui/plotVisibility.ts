/** Plot hiding only changes the Live landscape layout, never collection or split preference. */
export function hideLandscapePlot(requested: boolean, portrait: boolean, hinge: boolean, tab: string): boolean {
  return requested && !portrait && !hinge && tab === 'live'
}

const PLOT_HIDDEN_KEY = 'datum.ui.landscapePlotHidden.v1'

/** Remember the requested layout, not temporary portrait/hinge overrides. */
export function loadLandscapePlotHidden(): boolean {
  try { return localStorage.getItem(PLOT_HIDDEN_KEY) === '1' } catch { return false }
}

export function saveLandscapePlotHidden(hidden: boolean): void {
  try { localStorage.setItem(PLOT_HIDDEN_KEY, hidden ? '1' : '0') } catch { /* private mode */ }
}
