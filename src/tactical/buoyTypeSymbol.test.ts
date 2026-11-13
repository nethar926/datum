import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BuoyTypeGlyph } from './BuoyTypeGlyph'
import {
  BUOY_TYPE_GLYPH_SIZE, BUOY_TYPE_LETTERS, buoyTypeLetter, buoyTypeSymbol, drawBuoyTypeGlyph,
} from './buoyTypeSymbol'

describe('buoy type symbol mapping', () => {
  it('maps existing engine and drop kind names onto B, O, D and S', () => {
    expect(buoyTypeSymbol('bt')).toEqual({ kind: 'bt', letter: 'B' })
    expect(buoyTypeSymbol('ssp')).toEqual({ kind: 'bt', letter: 'B' })
    expect(buoyTypeSymbol('omni')).toEqual({ kind: 'omni', letter: 'O' })
    expect(buoyTypeSymbol('lofar')).toEqual({ kind: 'omni', letter: 'O' })
    expect(buoyTypeSymbol('passive-omni')).toEqual({ kind: 'omni', letter: 'O' })
    expect(buoyTypeSymbol('difar')).toEqual({ kind: 'difar', letter: 'D' })
    expect(buoyTypeSymbol('DIFAR')).toEqual({ kind: 'difar', letter: 'D' })
    // DICASS stays disabled in the picker; the letter is still mapped.
    expect(buoyTypeSymbol('dicass')).toEqual({ kind: 'dicass', letter: 'S' })
    expect(buoyTypeSymbol('active')).toEqual({ kind: 'dicass', letter: 'S' })
    expect(BUOY_TYPE_LETTERS).toEqual({ bt: 'B', omni: 'O', difar: 'D', dicass: 'S' })
  })

  it('does not invent kinds the engine does not have', () => {
    expect(buoyTypeSymbol('submarine')).toBeNull()
    expect(buoyTypeSymbol('unknown')).toBeNull()
    expect(buoyTypeSymbol('')).toBeNull()
    expect(buoyTypeSymbol(undefined)).toBeNull()
    expect(buoyTypeLetter('unknown', 'O')).toBe('O')
  })
})

describe('BuoyTypeGlyph', () => {
  it('renders a rounded square with the type letter for the single-drop button', () => {
    const html = renderToStaticMarkup(createElement(BuoyTypeGlyph, { kind: 'difar' }))
    expect(html).toContain('data-testid="buoy-type-glyph"')
    expect(html).toContain('data-letter="D"')
    expect(html).toContain('>D</text>')
    expect(html).toContain('buoy-type-glyph-sq')
    expect(html).toContain('width="18"')
    expect(BUOY_TYPE_GLYPH_SIZE).toBe(18)
    expect(renderToStaticMarkup(createElement(BuoyTypeGlyph, { kind: 'omni' }))).toContain('data-letter="O"')
    expect(renderToStaticMarkup(createElement(BuoyTypeGlyph, { kind: 'bt' }))).toContain('data-letter="B"')
    expect(renderToStaticMarkup(createElement(BuoyTypeGlyph, { kind: 'active' }))).toContain('data-letter="S"')
  })
})

describe('drawBuoyTypeGlyph', () => {
  it('fills a rounded square and draws the type letter in the ink colour', () => {
    const calls: string[] = []
    const ctx: {
      fillStyle: string; strokeStyle: string; lineWidth: number; font: string
      textAlign: string; textBaseline: string
      save(): void; restore(): void; beginPath(): void
      roundRect(_x: number, _y: number, w: number, h: number, r: number): void
      fill(): void; stroke(): void; setLineDash(d: number[]): void
      fillText(t: string, x: number, y: number): void
    } = {
      save() { calls.push('save') },
      restore() { calls.push('restore') },
      beginPath() { calls.push('beginPath') },
      roundRect(_x, _y, w, h, r) { calls.push(`roundRect:${w}x${h}@${r}`) },
      fill() { calls.push(`fill:${ctx.fillStyle}`) },
      stroke() { calls.push(`stroke:${ctx.strokeStyle}`) },
      setLineDash(d) { calls.push(`dash:${d.join(',')}`) },
      fillText(t, x, y) { calls.push(`text:${t}@${x.toFixed(0)},${y.toFixed(0)}`) },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: '',
      textBaseline: '',
    }
    drawBuoyTypeGlyph(ctx as unknown as CanvasRenderingContext2D, 10, 20, 12, 'D', '#30d158', '#05080a', true)
    const joined = calls.join('|')
    expect(joined).toContain('roundRect:12x12')
    expect(joined).toContain('fill:#30d158')
    expect(joined).toContain('text:D@10,')
    expect(joined).toContain('dash:')
    expect(ctx.font).toMatch(/700 /)
    expect(ctx.fillStyle).toBe('#05080a')
  })
})
