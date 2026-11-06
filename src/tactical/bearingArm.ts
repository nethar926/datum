/**
 * Manual-bearing arm mode (m3-fe-center): B / BRG arms, then buoy → aim, Esc cancels.
 * Pure state machine; the plot still accepts drag-to-set when not in the two-tap path.
 */
export type BearingArm =
  | { phase: 'idle' }
  | { phase: 'pick-buoy' }
  | { phase: 'aim'; buoyId: number }

export const ARM_IDLE: BearingArm = { phase: 'idle' }

/** Arm. If a live DIFAR buoy is already selected, skip straight to aim on it. */
export function armBearing(selectedBuoyId: number | null = null): BearingArm {
  return selectedBuoyId !== null ? { phase: 'aim', buoyId: selectedBuoyId } : { phase: 'pick-buoy' }
}

export function cancelArm(_a: BearingArm = ARM_IDLE): BearingArm { return ARM_IDLE }

export function toggleArm(a: BearingArm, selectedBuoyId: number | null = null): BearingArm {
  return a.phase === 'idle' ? armBearing(selectedBuoyId) : ARM_IDLE
}

/** Tap a DIFAR buoy while armed: enter (or switch) aim. */
export function pickBuoy(a: BearingArm, buoyId: number): BearingArm {
  if (a.phase === 'idle') return a
  return { phase: 'aim', buoyId }
}

/** True when a plot tap (not on a buoy) should place the bearing. */
export function canAim(a: BearingArm): a is { phase: 'aim'; buoyId: number } {
  return a.phase === 'aim'
}

export function isArmed(a: BearingArm): boolean { return a.phase !== 'idle' }

/** Short label for the BRG control / plot badge. */
export function armLabel(a: BearingArm): string {
  if (a.phase === 'pick-buoy') return 'BRG · tap buoy'
  if (a.phase === 'aim') return 'BRG · aim'
  return 'BRG'
}
