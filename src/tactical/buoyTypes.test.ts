import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BuoyTypeSelector } from './BuoyTypeSelector'
import { DropController } from './dropController'
import { DROP_PATTERNS, type DropKind } from './drop'
import { dropSpecs } from './DropBar'

function preview(pattern: typeof DROP_PATTERNS[number] = 'line') {
  const d = new DropController('manual')
  d.dispatch({ type: 'arm', pattern })
  d.dispatch({ type: 'press', at: { x: 1000, y: 2000 } })
  d.dispatch({ type: 'release' })
  return d
}

describe('explicit buoy placement types', () => {
  it('shows both passive types and the disabled S active placeholder', () => {
    const html = renderToStaticMarkup(createElement(BuoyTypeSelector, { value: 'omni', onChange() {} }))
    expect(html).toContain('aria-label="Buoy type for manual placement"')
    expect(html).toMatch(/value="omni" selected=""/)
    expect(html).toContain('DIRECTIONAL (DIFAR)')
    expect(html).toMatch(/value="active" disabled=""/)
    expect(html).toContain('ACTIVE (DICASS) · S · not yet implemented')
  })
  it('disables placement selection while the field is unavailable or full', () => {
    const html = renderToStaticMarkup(createElement(BuoyTypeSelector, { value: 'difar', disabled: true, onChange() {} }))
    expect(html).toMatch(/<select[^>]+disabled=""/)
  })
  it('updates ghost kinds and actual engine drop payload without moving buoys', () => {
    const d = preview(), original = d.ghost!, version = d.version
    d.dispatch({ type: 'kind', kind: 'omni' })
    expect(d.version).toBe(version + 1)
    expect(d.ghost!.kinds.every((k) => k === 'omni')).toBe(true)
    expect(d.ghost!.xy).toEqual(original.xy)
    const channels = Array.from({ length: d.ghost!.n }, (_, i) => i + 1)
    expect(dropSpecs(d.ghost!, d.ghost!.n, channels).every((b) => b.kind === 'omni')).toBe(true)
    d.dispatch({ type: 'kind', kind: 'difar' })
    expect(dropSpecs(d.ghost!, d.ghost!.n, channels).every((b) => b.kind === 'difar')).toBe(true)
  })
  it('applies each selected passive type to every pattern', () => {
    for (const pattern of DROP_PATTERNS) for (const kind of ['omni', 'difar'] as const) {
      const d = preview(pattern)
      d.dispatch({ type: 'kind', kind })
      expect(d.ghost!.kinds.every((k) => k === kind)).toBe(true)
    }
  })
  it('keeps the chosen type through rearming, count changes and repeat drops', () => {
    const d = preview()
    d.dispatch({ type: 'kind', kind: 'omni' })
    d.dispatch({ type: 'count', delta: 1 })
    expect(d.ghost!.kinds).toEqual(Array(6).fill('omni'))
    d.dispatch({ type: 'confirm' })
    d.dispatch({ type: 'press', at: { x: 3000, y: 4000 } })
    d.dispatch({ type: 'release' })
    expect(d.ghost!.kinds.every((k) => k === 'omni')).toBe(true)
    d.dispatch({ type: 'arm', pattern: 'circle' })
    expect(d.state.buoyKind).toBe('omni')
  })
  it('rejects unsupported active selection at the controller too', () => {
    const d = preview(), state = d.state, ghost = d.ghost
    d.dispatch({ type: 'kind', kind: 'active' as DropKind })
    expect(d.state).toBe(state)
    expect(d.ghost).toBe(ghost)
  })
})
