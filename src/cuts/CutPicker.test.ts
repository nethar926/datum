// @vitest-environment jsdom
/**
 * Nuclear starter cuts stay listed but disabled as "Coming soon" (Wilson).
 * Selectability is gated from catalog plant data via isNuclearCut.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog } from '@acoustics'
import { CutPicker } from './CutPicker'
import { listCutSeeds } from './api'
import { COMING_SOON_LABEL, isNuclearCut, nuclearStarterCuts } from './comingSoon'

let root: Root, node: HTMLDivElement
const onPick = vi.fn()

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  act(() => root.render(createElement(CutPicker, { activeId: null, onPick })))
})
afterEach(() => {
  act(() => root.unmount())
  node.remove()
})

describe('CutPicker nuclear Coming soon', () => {
  it('lists exactly the two nuclear starter cuts as disabled Coming soon entries', () => {
    const nuclear = nuclearStarterCuts()
    expect(nuclear.map((c) => c.id).sort()).toEqual(['cut-twilightweft-nuc', 'cut-velvetshoal-nuc'].sort())
    for (const cut of nuclear) {
      expect(catalog.classes.find((c) => c.id === cut.classId)?.plant).toBe('nuclear')
      const btn = node.querySelector<HTMLButtonElement>(`[data-testid^="cut-pick-"][data-cut-id="${cut.id}"]`)
      expect(btn, cut.id).toBeTruthy()
      expect(btn!.disabled).toBe(true)
      expect(btn!.getAttribute('aria-disabled')).toBe('true')
      expect(btn!.getAttribute('data-coming-soon')).toBe('1')
      expect(btn!.className).toContain('coming-soon')
      expect(btn!.textContent).toContain(COMING_SOON_LABEL)
      expect(btn!.querySelector('[data-testid="cut-coming-soon"]')?.textContent).toBe(COMING_SOON_LABEL)
    }
  })

  it('clicking or activating a nuclear cut calls neither onPick nor any seek/select', () => {
    for (const cut of nuclearStarterCuts()) {
      const btn = node.querySelector<HTMLButtonElement>(`[data-cut-id="${cut.id}"]`)!
      act(() => btn.click())
      act(() => btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      act(() => btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    }
    expect(onPick).not.toHaveBeenCalled()
  })

  it('non-nuclear cuts stay enabled and selectable', () => {
    const playable = listCutSeeds().filter((c) => !isNuclearCut(c))
    expect(playable.length).toBeGreaterThan(0)
    for (const cut of playable) {
      const btn = node.querySelector<HTMLButtonElement>(`[data-cut-id="${cut.id}"]`)!
      expect(btn.disabled).toBe(false)
      expect(btn.getAttribute('aria-disabled')).toBeNull()
      expect(btn.getAttribute('data-coming-soon')).toBeNull()
      expect(btn.querySelector('[data-testid="cut-coming-soon"]')).toBeNull()
    }
    const first = playable[0]
    const btn = node.querySelector<HTMLButtonElement>(`[data-cut-id="${first.id}"]`)!
    act(() => btn.click())
    expect(onPick).toHaveBeenCalledExactlyOnceWith(first.id)
  })
})
