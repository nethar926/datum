/**
 * AIS trigger (plot chrome): secondary-tinted Liquid Glass when on, not the
 * green accent. Only the trigger is styled; there is no custom glass menu surface.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8')
const ios = readFileSync(fileURLToPath(new URL('../styles/ios.css', import.meta.url)), 'utf8')
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
function blend(srcRgb: [number, number, number], a: number, dst: [number, number, number]): string {
  const out = srcRgb.map((c, i) => Math.round(c * a + dst[i] * (1 - a)))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

describe('AIS trigger secondary glass', () => {
  it('defines secondary Liquid Glass tokens from system secondary (Color.secondary)', () => {
    // Dark: rgba(235, 235, 245, 0.6) matches --sys-label-2 / Color.secondary.
    expect(tokens).toMatch(/--glass-secondary-tint:\s*rgba\(235,\s*235,\s*245,\s*0\.6\)/)
    expect(tokens).toMatch(/--glass-secondary-tint-reduced:\s*rgba\(199,\s*199,\s*204,\s*0\.94\)/)
    expect(tokens).toMatch(/--on-glass-secondary:\s*#0b0c0e/)
    // Light chrome tokens exist; the plot overrides them back to the dark set.
    expect(tokens).toMatch(/--glass-secondary-tint:\s*rgba\(60,\s*60,\s*67,\s*0\.6\)/)
    expect(tokens).toMatch(/:root\[data-scheme='light'\] :is\(\.panel-body[\s\S]*--glass-secondary-tint:\s*rgba\(235,\s*235,\s*245,\s*0\.6\)/)
  })

  it('styles only the AIS trigger with secondary tint, not accent and not a menu surface', () => {
    expect(ios).toMatch(/\.float-btn\.ais-toggle\[aria-pressed='true'\][\s\S]*--glass-tint:\s*var\(--glass-secondary-tint\)/)
    expect(ios).toMatch(/\.float-btn\.ais-toggle\[aria-pressed='true'\][\s\S]*color:\s*var\(--on-glass-secondary/)
    expect(ios).not.toMatch(/\.float-btn\[aria-pressed='true'\][\s\S]*--glass-accent-tint/)
    expect(ios).not.toMatch(/\.ais-menu[\s\S]*glass/)
    expect(appSrc).toMatch(/className="glass glass-btn float-btn ais-toggle"/)
    expect(appSrc).toMatch(/data-testid="ais-toggle"/)
    // Still a button toggle — no custom dropdown surface.
    expect(appSrc).toMatch(/<button className="glass glass-btn float-btn ais-toggle"[\s\S]*?>AIS<\/button>/)
  })

  it('text on secondary glass meets WCAG AA (≥4.5:1) over the dark plot', () => {
    const tint: [number, number, number] = [235, 235, 245]
    const overBlack = blend(tint, 0.6, [0, 0, 0])
    const overCell = blend(tint, 0.6, [28, 28, 30])
    const fg = '#0b0c0e'
    const rBlack = contrastRatio(fg, overBlack)
    const rCell = contrastRatio(fg, overCell)
    expect(rBlack).toBeGreaterThanOrEqual(4.5)
    expect(rCell).toBeGreaterThanOrEqual(4.5)
    // Reduced-transparency: near-opaque light gray.
    const reduced = blend([199, 199, 204], 0.94, [0, 0, 0])
    expect(contrastRatio(fg, reduced)).toBeGreaterThanOrEqual(4.5)
  })
})
