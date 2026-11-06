import { describe, expect, it } from 'vitest'
import { ARM_IDLE, armBearing, armLabel, canAim, cancelArm, isArmed, pickBuoy, toggleArm } from './bearingArm'

describe('bearing arm', () => {
  it('arms to pick-buoy, or straight to aim when a buoy is already selected', () => {
    expect(armBearing()).toEqual({ phase: 'pick-buoy' })
    expect(armBearing(3)).toEqual({ phase: 'aim', buoyId: 3 })
    expect(isArmed(armBearing())).toBe(true)
    expect(isArmed(ARM_IDLE)).toBe(false)
  })
  it('toggles and cancels back to idle', () => {
    expect(toggleArm(ARM_IDLE)).toEqual({ phase: 'pick-buoy' })
    expect(toggleArm({ phase: 'pick-buoy' })).toEqual(ARM_IDLE)
    expect(toggleArm({ phase: 'aim', buoyId: 1 })).toEqual(ARM_IDLE)
    expect(cancelArm({ phase: 'aim', buoyId: 2 })).toEqual(ARM_IDLE)
  })
  it('picks / switches the aim buoy only while armed', () => {
    expect(pickBuoy(ARM_IDLE, 1)).toEqual(ARM_IDLE)
    expect(pickBuoy({ phase: 'pick-buoy' }, 4)).toEqual({ phase: 'aim', buoyId: 4 })
    expect(pickBuoy({ phase: 'aim', buoyId: 4 }, 7)).toEqual({ phase: 'aim', buoyId: 7 })
    expect(canAim({ phase: 'aim', buoyId: 4 })).toBe(true)
    expect(canAim({ phase: 'pick-buoy' })).toBe(false)
  })
  it('labels the armed state for the BRG control', () => {
    expect(armLabel(ARM_IDLE)).toBe('BRG')
    expect(armLabel({ phase: 'pick-buoy' })).toBe('BRG · tap buoy')
    expect(armLabel({ phase: 'aim', buoyId: 2 })).toMatch(/^BRG/)
  })
})
