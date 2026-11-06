/**
 * REFRESH smoke (WebKit): Settings Reload row + standalone nav refresh + wheel btn centering.
 * Saves to /workspace/refresh-shots/. PORT=4208.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4208
const outDir = process.env.SHOT_DIR || '/workspace/refresh-shots'
mkdirSync(outDir, { recursive: true })
const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url).pathname,
  })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview on ${port} not ready`)
}

const standaloneInit = () => {
  Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true })
  const orig = window.matchMedia.bind(window)
  window.matchMedia = (q) => {
    if (String(q).includes('display-mode: standalone')
      || String(q).includes('display-mode: fullscreen')
      || String(q).includes('display-mode: minimal-ui')) {
      return {
        matches: true, media: q, onchange: null,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
        dispatchEvent: () => false,
      }
    }
    return orig(q)
  }
}

async function tapGram(page) {
  const gram = page.locator('[data-testid=gram], .gram-panel .panel-body, canvas').first()
  if (await gram.count()) {
    try { await gram.tap({ timeout: 2000 }) } catch { try { await gram.click({ timeout: 2000 }) } catch {} }
    await page.waitForTimeout(400)
  }
}

async function measureWheel(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('[data-testid=difar-wheel-btn]')
    const ring = btn?.querySelector('.wheel-hue-ring')
    if (!btn || !ring) return { err: 'missing' }
    const b = btn.getBoundingClientRect()
    const r = ring.getBoundingClientRect()
    const bx = b.left + b.width / 2, by = b.top + b.height / 2
    const rx = r.left + r.width / 2, ry = r.top + r.height / 2
    return {
      btn: { w: b.width, h: b.height, cx: bx, cy: by },
      ring: { w: r.width, h: r.height, cx: rx, cy: ry },
      dx: rx - bx,
      dy: ry - by,
      absMax: Math.max(Math.abs(rx - bx), Math.abs(ry - by)),
    }
  })
}

async function shotNav(browser, name, device) {
  const context = await browser.newContext({
    ...device,
    isMobile: true,
    hasTouch: true,
  })
  await context.addInitScript(standaloneInit)
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?tab=live`, { waitUntil: 'networkidle' })
  await dismissSplash(page)
  // Ensure DIFAR so wheel btn is visible
  const difar = page.locator('button:has-text("DIFAR")').first()
  if (await difar.count()) {
    try { await difar.click({ timeout: 2000 }) } catch { try { await difar.tap({ timeout: 2000 }) } catch {} }
  }
  await page.waitForTimeout(500)
  await tapGram(page)
  const nav = page.locator('[data-testid=navbar]').first()
  await nav.waitFor({ state: 'visible', timeout: 8000 })
  const reload = page.locator('[data-testid=nav-reload]')
  ok(await reload.count() === 1, `${name}: nav-reload missing in standalone`)
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false })
  // Wheel centering measure + zoomed crop
  const m = await measureWheel(page)
  if (m.err) fails.push(`${name}: wheel btn missing (${m.err})`)
  else {
    writeFileSync(`${outDir}/wheel-center-${name}.json`, JSON.stringify(m, null, 2))
    ok(m.absMax <= 0.5, `${name}: wheel center off by dx=${m.dx.toFixed(2)} dy=${m.dy.toFixed(2)} (absMax=${m.absMax.toFixed(2)})`)
    const btn = page.locator('[data-testid=difar-wheel-btn]')
    // Zoomed crop: clip around button with padding
    const box = await btn.boundingBox()
    if (box) {
      const pad = 16
      await page.screenshot({
        path: `${outDir}/wheel-btn-centered.png`,
        clip: {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - pad),
          width: box.width + pad * 2,
          height: box.height + pad * 2,
        },
      })
    }
  }
  await context.close()
  return m
}

async function shotSettings(browser) {
  const device = { ...devices['iPhone SE'], defaultBrowserType: 'webkit' }
  const context = await browser.newContext({ ...device, isMobile: true, hasTouch: true })
  // Settings row is always present — no need for standalone
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?tab=settings`, { waitUntil: 'networkidle' })
  await dismissSplash(page)
  const row = page.locator('[data-testid=settings-reload]')
  await row.waitFor({ state: 'visible', timeout: 8000 })
  ok(await row.count() === 1, 'settings-reload missing')
  await row.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${outDir}/settings-reload-iphone-portrait.png`, fullPage: false })
  const box = await row.boundingBox()
  if (box) {
    await page.screenshot({
      path: `${outDir}/settings-reload-row.png`,
      clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 },
    })
  }
  await context.close()
}

const main = async () => {
  await startSrv()
  const browser = await webkit.launch()
  try {
    await shotSettings(browser)
    const se = devices['iPhone SE']
    const m1 = await shotNav(browser, 'nav-reload-iphone-portrait', { ...se, viewport: { width: 375, height: 667 } })
    const land = { ...se, viewport: { width: 667, height: 375 }, deviceScaleFactor: 2 }
    await shotNav(browser, 'nav-reload-iphone-landscape', land)
    console.log('wheel measure (portrait):', JSON.stringify(m1))
  } finally {
    await browser.close()
    if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
  }
  if (fails.length) {
    console.error('FAILS:\n' + fails.map((f) => ' - ' + f).join('\n'))
    process.exit(1)
  }
  console.log('refresh-shot OK →', outDir)
}

main().catch((e) => { console.error(e); process.exit(1) })
