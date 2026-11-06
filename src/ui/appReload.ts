/**
 * Hard reload for Add-to-Home-Screen / standalone installs (no browser chrome reload).
 * Unregisters any service worker and clears Cache Storage when present, then location.reload().
 * Does not register a service worker.
 */

export type ReloadDeps = {
  reload?: () => void
  getRegistrations?: () => Promise<Array<{ unregister(): Promise<boolean> }>>
  cacheKeys?: () => Promise<string[]>
  cacheDelete?: (key: string) => Promise<boolean>
}

/** Tear down SW + caches (best-effort), then reload. `before` runs first (e.g. disposeCut). */
export async function hardReloadApp(before?: () => void, deps: ReloadDeps = {}): Promise<void> {
  try { before?.() } catch { /* never block reload */ }

  try {
    const getRegs = deps.getRegistrations
      ?? (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? () => navigator.serviceWorker.getRegistrations()
        : undefined)
    if (getRegs) {
      const regs = await getRegs()
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
    }
  } catch { /* no SW / denied */ }

  try {
    const keysFn = deps.cacheKeys
      ?? (typeof caches !== 'undefined' ? () => caches.keys() : undefined)
    const delFn = deps.cacheDelete
      ?? (typeof caches !== 'undefined' ? (k: string) => caches.delete(k) : undefined)
    if (keysFn && delFn) {
      const keys = await keysFn()
      await Promise.all(keys.map((k) => delFn(k).catch(() => false)))
    }
  } catch { /* no Cache API */ }

  const reload = deps.reload ?? (() => { location.reload() })
  reload()
}
