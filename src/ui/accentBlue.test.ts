/**
 * Blue phosphor accent: light/dark tokens, WCAG AA contrast on the backgrounds
 * the accent sits on, and health / selected-buoy colours left unchanged.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8')
const ios = readFileSync(fileURLToPath(new URL('../styles/ios.css', import.meta.url)), 'utf8')
const appSrc = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

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
function blend(srcRgb: [number, number, number], a: number, dst: [number, number, number]): string {
  const out = srcRgb.map((c, i) => Math.round(c * a + dst[i] * (1 - a)))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

describe('blue phosphor accent tokens', () => {
  it('adds Blue next to Green and leaves health / selected-buoy colours fixed', () => {
    expect(tokens).toMatch(/\[data-accent='blue'\]/)
    expect(tokens).toMatch(/--accent:\s*#5ac8fa/i)
    expect(tokens).toMatch(/\[data-scheme='light'\]\[data-accent='blue'\][\s\S]*--accent:\s*#007399/i)
    expect(tokens).toMatch(/--select-blue:\s*#0a84ff/)
    expect(tokens).toMatch(/--plot-buoy-working:\s*#f5f5f7/)
    expect(tokens).toMatch(/--plot-buoy-detuned:\s*#30d158/)
    expect(tokens).toMatch(/--plot-buoy-dead-hi:\s*#ff453a/)
    expect(tokens).toMatch(/--plot-buoy-error:\s*#ffd60a/)
    // Blue overrides must not retarget the plot cue or health tokens.
    expect(tokens).not.toMatch(/\[data-accent='blue'\][^}]*--select-blue:/)
    expect(tokens).not.toMatch(/\[data-accent='blue'\][^}]*--plot-buoy-/)
    expect(appSrc).toMatch(/data-testid=\{`accent-\$\{k\}`\}/)
    expect(ios).toMatch(/\.accent-swatch\[data-accent='blue'\]/)
  })

  it('meets WCAG AA (≥4.5:1) for Blue tint, on-accent text and glass text', () => {
    const darkTint = '#5ac8fa'
    const lightTint = '#007399'
    const ratios = {
      darkTintOnBlack: contrastRatio(darkTint, '#000000'),
      darkTintOnBg0: contrastRatio(darkTint, '#0b0c0e'),
      darkTintOnCell: contrastRatio(darkTint, '#1c1c1e'),
      lightTintOnWhite: contrastRatio(lightTint, '#ffffff'),
      lightTintOnGrouped: contrastRatio(lightTint, '#f2f2f7'),
      onAccentDark: contrastRatio('#041018', darkTint),
      onAccentLight: contrastRatio('#ffffff', lightTint),
      glassDarkOverBlack: contrastRatio('#f2f8ff', blend([90, 200, 250], 0.36, [0, 0, 0])),
      glassDarkOverCell: contrastRatio('#f2f8ff', blend([90, 200, 250], 0.36, [28, 28, 30])),
      glassLightOverWhite: contrastRatio('#041018', blend([0, 115, 153], 0.28, [255, 255, 255])),
      glassLightOverGrouped: contrastRatio('#041018', blend([0, 115, 153], 0.28, [0xf2, 0xf2, 0xf7])),
    }
    console.log(JSON.stringify({ ...Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, +v.toFixed(2)])), aa: Object.values(ratios).every((r) => r >= 4.5) }))
    for (const [name, r] of Object.entries(ratios)) {
      expect(r, name).toBeGreaterThanOrEqual(4.5)
    }
  })
})
