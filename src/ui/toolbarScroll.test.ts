import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TOOLBAR_BAR_H, TOOLBAR_CHEVRON_SLOT, TOOLBAR_EDGE_SLOP, TOOLBAR_GAP, TOOLBAR_HIT, TOOLBAR_ICON,
  TOOLBAR_PAD, toolbarChevronState, toolbarPagedOffset,
} from './toolbarScroll'

const tokens = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8')
const ios = readFileSync(fileURLToPath(new URL('../styles/ios.css', import.meta.url)), 'utf8')

describe('toolbar metrics', () => {
  it('matches the native shared toolbar metrics (44 pt hit, 52 pt bar)', () => {
    expect(TOOLBAR_HIT).toBe(44)
    expect(TOOLBAR_ICON).toBe(18)
    expect(TOOLBAR_GAP).toBe(2)
    expect(TOOLBAR_PAD).toBe(4)
    expect(TOOLBAR_BAR_H).toBe(52)
    expect(TOOLBAR_BAR_H).toBe(TOOLBAR_PAD * 2 + TOOLBAR_HIT)
    expect(TOOLBAR_CHEVRON_SLOT).toBe(TOOLBAR_HIT)
  })
})

describe('toolbarChevronState', () => {
  const slot = TOOLBAR_CHEVRON_SLOT

  it('hides slots when content fits', () => {
    const s = toolbarChevronState(200, 300, 0, false)
    expect(s).toEqual({ reserveSlots: false, leadingVisible: false, trailingVisible: false })
  })

  it('reserves both slots at the leading edge and shows only the trailing chevron', () => {
    const s = toolbarChevronState(400, 300, 0, false)
    expect(s.reserveSlots).toBe(true)
    expect(s.leadingVisible).toBe(false)
    expect(s.trailingVisible).toBe(true)
  })

  it('shows only the leading chevron at the trailing edge', () => {
    const maxScroll = 400 - (300 - 2 * slot)
    const s = toolbarChevronState(400, 300, maxScroll, false)
    expect(s.reserveSlots).toBe(true)
    expect(s.leadingVisible).toBe(true)
    expect(s.trailingVisible).toBe(false)
  })

  it('shows both chevrons when mid-scroll', () => {
    const s = toolbarChevronState(400, 300, 80, false)
    expect(s.reserveSlots).toBe(true)
    expect(s.leadingVisible).toBe(true)
    expect(s.trailingVisible).toBe(true)
  })

  it('fades chevrons while scrolling but keeps reserved slots so chips do not shift', () => {
    const mid = toolbarChevronState(400, 300, 80, true)
    expect(mid.reserveSlots).toBe(true)
    expect(mid.leadingVisible).toBe(false)
    expect(mid.trailingVisible).toBe(false)
    const start = toolbarChevronState(400, 300, 0, true)
    expect(start.reserveSlots).toBe(true)
    expect(start.leadingVisible).toBe(false)
    expect(start.trailingVisible).toBe(false)
  })

  it('keeps reserveSlots stable across an overflowing scroll', () => {
    for (const x of [0, 40, 80, 188]) {
      const idle = toolbarChevronState(400, 300, x, false)
      const busy = toolbarChevronState(400, 300, x, true)
      expect(idle.reserveSlots).toBe(true)
      expect(busy.reserveSlots).toBe(true)
    }
  })

  it('ignores tiny offsets within the edge slop', () => {
    const s = toolbarChevronState(400, 300, TOOLBAR_EDGE_SLOP, false)
    expect(s.leadingVisible).toBe(false)
    expect(s.trailingVisible).toBe(true)
  })
})

describe('toolbarPagedOffset', () => {
  it('pages by one viewport and clamps', () => {
    expect(toolbarPagedOffset(0, 100, 400, 1)).toBe(100)
    expect(toolbarPagedOffset(100, 100, 400, 1)).toBe(200)
    expect(toolbarPagedOffset(300, 100, 400, 1)).toBe(300)
    expect(toolbarPagedOffset(300, 100, 400, -1)).toBe(200)
    expect(toolbarPagedOffset(10, 100, 400, -1)).toBe(0)
  })
})

describe('shared toolbar CSS', () => {
  it('defines the same metrics tokens as the native ToolbarMetrics', () => {
    expect(tokens).toMatch(/--toolbar-hit:\s*44px/)
    expect(tokens).toMatch(/--toolbar-icon:\s*18px/)
    expect(tokens).toMatch(/--toolbar-gap:\s*2px/)
    expect(tokens).toMatch(/--toolbar-pad:\s*4px/)
    expect(tokens).toMatch(/--toolbar-bar-h:\s*52px/)
    expect(tokens).toMatch(/--toolbar-chevron-slot:\s*44px/)
  })

  it('uses those tokens for both bars and keeps reserved chevron slot width', () => {
    expect(ios).toMatch(/\.toolbar-glass[^}]*height:\s*var\(--toolbar-bar-h\)/)
    expect(ios).toMatch(/\.chrome-bar \{[^}]*height:\s*var\(--toolbar-bar-h\)/)
    expect(ios).toMatch(/\.tool[^}]*height:\s*var\(--toolbar-hit\)/)
    expect(ios).toMatch(/data-reserve='1'[^}]*flex-basis:\s*var\(--toolbar-chevron-slot\)/)
    expect(ios).toMatch(/\.tool-more[^}]*background:\s*transparent/)
    expect(ios).not.toMatch(/layout-wide \.chrome-bar \.chrome-scroll \{\s*flex-wrap:\s*wrap/)
  })
})
