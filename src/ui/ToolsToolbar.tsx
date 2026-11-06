/**
 * Shared glass tools strip used by Live (and later Cuts). FIX pins on the leading edge; the rest scrolls
 * with an overflow chevron on narrow widths. When `full` is set (Duo unfolded / wide room) every tool
 * stays visible with no overflow chevron.
 */
import type { ReactNode } from 'react'
import { ToolScroll } from './chrome'

export function ToolsToolbar({
  leading,
  children,
  label = 'Gram tools',
  testId = 'gram-tools',
  full = false,
}: {
  leading?: ReactNode
  children: ReactNode
  label?: string
  testId?: string
  /** Show every tool with no overflow chevron (Duo / wide). */
  full?: boolean
}) {
  return (
    <div
      className={`toolbar-glass glass${full ? ' full' : ''}`}
      role="toolbar"
      aria-label={label}
      data-testid={testId}
      data-full={full ? '1' : '0'}
    >
      {leading}
      {full
        ? <div className="tool-scroll tool-scroll-full" data-testid={`${testId}-scroll`}>{children}</div>
        : <ToolScroll testId={`${testId}-scroll`}>{children}</ToolScroll>}
    </div>
  )
}
