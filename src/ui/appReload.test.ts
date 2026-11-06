import { describe, expect, it, vi } from 'vitest'
import { hardReloadApp } from './appReload'

describe('hardReloadApp', () => {
  it('runs before, unregisters SW, clears caches, then reloads', async () => {
    const before = vi.fn()
    const unregister = vi.fn(async () => true)
    const cacheDelete = vi.fn(async () => true)
    const reload = vi.fn()
    await hardReloadApp(before, {
      reload,
      getRegistrations: async () => [{ unregister }, { unregister }],
      cacheKeys: async () => ['a', 'b'],
      cacheDelete,
    })
    expect(before).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledTimes(2)
    expect(cacheDelete).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledOnce()
  })
  it('still reloads when SW/caches throw', async () => {
    const reload = vi.fn()
    await hardReloadApp(undefined, {
      reload,
      getRegistrations: async () => { throw new Error('no') },
      cacheKeys: async () => { throw new Error('no') },
    })
    expect(reload).toHaveBeenCalledOnce()
  })
})
