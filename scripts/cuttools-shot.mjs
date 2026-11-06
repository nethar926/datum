/**
 * CUTTOOLS smoke (WebKit): Cuts toolbar + HARM/DOP/LM/lock on a cut.
 * Saves to /workspace/cuttools-shots/. PORT=4212. One view at a time via CUTTOOLS_ONLY=slug.
 * Tap the gram before taking shots.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4212
const outDir = process.env.SHOT_DIR || '/workspace/cuttools-shots'
const only = process.env.CUTTOOLS_ONLY || ''
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

async function tapGram(page) {
  const gram = page.locator('[data-testid=cut-lofar], [data-testid=lofar], .cut-gram canvas, canvas').first()
  if (await gram.count()) {
    try { await gram.tap({ timeout: 2000 }) } catch { try { await gram.click({ timeout: 2000 }) } catch {} }
    await page.waitForTimeout(350)
  }
}

const SE = {
  viewport: { width: 375, height: 667 },
  userAgent: devices['iPhone SE'].userAgent,
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  defaultBrowserType: 'webkit',
}
const SE_LAND = {
  ...SE,
  viewport: { width: 667, height: 375 },
}
const SE_320 = {
  ...SE,
  viewport: { width: 320, height: 568 },
}

async function openCuts(browser, device = SE) {
  const context = await browser.newContext({ ...device, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  page.on('pageerror', (e) => fails.push(String(e)))
  await page.goto(`http://127.0.0.1:${port}/datum/?tab=cuts&autoplay&rate=16`, { waitUntil: 'domcontentloaded' })
  await dismissSplash(page)
  await page.waitForSelector('[data-testid=cuts-screen]', { timeout: 15000 })
  await page.waitForSelector('[data-testid=cut-picker]', { timeout: 10000 })
  const row = page.locator('[data-testid=cut-pick-1]')
  await row.tap({ timeout: 3000 }).catch(() => row.click())
  await page.waitForSelector('[data-testid=cut-gram-tools], [data-testid=cut-lofar]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await tapGram(page)
  await assertNoHScroll(page, `cuts-open-${device.viewport.width}x${device.viewport.height}`)
  return { context, page }
}

async function shot(page, name) {
  const path = `${outDir}/${name}.png`
  await page.screenshot({ path, fullPage: false })
  writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ name, at: Date.now() }, null, 2))
  console.log('wrote', path)
  return path
}



async function assertNoHScroll(page, label) {
  const m = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  ok(m.scrollWidth === m.innerWidth, `${label}: scrollWidth ${m.scrollWidth} !== innerWidth ${m.innerWidth}`)
  console.log('scroll', label, m)
  return m
}

async function assertHarmReadoutInView(page) {
  const box = await page.locator('[data-testid=harm-readout]').boundingBox()
  if (!box) { ok(false, 'harm readout missing for left-clip check'); return }
  ok(box.x >= -1, `harm readout clipped left (x=${box.x})`)
  ok(box.x + box.width <= (await page.viewportSize()).width + 1, `harm readout overflows right`)
}

async function armTool(page, testId) {
  const btn = page.locator(`[data-testid=${testId}]`)
  await btn.evaluate((b) => {
    b.scrollIntoView({ inline: 'center', block: 'nearest' })
    b.click()
  })
  await page.waitForTimeout(250)
}

async function gramBox(page) {
  const box = await page.locator('[data-testid=cut-lofar]').boundingBox()
  if (!box) throw new Error('no cut-lofar canvas')
  return box
}

const views = {
  async 'toolbar-portrait'(browser) {
    const { context, page } = await openCuts(browser, SE)
    const tools = page.locator('[data-testid=cut-gram-tools]')
    ok(await tools.count() > 0, 'cut-gram-tools missing')
    ok(await page.locator('[data-testid=cut-fix-tool]').isDisabled(), 'FIX should be disabled')
    await assertNoHScroll(page, 'toolbar-portrait')
    await tapGram(page)
    await shot(page, 'toolbar-iphone-portrait')
    await context.close()
  },
  async 'toolbar-landscape'(browser) {
    const { context, page } = await openCuts(browser, SE_LAND)
    ok(await page.locator('[data-testid=cut-gram-tools]').count() > 0, 'cut-gram-tools missing (land)')
    await assertNoHScroll(page, 'toolbar-landscape')
    await tapGram(page)
    await shot(page, 'toolbar-iphone-landscape')
    await context.close()
  },
  async 'harm-on-cut'(browser) {
    const { context, page } = await openCuts(browser, SE)
    await armTool(page, 'cut-harm-tool')
    const pressed = await page.locator('[data-testid=cut-harm-tool]').getAttribute('aria-pressed')
    ok(pressed === 'true', `HARM not armed (aria-pressed=${pressed})`)
    const box = await gramBox(page)
    const canvas = page.locator('[data-testid=cut-lofar]')
    await canvas.click({ position: { x: box.width * 0.35, y: box.height * 0.45 }, force: true })
    await page.waitForTimeout(500)
    const n = await page.locator('[data-testid=harm-readout]').count()
    ok(n > 0, `harm readout missing (count=${n}, armed=${pressed})`)
    await assertHarmReadoutInView(page)
    await assertNoHScroll(page, 'harm-on-cut')
    await tapGram(page)
    await shot(page, 'harm-on-cut')
    await context.close()
  },
  async 'dop-on-cut'(browser) {
    const { context, page } = await openCuts(browser, SE)
    await armTool(page, 'cut-dop-tool')
    await page.waitForTimeout(200)
    const box = await gramBox(page)
    await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.5)
    await page.waitForTimeout(500)
    ok(await page.locator('[data-testid=dop-layer], [data-testid=dop-readout]').count() > 0, 'dop overlay missing')
    await tapGram(page)
    await shot(page, 'dop-on-cut')
    await context.close()
  },
  async 'lm-on-cut'(browser) {
    const { context, page } = await openCuts(browser, SE)
    await armTool(page, 'cut-lm-tool')
    await page.waitForTimeout(300)
    ok(await page.locator('[data-testid=lm-panel]').count() > 0, 'lm panel missing')
    const box = await gramBox(page)
    await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.4)
    await page.waitForTimeout(400)
    await tapGram(page)
    await shot(page, 'lm-on-cut')
    await context.close()
  },
  async 'cuts-320-portrait'(browser) {
    const { context, page } = await openCuts(browser, SE_320)
    ok(await page.locator('[data-testid=cut-gram-tools]').count() > 0, 'tools missing at 320')
    await assertNoHScroll(page, 'cuts-320-portrait')
    await tapGram(page)
    await shot(page, 'cuts-320-portrait')
    await context.close()
  },
  async 'live-no-hscroll'(browser) {
    const context = await browser.newContext({ ...SE, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    page.on('pageerror', (e) => fails.push(String(e)))
    await page.goto(`http://127.0.0.1:${port}/datum/?autoplay&rate=16`, { waitUntil: 'domcontentloaded' })
    await dismissSplash(page)
    await page.waitForSelector('[data-testid=lofar]', { timeout: 15000 })
    await page.waitForTimeout(800)
    await tapGram(page)
    await assertNoHScroll(page, 'live-portrait-375')
    await context.close()
  },
  async 'locked-cursor-on-cut'(browser) {
    const { context, page } = await openCuts(browser, SE)
    await armTool(page, 'cut-harm-tool')
    await page.waitForTimeout(200)
    const box = await gramBox(page)
    const x = box.x + box.width * 0.38
    const y = box.y + box.height * 0.42
    await page.touchscreen.tap(x, y)
    await page.waitForTimeout(300)
    // Second tap = lock (CURLOCK)
    await page.touchscreen.tap(x, y)
    await page.waitForTimeout(300)
    const locked = await page.locator('[data-testid=harm-readout][data-locked="1"], [data-testid=cut-lofar-frame][data-cursor-locked="1"], [data-drag-locked="1"]').count()
    ok(locked > 0, 'expected a locked cursor on cut')
    await shot(page, 'locked-cursor-on-cut')
    await context.close()
  },
}

const names = only ? [only] : Object.keys(views)
await startSrv()
const browser = await webkit.launch()
try {
  for (const name of names) {
    if (!views[name]) throw new Error(`unknown CUTTOOLS_ONLY=${name}`)
    console.log('running', name)
    await views[name](browser)
  }
} finally {
  await browser.close()
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}
writeFileSync(`${outDir}/summary.json`, JSON.stringify({ fails, names }, null, 2))
if (fails.length) {
  console.error('FAILS', fails)
  process.exit(1)
}
console.log('cuttools-shot ok', names)
