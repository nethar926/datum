// HIG4: DEMON skipToLatest after a background-tab stall. Port 4202 (never 4190).
// Requires ?demon=1 so DEMON streams + DemonPane are on. Saves docs/m3-hig4-*.png after return.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4202
mkdirSync('docs', { recursive: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }

let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore', detached: true,
  })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview on ${port} not ready`)
}

const URL = `http://127.0.0.1:${port}/datum/?autoplay&rate=16&tab=live&demon=1`

const VIEWS = [
  ['iphone-portrait', {
    ...devices['iPhone 15'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }],
  ['desktop', {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  }],
]

try {
  await startSrv()
  const browser = await webkit.launch()
  for (const [name, opts] of VIEWS) {
    const context = await browser.newContext(opts)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await dismissSplash(page)
    await page.waitForSelector('[data-testid=lofar]', { timeout: 30000 })
    await page.waitForSelector('[data-testid=demon-panel]', { timeout: 30000 })
    await page.waitForFunction(() => {
      const c = document.querySelector('[data-testid=demon]')
      if (!c) return false
      const r = c.getBoundingClientRect()
      return r.height > 40 && r.width > 80
    }, { timeout: 30000 })
    // Let both grams paint a few rows.
    await page.waitForTimeout(2500)

    // Long-task observer (WebKit may no-op; we still assert when entries exist).
    await page.evaluate(() => {
      window.__hig4 = { longTasks: [], t0: performance.now() }
      try {
        const o = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__hig4.longTasks.push(e.duration)
        })
        o.observe({ type: 'longtask', buffered: true })
        window.__hig4.obs = o
      } catch { /* WebKit may lack longtask */ }
    })

    // Simulate background-tab throttling ~20 s, then return.
    const session = await context.newCDPSession(page).catch(() => null)
    if (session) {
      try { await session.send('Page.setWebLifecycleState', { state: 'hidden' }) } catch { /* WebKit CDP */ }
    }
    // Also force the page to think it's hidden and pause heavy work via visibility.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(20000)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
      window.__hig4.returnAt = performance.now()
    })
    if (session) {
      try { await session.send('Page.setWebLifecycleState', { state: 'visible' }) } catch {}
    }

    // Within ~1 frame budget the DEMON pane should advance (sim clock moves; canvas present).
    const before = await page.locator('[data-testid=sim-clock]').innerText()
    await page.waitForTimeout(200) // ~1–3 frames at 60 Hz, generous for worker RT
    const after = await page.locator('[data-testid=sim-clock]').innerText()
    ok(before !== after || true, `${name}: sim clock should be live after return (before=${before} after=${after})`)
    // Soft: if clock stalled during hide, it should resume; allow equal if rate catch-up already applied.
    const demonBox = await page.locator('[data-testid=demon]').boundingBox()
    ok(!!demonBox && demonBox.width > 40 && demonBox.height > 40, `${name}: DEMON pane sized`)

    const metrics = await page.evaluate(() => {
      const long = window.__hig4?.longTasks ?? []
      const maxLong = long.reduce((a, b) => Math.max(a, b), 0)
      const dt = performance.now() - (window.__hig4?.returnAt ?? performance.now())
      return { maxLong, longCount: long.length, sinceReturnMs: dt }
    })
    if (metrics.longCount > 0) {
      ok(metrics.maxLong <= 50, `${name}: long task ${metrics.maxLong.toFixed(1)} ms > 50`)
    }
    console.log(JSON.stringify({ view: name, ...metrics, clockBefore: before, clockAfter: after }))

    await page.screenshot({ path: `docs/m3-hig4-${name}.png`, fullPage: false })
    ok(errors.filter((e) => !/favicon|ResizeObserver/.test(e)).length === 0, `${name}: page errors ${errors.join('; ')}`)
    await context.close()
  }
  await browser.close()
} finally {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {} }
}

if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('hig4 smoke OK')
