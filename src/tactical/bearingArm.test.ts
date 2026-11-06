import { describe, expect, it } from 'vitest'
import {
  ARM_IDLE, armBearing, armLabel, armPickFreq, canAim, cancelArm, isArmed, isPickFreq, pickBuoy,
  toggleArm, togglePickFreq,
} from './bearingArm'

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
  it('picks / switches the aim buoy only while armed (including from pick-freq)', () => {
    expect(pickBuoy(ARM_IDLE, 1)).toEqual(ARM_IDLE)
    expect(pickBuoy({ phase: 'pick-buoy' }, 4)).toEqual({ phase: 'aim', buoyId: 4 })
    expect(pickBuoy({ phase: 'aim', buoyId: 4 }, 7)).toEqual({ phase: 'aim', buoyId: 7 })
    expect(pickBuoy({ phase: 'pick-freq' }, 5)).toEqual({ phase: 'aim', buoyId: 5 })
    expect(canAim({ phase: 'aim', buoyId: 4 })).toBe(true)
    expect(canAim({ phase: 'pick-buoy' })).toBe(false)
    expect(canAim({ phase: 'pick-freq' })).toBe(false)
  })
  it('arms pick-freq for phone gram taps and labels it', () => {
    expect(armPickFreq()).toEqual({ phase: 'pick-freq' })
    expect(isPickFreq(armPickFreq())).toBe(true)
    expect(isPickFreq(ARM_IDLE)).toBe(false)
    expect(togglePickFreq(ARM_IDLE)).toEqual({ phase: 'pick-freq' })
    expect(togglePickFreq({ phase: 'pick-freq' })).toEqual(ARM_IDLE)
    expect(togglePickFreq({ phase: 'aim', buoyId: 1 })).toEqual(ARM_IDLE)
    expect(armLabel(ARM_IDLE)).toBe('BRG')
    expect(armLabel({ phase: 'pick-buoy' })).toBe('BRG · tap buoy')
    expect(armLabel({ phase: 'aim', buoyId: 2 })).toMatch(/^BRG/)
    expect(armLabel({ phase: 'pick-freq' })).toBe('BRG · tap gram')
  })
})
