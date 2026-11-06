/**
 * Manual-bearing arm (m3-fe-center + m3-fe-brg-freq).
 * - B / BRG with no gram hover: tactical two-tap (buoy → aim), Esc cancels.
 * - Phone BRG / touch: pick-freq — next gram tap sends DIFAR bearing at that Hz; buoy tap on the
 *   tactical plot still enters the old aim flow. Mutually exclusive with drop / other gram tools.
 */
export type BearingArm =
  | { phase: 'idle' }
  | { phase: 'pick-buoy' }
  | { phase: 'aim'; buoyId: number }
  | { phase: 'pick-freq' }

export const ARM_IDLE: BearingArm = { phase: 'idle' }

/** Arm. If a live DIFAR buoy is already selected, skip straight to aim on it. */
export function armBearing(selectedBuoyId: number | null = null): BearingArm {
  return selectedBuoyId !== null ? { phase: 'aim', buoyId: selectedBuoyId } : { phase: 'pick-buoy' }
}

/** Phone/touch: arm "tap the gram at a frequency" (current DIFAR buoy). */
export function armPickFreq(): BearingArm {
  return { phase: 'pick-freq' }
}

export function cancelArm(_a: BearingArm = ARM_IDLE): BearingArm { return ARM_IDLE }

export function toggleArm(a: BearingArm, selectedBuoyId: number | null = null): BearingArm {
  return a.phase === 'idle' ? armBearing(selectedBuoyId) : ARM_IDLE
}

/** Toggle into pick-freq (phone), or cancel if already armed. */
export function togglePickFreq(a: BearingArm): BearingArm {
  return a.phase === 'idle' ? armPickFreq() : ARM_IDLE
}

/** Tap a DIFAR buoy while armed: enter (or switch) aim — works from pick-buoy, pick-freq, or aim. */
export function pickBuoy(a: BearingArm, buoyId: number): BearingArm {
  if (a.phase === 'idle') return a
  return { phase: 'aim', buoyId }
}

/** True when a plot tap (not on a buoy) should place the bearing. */
export function canAim(a: BearingArm): a is { phase: 'aim'; buoyId: number } {
  return a.phase === 'aim'
}

export function isPickFreq(a: BearingArm): a is { phase: 'pick-freq' } {
  return a.phase === 'pick-freq'
}

export function isArmed(a: BearingArm): boolean { return a.phase !== 'idle' }

/** Short label for the BRG control / plot badge. */
export function armLabel(a: BearingArm): string {
  if (a.phase === 'pick-buoy') return 'BRG · tap buoy'
  if (a.phase === 'aim') return 'BRG · aim'
  if (a.phase === 'pick-freq') return 'BRG · tap gram'
  return 'BRG'
}
