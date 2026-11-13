/**
 * Shared glass tools strip used by Live (and later Cuts). FIX pins on the leading edge; the rest
 * always scrolls with reserved overflow-chevron slots (same metrics as the top chrome bar), on
 * iPhone, both Duo screens/postures, and wide layouts. `trailing` (e.g. CON contrast) pins on the
 * trailing edge so it stays in the toolbar row and does not wrap under the dock.
 */
import type { ReactNode } from 'react'
import { ToolScroll } from './chrome'

export function ToolsToolbar({
  leading,
  children,
  trailing,
  label = 'Gram tools',
  testId = 'gram-tools',
  full = false,
}: {
  leading?: ReactNode
  children: ReactNode
  trailing?: ReactNode
  label?: string
  testId?: string
  /** Ignored: both bars always use the scrolling strip so chips keep the same order everywhere. */
  full?: boolean
}) {
  void full // kept for call-site compat; layout is always the scrolling strip
  const pinTrail = trailing != null
  return (
    <div
      className={`toolbar-glass glass${pinTrail ? ' has-trailing' : ''}`}
      role="toolbar"
      aria-label={label}
      data-testid={testId}
      data-full="0"
      data-trailing={pinTrail ? '1' : '0'}
    >
      {leading}
      <ToolScroll testId={`${testId}-scroll`}>{children}</ToolScroll>
      {pinTrail && <div className="tool-trailing" data-testid={`${testId}-trailing`}>{trailing}</div>}
    </div>
  )
}
