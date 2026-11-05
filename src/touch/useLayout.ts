import { useEffect, useState } from 'react'
import { classifyLayout, type Layout } from './gestures'

const current = (): Layout => typeof window === 'undefined' ? 'wide' : classifyLayout(window.innerWidth, window.innerHeight)

/** Live layout class; re-evaluated on resize and orientation change. */
export function useLayout(): Layout {
  const [l, setL] = useState<Layout>(current)
  useEffect(() => {
    const on = () => setL(current())
    window.addEventListener('resize', on); window.addEventListener('orientationchange', on)
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on) }
  }, [])
  return l
}
