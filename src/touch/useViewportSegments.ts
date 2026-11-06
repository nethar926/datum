/**
 * Feature-detect `window.viewport.segments` (dual-screen / foldable). Falls back to [] so callers
 * keep the normal layout. Clamps against window.innerWidth/innerHeight — overflowing or inconsistent
 * segments degrade to the normal side-by-side split. Listens for segmentschange / resize.
 */
import { useEffect, useState } from 'react'
import { computeSegmentSplit, type SegmentRect, type SegmentSplit } from './layoutMath'

type ViewportSegments = { segments?: ReadonlyArray<{ x: number; y: number; width: number; height: number }> }

function readSegments(): SegmentRect[] {
  if (typeof window === 'undefined') return []
  const vp = (window as Window & { viewport?: ViewportSegments }).viewport
  const segs = vp?.segments
  if (!segs || !segs.length) return []
  return Array.from(segs, (s) => ({ x: s.x, y: s.y, width: s.width, height: s.height }))
}

function viewSize(): { width: number; height: number } | null {
  if (typeof window === 'undefined') return null
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Live hinge split derived from viewport segments (or normal after clamp). */
export function useViewportSegments(): { segments: SegmentRect[]; split: SegmentSplit } {
  const [segments, setSegments] = useState<SegmentRect[]>(readSegments)
  const [vp, setVp] = useState(viewSize)
  useEffect(() => {
    const on = () => { setSegments(readSegments()); setVp(viewSize()) }
    on()
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    const v = (window as Window & { viewport?: EventTarget }).viewport
    v?.addEventListener?.('segmentschange', on)
    window.addEventListener('viewportsegmentschange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
      v?.removeEventListener?.('segmentschange', on)
      window.removeEventListener('viewportsegmentschange', on)
    }
  }, [])
  return { segments, split: computeSegmentSplit(segments, vp) }
}
