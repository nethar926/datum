/**
 * Shared glass tools strip used by Live (and later Cuts). FIX pins on the leading edge; the rest scrolls
 * with an overflow chevron on narrow widths. `trailing` (e.g. CON contrast) pins on the trailing edge so
 * it stays in the toolbar row and does not wrap under the dock. When trailing is set we always use the
 * scrolling tool group (chevron when needed) so a pinned CON cannot mid-clip a tool label at Duo widths.
 * `full` without trailing still shows every tool with no chevron on wide / hinge layouts.
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
  /** Show every tool with no overflow chevron (Duo / wide) when there is no trailing pin. */
  full?: boolean
}) {
  const pinTrail = trailing != null
  // Trailing CON shrinks the tool runway: prefer ToolScroll so overflow is chevroned, never mid-clipped.
  const scroll = pinTrail || !full
  return (
    <div
      className={`toolbar-glass glass${full && !pinTrail ? ' full' : ''}${pinTrail ? ' has-trailing' : ''}`}
      role="toolbar"
      aria-label={label}
      data-testid={testId}
      data-full={full && !pinTrail ? '1' : '0'}
      data-trailing={pinTrail ? '1' : '0'}
    >
      {leading}
      {scroll
        ? <ToolScroll testId={`${testId}-scroll`}>{children}</ToolScroll>
        : <div className="tool-scroll tool-scroll-full" data-testid={`${testId}-scroll`}>{children}</div>}
      {pinTrail && <div className="tool-trailing" data-testid={`${testId}-trailing`}>{trailing}</div>}
    </div>
  )
}
