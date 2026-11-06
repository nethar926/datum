// Reveal positions smoke (WebKit): rename Truth → Reveal, marks on plot (no text dump),
// iPhone portrait + desktop screenshots with Reveal on. Port 4193 (PORT env overrides).
// Run after `npm run build`. Saves docs/m3-reveal-*.png. One smoke at a time.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4193
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid) } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('preview did not start on ' + port)
}
const URL = (q = '') => `http://127.0.0.1:${port}/datum/?autoplay&rate=16${q}`
const goto = async (page, url) => {
  for (let a = 0; a < 3; a++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); return }
    catch (e) { if (a === 2) throw e; console.log('restart preview', e.message); await startSrv() }
  }
}

const enableReveal = async (page) => {
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.waitForSelector('[data-testid=reveal-switch]', { timeout: 10000 })
  // No leftover Truth UI.
  ok(await page.locator('[data-testid=truth-switch]').count() === 0, 'truth-switch still present')
  ok(await page.locator('[data-testid=truth-panel]').count() === 0, 'truth-panel still present')
  ok(await page.locator('[data-testid=truth-open]').count() === 0, 'truth-open still present')
  const label = await page.locator('label:has([data-testid=reveal-switch]) .row-label').innerText()
  ok(/Reveal positions/i.test(label), `label was "${label}"`)
  const sw = page.locator('[data-testid=reveal-switch]')
  if (!(await sw.isChecked())) await sw.click()
  ok(await sw.isChecked(), 'reveal switch not checked')
}

const VIEWS = [
  ['iphone-portrait', devices['iPhone 15']],
  ['desktop', {
    viewport: { width: 1440, height: 900 },
    userAgent: devices['Desktop Safari'].userAgent,
    deviceScaleFactor: 1, isMobile: false, hasTouch: false,
  }],
]

await startSrv()
const browser = await webkit.launch()
try {
  for (const [name, device] of VIEWS) {
    const context = await browser.newContext(device)
    const page = await context.newPage()
    page.on('pageerror', (e) => fails.push(`${name} pageerror: ${e}`))
    await goto(page, URL('&tab=live'))
    await dismissSplash(page)
    await page.waitForSelector('[data-testid=tactical]', { timeout: 30000 })
    await page.waitForTimeout(2500)
    await enableReveal(page)
    // Plot tab (full plot) — marks should be visible.
    await page.getByRole('tab', { name: 'Plot' }).click()
    await page.waitForTimeout(800)
    ok(await page.locator('[data-testid=tactical]').isVisible(), `${name}: plot not visible`)
    ok(await page.locator('[data-testid=truth-panel]').count() === 0, `${name}: truth panel leaked`)
    await page.screenshot({ path: `docs/m3-reveal-${name}.png` })
    console.log('shot', name)
    // Live portrait split still has the plot with reveal (phone only).
    if (name === 'iphone-portrait') {
      await page.getByRole('tab', { name: 'Live' }).click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: 'docs/m3-reveal-iphone-portrait-live.png' })
      console.log('shot iphone-portrait-live')
    }
    await context.close()
  }
} finally {
  await browser.close()
  try { process.kill(-srv.pid) } catch {}
}
if (fails.length) { console.error('FAILS', fails); process.exitCode = 1 }
else console.log('reveal-shot OK')
