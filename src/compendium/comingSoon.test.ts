// @vitest-environment jsdom
/**
 * Nuclear Compendium classes show a data-derived "Coming soon" badge (Wilson).
 * Plant comes from catalog/card.plant — not hard-coded class names.
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catalog } from '@acoustics'
import { Compendium } from './Compendium'
import { compendiumCards } from './cards'
import { COMING_SOON_LABEL, isNuclearPlant } from '../cuts/comingSoon'

let root: Root, node: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  act(() => root.render(createElement(Compendium, { onClose() {} })))
})
afterEach(() => {
  act(() => root.unmount())
  node.remove()
})

describe('Compendium nuclear Coming soon badge', () => {
  it('badges every nuclear class from catalog plant data, and no diesel class', () => {
    const cards = compendiumCards(catalog)
    const nuclearIds = cards.filter((c) => isNuclearPlant(c.plant)).map((c) => c.id)
    const dieselIds = cards.filter((c) => !isNuclearPlant(c.plant)).map((c) => c.id)
    expect(nuclearIds.length).toBeGreaterThan(0)
    expect(dieselIds.length).toBeGreaterThan(0)
    // Plant field on catalog classes agrees with cards.
    for (const raw of catalog.classes) {
      const c = raw as { id: string; plant: string }
      expect(isNuclearPlant(c.plant)).toBe(nuclearIds.includes(c.id))
    }

    for (const id of nuclearIds) {
      const el = node.querySelector(`[data-testid="cmp-card"][data-class-id="${id}"]`)
      expect(el, id).toBeTruthy()
      expect(el!.getAttribute('data-coming-soon')).toBe('1')
      expect(el!.getAttribute('data-plant')).toBe('nuclear')
      const badge = el!.querySelector('[data-testid="cmp-coming-soon"]')
      expect(badge?.textContent).toBe(COMING_SOON_LABEL)
      expect(el!.querySelector('[data-testid="cmp-coming-soon-note"]')).toBeTruthy()
      // Force colour theming preserved (red / blue / gray|green).
      expect(el!.className).toMatch(/force-(red|blue|green)/)
    }
    for (const id of dieselIds) {
      const el = node.querySelector(`[data-testid="cmp-card"][data-class-id="${id}"]`)
      expect(el, id).toBeTruthy()
      expect(el!.getAttribute('data-coming-soon')).toBeNull()
      expect(el!.querySelector('[data-testid="cmp-coming-soon"]')).toBeNull()
      expect(el!.querySelector('[data-testid="cmp-coming-soon-note"]')).toBeNull()
    }
  })
})
