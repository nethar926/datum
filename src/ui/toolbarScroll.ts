/**
 * Shared overflow-chevron policy for the top chrome bar and the bottom gram-tool bar.
 * Mirrors native `ToolbarMetrics` / `ToolbarScrollPolicy` (44 pt hit targets, 52 pt bar,
 * reserved slots that fade instead of collapsing so chips never shift).
 */
export const TOOLBAR_HIT = 44
export const TOOLBAR_ICON = 18
export const TOOLBAR_GAP = 2
export const TOOLBAR_PAD = 4
export const TOOLBAR_BAR_H = TOOLBAR_PAD + TOOLBAR_HIT + TOOLBAR_PAD // 52
export const TOOLBAR_CHEVRON_SLOT = TOOLBAR_HIT
export const TOOLBAR_EDGE_SLOP = 2

export type ToolbarChevronState = {
  reserveSlots: boolean
  leadingVisible: boolean
  trailingVisible: boolean
}

/** `containerWidth` is the full bar width before slots are reserved. */
export function toolbarChevronState(
  contentWidth: number,
  containerWidth: number,
  scrollOffset: number,
  isScrolling: boolean,
  slotWidth = TOOLBAR_CHEVRON_SLOT,
  edgeSlop = TOOLBAR_EDGE_SLOP,
): ToolbarChevronState {
  const overflow = contentWidth - containerWidth > edgeSlop
  if (!overflow) return { reserveSlots: false, leadingVisible: false, trailingVisible: false }
  const viewport = Math.max(0, containerWidth - 2 * slotWidth)
  const maxScroll = Math.max(0, contentWidth - viewport)
  const x = Math.min(Math.max(scrollOffset, 0), maxScroll)
  const leading = x > edgeSlop
  const trailing = x < maxScroll - edgeSlop
  if (isScrolling) return { reserveSlots: true, leadingVisible: false, trailingVisible: false }
  return { reserveSlots: true, leadingVisible: leading, trailingVisible: trailing }
}

/** Target content offset after paging by one visible width (`direction` +1 forward, −1 back). */
export function toolbarPagedOffset(
  scrollOffset: number,
  viewportWidth: number,
  contentWidth: number,
  direction: number,
): number {
  const maxScroll = Math.max(0, contentWidth - Math.max(0, viewportWidth))
  return Math.min(maxScroll, Math.max(0, scrollOffset + direction * viewportWidth))
}
