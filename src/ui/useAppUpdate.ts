/**
 * Standalone detection + update-available poll for the reload chrome.
 */
import { useEffect, useState } from 'react'
import { isStandalone } from './splashPlatform'
import { UPDATE_POLL_MS, UpdatePoller, currentBundleNames } from './updateCheck'

/** Live standalone / installed-PWA flag (matchMedia + iOS navigator.standalone). */
export function useStandalone(): boolean {
  const [v, setV] = useState(() => isStandalone())
  useEffect(() => {
    const on = () => setV(isStandalone())
    on()
    const mqs = ['(display-mode: standalone)', '(display-mode: fullscreen)', '(display-mode: minimal-ui)']
    const ms = mqs.map((q) => window.matchMedia?.(q)).filter(Boolean) as MediaQueryList[]
    for (const m of ms) m.addEventListener?.('change', on)
    return () => { for (const m of ms) m.removeEventListener?.('change', on) }
  }, [])
  return v
}

/** Poll index.html for a newer hashed bundle; returns whether an update is available. */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const base = document.querySelector('base')?.href
      || (typeof document !== 'undefined' ? new URL('.', location.href).href : '/')
    const indexUrl = new URL('index.html', base).href
    const poller = new UpdatePoller({
      intervalMs: UPDATE_POLL_MS,
      fetchHtml: async () => {
        const r = await fetch(indexUrl, { cache: 'no-store', credentials: 'same-origin' })
        if (!r.ok) throw new Error(`update check ${r.status}`)
        return r.text()
      },
      getCurrent: () => currentBundleNames(document),
      onChange: setAvailable,
    })
    poller.start()
    return () => poller.stop()
  }, [])
  return available
}
