/** Lettered rounded-square glyphs for the single-drop button and plot markers.
 *
 * These are our own drawings — not SF Symbols, and not traces of Apple's glyphs.
 * Square uses the secondary colour, letter uses the primary colour, so light and
 * dark both come from the `--text-1` / `--text-2` tokens.
 *
 * Mapping only covers existing engine / drop kind names. DICASS (`active`) is
 * included so the `S` letter is ready; the type stays disabled in the picker.
 */

export const BUOY_TYPE_LETTERS = { bt: 'B', omni: 'O', difar: 'D', dicass: 'S' } as const
export type BuoyTypeSymbolKind = keyof typeof BUOY_TYPE_LETTERS
export type BuoyTypeLetter = (typeof BUOY_TYPE_LETTERS)[BuoyTypeSymbolKind]

/** Toolbar icon size (CSS px). The single-drop button is 44 pt around this. */
export const BUOY_TYPE_GLYPH_SIZE = 18
/** Plot marker size in CSS pixels (fits inside the 22 px selected-buoy ring). */
export const BUOY_TYPE_MARK_SIZE = 12

/** Map an existing engine or drop kind string onto B / O / D / S. Unknown names return null. */
export function buoyTypeSymbol(kind: string | null | undefined): { kind: BuoyTypeSymbolKind; letter: BuoyTypeLetter } | null {
  if (kind == null) return null
  switch (kind.toLowerCase()) {
    case 'bt':
    case 'ssp':
    case 'b':
      return { kind: 'bt', letter: 'B' }
    case 'omni':
    case 'lofar':
    case 'o':
    case 'passive-omni':
    case 'passiveomni':
      return { kind: 'omni', letter: 'O' }
    case 'difar':
    case 'd':
      return { kind: 'difar', letter: 'D' }
    case 'dicass':
    case 'active':
    case 's':
      return { kind: 'dicass', letter: 'S' }
    default:
      return null
  }
}

export function buoyTypeLetter(kind: string | null | undefined, fallback: BuoyTypeLetter = 'O'): BuoyTypeLetter {
  return buoyTypeSymbol(kind)?.letter ?? fallback
}

/** Draw the shared lettered rounded square. `square` is the fill, `ink` is the letter. */
export function drawBuoyTypeGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  letter: string,
  square: string,
  ink: string,
  dashed = false,
  lineWidth?: number,
): void {
  const half = size / 2
  const radius = size * 0.22
  const x = cx - half
  const y = cy - half
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, radius)
  ctx.fillStyle = square
  ctx.fill()
  if (dashed) {
    ctx.strokeStyle = ink === square ? ink : square
    ctx.lineWidth = lineWidth ?? Math.max(1, size * 0.1)
    ctx.setLineDash([size * 0.2, size * 0.14])
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.fillStyle = ink
  ctx.font = `700 ${Math.round(size * 0.62)}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, cx, cy + size * 0.03)
  ctx.restore()
}
