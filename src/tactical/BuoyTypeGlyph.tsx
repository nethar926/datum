import { BUOY_TYPE_GLYPH_SIZE, buoyTypeLetter } from './buoyTypeSymbol'

/** Inline SVG of the shared lettered rounded square. CSS colours it from `--text-1` / `--text-2`. */
export function BuoyTypeGlyph({ kind, size = BUOY_TYPE_GLYPH_SIZE }: { kind: string; size?: number }) {
  const letter = buoyTypeLetter(kind)
  // 18×18 viewBox; corner radius matches drawBuoyTypeGlyph's 0.22 × size.
  return (
    <svg className="buoy-type-glyph" width={size} height={size} viewBox="0 0 18 18" aria-hidden data-testid="buoy-type-glyph" data-letter={letter} data-kind={kind}>
      <rect className="buoy-type-glyph-sq" x="1" y="1" width="16" height="16" rx="4" />
      <text className="buoy-type-glyph-letter" x="9" y="9.5" textAnchor="middle" dominantBaseline="middle">{letter}</text>
    </svg>
  )
}
