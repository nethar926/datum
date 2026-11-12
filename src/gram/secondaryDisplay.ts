/**
 * Companion-pane (secondary) display, matching native `SecondaryDisplay`.
 * The web pane already shows the tactical plot; this adds BFI as an option
 * for parity. BFI is DIFAR only — on omni it resolves back to the plot.
 * Independent of the main-display BFI toggle (`datum.bfi`).
 */
export const SECONDARY_KEY = 'datum.secondary'

export const SECONDARY_DISPLAYS = ['plot', 'bfi'] as const
export type SecondaryDisplay = (typeof SECONDARY_DISPLAYS)[number]

export const SECONDARY_TITLE: Record<SecondaryDisplay, string> = {
  plot: 'Plot',
  bfi: 'BFI',
}

export function parseSecondary(v: unknown): SecondaryDisplay {
  return v === 'bfi' ? 'bfi' : 'plot'
}

export function loadSecondary(): SecondaryDisplay {
  try { return parseSecondary(localStorage.getItem(SECONDARY_KEY)) } catch { return 'plot' }
}

export function saveSecondary(d: SecondaryDisplay): void {
  try { localStorage.setItem(SECONDARY_KEY, d) } catch { /* private mode */ }
}

/** BFI needs a DIFAR buoy; otherwise the pane stays on the plot. */
export function resolveSecondary(choice: SecondaryDisplay, selectedIsDifar: boolean): SecondaryDisplay {
  if (choice === 'bfi') return selectedIsDifar ? 'bfi' : 'plot'
  return 'plot'
}

export function fillsCompanion(d: SecondaryDisplay): boolean {
  return d === 'plot' || d === 'bfi'
}
