import { describe, expect, it } from 'vitest'
import {
  estimateCursorReadout,
  estimateSelLabelSize,
  placeSelMarkerLabel,
  rectsOverlap,
} from './selMarkerLabel'

describe('selMarkerLabel', () => {
  it('detects AABB overlap with pad', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 0, w: 10, h: 10 })).toBe(true)
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 10, h: 10 })).toBe(false)
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }, 1)).toBe(true)
  })

  it('keeps the label to the right of the marker when clear of the readout', () => {
    const size = estimateSelLabelSize('123.4')
    const readout = estimateCursorReadout('50.0 Hz · bin 100')
    const p = placeSelMarkerLabel({
      markerX: 280,
      gramW: 400,
      labelW: size.w,
      labelH: size.h,
      readout,
    })
    expect(p.side).toBe('right')
    expect(p.top).toBe(4)
    const label = { x: 280 + 8, y: p.top, w: size.w, h: size.h }
    expect(rectsOverlap(label, readout!, 1)).toBe(false)
  })

  it('flips to the left when the right side would sit under a long FOCUS readout', () => {
    const size = estimateSelLabelSize('12.5')
    // Long FOCUS suffix — readout stretches far right.
    const readout = estimateCursorReadout('12.5 Hz · bin 25 · FOCUS ±25 ↑')
    expect(readout!.w).toBeGreaterThan(160)
    // Marker just past the left edge of the readout → right placement collides.
    const markerX = readout!.x + 40
    const p = placeSelMarkerLabel({
      markerX,
      gramW: 390,
      labelW: size.w,
      labelH: size.h,
      readout,
    })
    // Either flip left (if it clears) or drop below; never stay overlapping at top-right.
    const atTopRight = { x: markerX + 8, y: 4, w: size.w, h: size.h }
    expect(rectsOverlap(atTopRight, readout!, 1)).toBe(true)
    const placed = p.side === 'right'
      ? { x: markerX + 8, y: p.top, w: size.w, h: size.h }
      : { x: markerX - 8 - size.w, y: p.top, w: size.w, h: size.h }
    expect(rectsOverlap(placed, readout!, 1)).toBe(false)
    expect(p.top).toBeGreaterThanOrEqual(4)
  })

  it('drops below the readout when neither side clears at the default top', () => {
    const size = estimateSelLabelSize('8.0')
    const readout = { x: 8, y: 6, w: 220, h: 14 }
    // Marker centred under the readout — left and right both collide at top.
    const markerX = readout.x + readout.w / 2
    const p = placeSelMarkerLabel({
      markerX,
      gramW: 360,
      labelW: size.w,
      labelH: size.h,
      readout,
    })
    expect(p.top).toBeGreaterThanOrEqual(readout.y + readout.h)
    const placed = p.side === 'right'
      ? { x: markerX + 8, y: p.top, w: size.w, h: size.h }
      : { x: markerX - 8 - size.w, y: p.top, w: size.w, h: size.h }
    expect(rectsOverlap(placed, readout, 1)).toBe(false)
    // Still in the top chrome band (never over newest rows at the bottom).
    expect(p.top).toBeLessThan(40)
  })

  it('flips near the right edge so the label stays inside the gram', () => {
    const size = estimateSelLabelSize('999.9')
    const p = placeSelMarkerLabel({
      markerX: 380,
      gramW: 390,
      labelW: size.w,
      labelH: size.h,
      readout: null,
    })
    expect(p.side).toBe('left')
    expect(p.top).toBe(4)
  })

  it('defaults to right / top when there is no readout', () => {
    const size = estimateSelLabelSize('55.0')
    const p = placeSelMarkerLabel({
      markerX: 120,
      gramW: 400,
      labelW: size.w,
      labelH: size.h,
      readout: null,
    })
    expect(p).toEqual({ side: 'right', top: 4 })
  })
})
