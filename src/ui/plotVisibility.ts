/** Plot hiding only changes the Live landscape layout, never collection or split preference. */
export function hideLandscapePlot(requested: boolean, portrait: boolean, hinge: boolean, tab: string): boolean {
  return requested && !portrait && !hinge && tab === 'live'
}
