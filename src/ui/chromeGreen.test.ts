/**
 * Chrome-green: selected Play / tool / buoy / tab use green Liquid Glass tokens;
 * CON contrast pins in the toolbar trailing slot; DIFAR wheel is circular;
 * the selected-buoy plot cue stays system blue (--select-blue). Trailing CON forces ToolScroll so Duo widths
 * never mid-clip a tool label (LM → "LN").
 */
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TabBar } from './chrome'
import { ToolsToolbar } from './ToolsToolbar'
import { DifarWheelButton } from '../gram/DifarLegend'

const tokens = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8')
const ios = readFileSync(fileURLToPath(new URL('../styles/ios.css', import.meta.url)), 'utf8')
const indexCss = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
const plot = readFileSync(fileURLToPath(new URL('../tactical/TacticalPlot.tsx', import.meta.url)), 'utf8')
const appSrc = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

/** WCAG relative luminance for sRGB hex (#rgb / #rrggbb). */
function lum(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * n(0) + 0.7152 * n(2) + 0.0722 * n(4)
}
function contrastRatio(a: string, b: string): number {
  const L1 = lum(a), L2 = lum(b)
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2)
  return (hi + 0.05) / (lo + 0.05)
}
/** Blend src over dst (src alpha 0–1), return #rrggbb. */
function blend(srcRgb: [number, number, number], a: number, dst: [number, number, number]): string {
  const out = srcRgb.map((c, i) => Math.round(c * a + dst[i] * (1 - a)))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

describe('chrome-green selection tokens', () => {
  it('defines green Liquid Glass chrome accents; selected-buoy cue stays blue', () => {
    expect(tokens).toMatch(/--select:\s*#30d158/)
    expect(tokens).toMatch(/--glass-accent-tint:\s*rgba\(48,\s*209,\s*88/)
    expect(tokens).toMatch(/--on-glass-accent:\s*#f2fff4/)
    // Wilson 8 Nov / c09a487: the plot cue on the selected buoy is system blue, not the green accent.
    expect(tokens).toMatch(/--select-blue:\s*#0a84ff/)
    expect(tokens).toMatch(/--select-blue-fill:\s*rgba\(10,\s*132,\s*255,\s*0\.2\)/)
    expect(plot).toMatch(/--select-blue/)
    expect(plot).toMatch(/#0a84ff/)
    expect(plot).not.toMatch(/sel:\s*col\('--select'\)/)
  })

  it('keeps plot health colours unchanged', () => {
    expect(tokens).toMatch(/--plot-buoy-working:\s*#f5f5f7/)
    expect(tokens).toMatch(/--plot-buoy-detuned:\s*#30d158/)
    expect(tokens).toMatch(/--plot-buoy-dead-hi:\s*#ff453a/)
    expect(tokens).toMatch(/--plot-buoy-error:\s*#ffd60a/)
    expect(plot).toMatch(/--plot-buoy-working/)
    expect(plot).toMatch(/--plot-buoy-detuned/)
    expect(plot).toMatch(/--plot-buoy-dead-hi/)
    expect(plot).toMatch(/--plot-buoy-error/)
  })

  it('Play primary and selected tool/buoy use green Liquid Glass, not solid tint fill', () => {
    expect(ios).toMatch(/\.play-btn\.primary[\s\S]*--glass-tint:\s*var\(--glass-accent-tint\)/)
    expect(ios).toMatch(/\.tool\[aria-pressed='true'\][\s\S]*--glass-tint:\s*var\(--glass-accent-tint\)/)
    expect(ios).toMatch(/\.buoy-seg button\[aria-pressed=true\][\s\S]*--glass-tint:\s*var\(--glass-accent-tint\)/)
    expect(ios).not.toMatch(/\.play-btn\.primary \{ color: var\(--on-accent[^)]*\); background: var\(--tint\);/)
  })

  it('text on green glass meets WCAG AA (≥4.5:1) over dark app chrome', () => {
    const tint: [number, number, number] = [48, 209, 88]
    const overBlack = blend(tint, 0.36, [0, 0, 0])
    const overCell = blend(tint, 0.36, [28, 28, 30])
    const fg = '#f2fff4'
    const rBlack = contrastRatio(fg, overBlack)
    const rCell = contrastRatio(fg, overCell)
    console.log(JSON.stringify({
      onGlassAccent: fg,
      glassAccentTint: 'rgba(48,209,88,0.36)',
      ratioOverBlack: +rBlack.toFixed(2),
      ratioOverSysCell: +rCell.toFixed(2),
      aa: rBlack >= 4.5 && rCell >= 4.5,
    }))
    expect(rBlack).toBeGreaterThanOrEqual(4.5)
    expect(rCell).toBeGreaterThanOrEqual(4.5)
  })
})

describe('CON contrast in toolbar trailing', () => {
  it('renders trailing slot inside the toolbar (not below the dock)', () => {
    const html = renderToStaticMarkup(createElement(ToolsToolbar, {
      testId: 'gram-tools',
      full: true,
      trailing: createElement('div', { className: 'contrast tool-contrast tool-contrast-pin', 'data-testid': 'contrast' }, 'CON'),
      children: createElement('button', { className: 'tool', 'data-testid': 'horz-tool' }, 'HORZ'),
    }))
    expect(html).toContain('data-testid="gram-tools"')
    expect(html).toContain('data-testid="gram-tools-trailing"')
    expect(html).toMatch(/gram-tools-trailing[\s\S]*data-testid="contrast"/)
    expect(html).toContain('data-trailing="1"')
    expect(html).toContain('has-trailing')
  })

  it('always uses ToolScroll with reserved chevron slots, even when full is set and trailing is absent', () => {
    const withTrail = renderToStaticMarkup(createElement(ToolsToolbar, {
      testId: 'gram-tools',
      full: true,
      trailing: createElement('div', { 'data-testid': 'contrast' }, 'x'),
      children: createElement('button', { className: 'tool' }, 'LM'),
    }))
    expect(withTrail).toContain('tool-scroll-wrap')
    expect(withTrail).not.toContain('tool-scroll-full')
    expect(withTrail).toContain('data-full="0"')
    expect(withTrail).toContain('aria-label="Previous tools"')
    expect(withTrail).toContain('aria-label="More tools"')

    const noTrail = renderToStaticMarkup(createElement(ToolsToolbar, {
      testId: 'gram-tools',
      full: true,
      children: createElement('button', { className: 'tool' }, 'LM'),
    }))
    expect(noTrail).toContain('tool-scroll-wrap')
    expect(noTrail).not.toContain('tool-scroll-full')
    expect(noTrail).toContain('data-full="0"')
    expect(noTrail).toContain('aria-label="Previous tools"')
    expect(noTrail).toContain('aria-label="More tools"')
  })

  it('pins a compact CON control (value + short slider) with 44px targets', () => {
    expect(appSrc).toMatch(/tool-contrast-pin/)
    expect(appSrc).toMatch(/contrast-value/)
    expect(ios).toMatch(/\.tool-contrast-pin input\[type=range\][^}]*height:\s*44px/)
    expect(ios).toMatch(/\.tool-contrast-pin input\[type=range\][^}]*width:\s*56px/)
    expect(ios).toMatch(/\.toolbar-glass\.has-trailing \.tool[^}]*padding-inline:\s*8px/)
    expect(ios).toMatch(/min-height:\s*44px/)
  })
})

describe('DIFAR colour-wheel button', () => {
  it('is a circular glass chip (border-radius 50%)', () => {
    expect(indexCss).toMatch(/\.wheel-btn[\s\S]*border-radius:\s*50%/)
    const html = renderToStaticMarkup(createElement(DifarWheelButton, {}))
    expect(html).toContain('wheel-btn')
    expect(html).toContain('glass')
  })
})

describe('tab bar selection', () => {
  it('tints the selected item with accent Liquid Glass and does not break out into a capsule', () => {
    expect(ios).toMatch(/\.tabbar button\.on[\s\S]*--glass-tint:\s*var\(--glass-accent-tint\)/)
    expect(ios).toMatch(/\.tabbar button\.on[\s\S]*color:\s*var\(--on-glass-accent/)
    expect(ios).not.toMatch(/\.tabbar\.min button/)
    expect(ios).not.toMatch(/\.tabbar button\.on \{ color: var\(--tint\); background: var\(--glass-sel\);/)
    expect(appSrc).not.toMatch(/tabMin|setTabMin/)
    const html = renderToStaticMarkup(createElement(TabBar, { tab: 'live', onTab() {} }))
    expect(html).toContain('data-testid="tabbar"')
    expect(html).toContain('data-min="0"')
    expect(html).not.toMatch(/class="[^"]*\bmin\b/)
    expect(html).toContain('data-testid="tab-live"')
    expect(html).toContain('data-testid="tab-plot"')
    expect(html).toContain('data-testid="tab-cuts"')
    expect(html).toContain('data-testid="tab-settings"')
    expect(html).toMatch(/data-testid="tab-live"[^>]*class="on"/)
    expect(html).not.toMatch(/role="tab"[^>]*aria-hidden="true"/)
  })
})
