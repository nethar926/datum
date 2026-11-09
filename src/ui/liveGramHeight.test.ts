/**
 * Live gram must fill the gram column in LOFAR/DIFAR/DEMON after the 2f2a9ec toggle.
 * Regression: data-demon=1 used a 2-row stack that reserved ~140px for a hidden DemonPane,
 * and DemonPane's hint child stole the panel 1fr so the DEMON canvas was 0px tall.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ios = readFileSync(fileURLToPath(new URL('../styles/ios.css', import.meta.url)), 'utf8')
const indexCss = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
const demonPane = readFileSync(fileURLToPath(new URL('../gram/DemonPane.tsx', import.meta.url)), 'utf8')
const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

describe('live gram height (DEMON toggle layout)', () => {
  it('does not reserve a second stacked row for a hidden DemonPane when data-demon=1', () => {
    // Old HIG4 stack (fails on 3182902 / 2f2a9ec):
    expect(ios).not.toMatch(/data-demon='1'\] \.workspace-left \{[^}]*1\.15fr[^}]*0\.85fr/)
    expect(indexCss).not.toMatch(/data-demon='1'\] \.workspace-left \{[^}]*1\.15fr[^}]*0\.85fr/)
    // Toggle: single cell, both panes share grid-area 1/1.
    expect(ios).toMatch(/data-demon='1'\] \.workspace-left \{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/)
    expect(ios).toMatch(/workspace-left > \.gram-box[\s\S]*grid-area:\s*1\s*\/\s*1/)
    expect(ios).toMatch(/workspace-left > \.demon-panel[\s\S]*grid-area:\s*1\s*\/\s*1/)
  })

  it('gives DemonPane panel-body the 1fr row (hint must not steal it)', () => {
    expect(demonPane).toMatch(/demon-hint/)
    // Without hint, body is the second child — must use auto + 1fr (not auto auto 1fr).
    expect(ios).toMatch(/\.demon-panel\.gram-panel[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/)
    expect(ios).toMatch(/demon-panel\.gram-panel:has\(\.demon-hint\)[\s\S]*grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)/)
    expect(ios).toMatch(/\.cut-player:has\(\[data-testid='demon-panel'\]\[data-visible='1'\]\):has\(\[data-testid='cut-gram'\]\[hidden\]\)/)
  })

  it('hides the LOFAR gram-box while DEMON is selected so it cannot keep an empty cell', () => {
    expect(app).toMatch(/live-gram-panel[\s\S]*hidden=\{gramMode === 'demon'\}/)
  })
})

describe('Play/Pause green Liquid Glass', () => {
  it('applies accent glass to .play-btn in both states (not only .primary)', () => {
    expect(ios).toMatch(/\.play-btn \{[\s\S]*--glass-tint:\s*var\(--glass-accent-tint\)/)
    expect(ios).toMatch(/\.play-btn::before/)
    // Must not rely solely on .play-btn.primary for the glass fill.
    expect(ios).not.toMatch(/\.play-btn\.primary::before \{[\s\S]*backdrop-filter[\s\S]*\}\n:root\[data-glass='reduced'\] \.play-btn\.primary::before/)
  })
})
