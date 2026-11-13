import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const indexCss = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
const plot = readFileSync(fileURLToPath(new URL('./BtPlot.tsx', import.meta.url)), 'utf8')

/** Apple HIG minimum touch target. */
const HIG_TOUCH_PT = 44

function coarseBtBlock(css: string): string {
  const blocks = [...css.matchAll(/@media\s*\(pointer:\s*coarse\)\s*\{/g)]
  for (const m of blocks) {
    const start = m.index! + m[0].length
    let depth = 1, i = start
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    const body = css.slice(start, i - 1)
    if (body.includes('.gram.bt-plot') && body.includes('.bt-controls')) return body
  }
  return ''
}

describe('BT zoom chips layout', () => {
  it('keeps desktop chips as a compact overlay at top-right (unchanged)', () => {
    expect(indexCss).toMatch(/\.bt-chrome\s*\{\s*display:\s*contents;/)
    expect(indexCss).toMatch(
      /\.bt-controls\s*\{\s*position:\s*absolute;\s*top:\s*6px;\s*right:\s*52px;/,
    )
    expect(plot).toMatch(/className="bt-chrome"/)
  })

  it('reserves a ≥44 pt chrome row above the phone gram and parks chips there', () => {
    const coarse = coarseBtBlock(indexCss)
    expect(coarse.length).toBeGreaterThan(0)
    expect(coarse).toMatch(
      /\.gram\.bt-plot\s*\{\s*grid-template-rows:\s*minmax\(44px,\s*auto\)\s+minmax\(0,\s*1fr\)\s+22px/,
    )
    expect(coarse).toMatch(/\.gram\.bt-plot\s*>\s*canvas[\s\S]*?grid-row:\s*2/)
    expect(coarse).toMatch(/\.gram\.bt-plot\s+\.bt-chrome\s*\{[\s\S]*?display:\s*flex/)
    expect(coarse).toMatch(/\.gram\.bt-plot\s+\.bt-chrome\s*\{[\s\S]*?grid-row:\s*1/)
    expect(coarse).toMatch(/\.gram\.bt-plot\s+\.bt-chrome\s*\{[\s\S]*?min-height:\s*44px/)
    expect(coarse).toMatch(/\.gram\.bt-plot\s+\.bt-controls\s*\{[\s\S]*?position:\s*relative/)
    expect(coarse).toMatch(/\.gram\.bt-plot\s+\.bt-controls\s*\{[\s\S]*?top:\s*auto/)
    expect(coarse).toMatch(/\.gram\.bt-plot\s+\.bt-label\s*\{[\s\S]*?text-overflow:\s*ellipsis/)
    expect(coarse).toMatch(
      /\.gram\.bt-plot\s+\.bt-controls\s+\.seg\s+button\s*\{\s*min-height:\s*44px;\s*min-width:\s*44px/,
    )
    expect(HIG_TOUCH_PT).toBe(44)
  })
})
