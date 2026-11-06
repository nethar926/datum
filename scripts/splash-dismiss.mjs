/**
 * Shared helper: click past the per-load splash so instrument smokes can reach the gram.
 * No-ops when the splash is already gone. Safe to call after every goto/reload.
 */
export async function dismissSplash(page, { timeout = 8000 } = {}) {
  const splash = page.locator('[data-testid=splash]')
  try {
    await splash.waitFor({ state: 'attached', timeout: 2500 })
  } catch {
    return false
  }
  const btn = page.locator('[data-testid=splash-continue]')
  if (await btn.count() === 0) return false
  // Prefer tap on touch contexts; click works everywhere.
  try { await btn.click({ timeout }) } catch {
    try { await btn.tap({ timeout }) } catch { /* already leaving */ }
  }
  await splash.waitFor({ state: 'detached', timeout }).catch(async () => {
    // Fade keeps it attached briefly with pointer-events none; wait for leaving or gone.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid=splash]')
      return !el || el.getAttribute('data-leaving') === '1' || getComputedStyle(el).opacity === '0'
    }, null, { timeout }).catch(() => {})
    await page.waitForTimeout(220)
  })
  return true
}
