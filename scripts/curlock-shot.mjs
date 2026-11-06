/**
 * CURLOCK smoke (WebKit): default cursor lock mark, drag-ignored while locked, HARM lock.
 * Saves to /workspace/curlock-shots/. PORT=4210. Run one view at a time via CURLOCK_ONLY=slug.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4210
const outDir = process.env.SHOT_DIR || '/workspace/curlock-shots'
const only = process.env.CURLOCK_ONLY || ''
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
  const gram = page.locator('[data-testid=lofar], [data-testid=gram], .gram-panel .panel-body, canvas').first()
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

async function openLive(browser) {
  const context = await browser.newContext({ ...SE, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  page.on('pageerror', (e) => fails.push(String(e)))
  await page.goto(`http://127.0.0.1:${port}/datum/?autoplay&rate=16`, { waitUntil: 'domcontentloaded' })
  await dismissSplash(page)
  await page.waitForSelector('[data-testid=lofar]', { timeout: 15000 })
  await page.waitForTimeout(800)
  await tapGram(page)
  return { context, page }
}

async function gramBox(page) {
  const box = await page.locator('[data-testid=lofar]').boundingBox()
  if (!box) throw new Error('no lofar canvas')
  return box
}

/** Touch tap that does not hover-scrub the unlocked cursor first (CURLOCK no-jump). */
async function touchTap(page, x, y) {
  await page.touchscreen.tap(x, y)
  await page.waitForTimeout(100)
}

/** Drag from (x0,y0) by dx over ~12 steps. */
async function drag(page, x0, y0, dx, dy = 0) {
  const steps = 12
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps)
  }
  await page.mouse.up()
  await page.waitForTimeout(120)
}

async function readCursor(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('[data-testid=lofar-frame]')
    const ro = document.querySelector('[data-testid=lofar-cursor]')
    const lockIc = ro?.querySelector('.cursor-lock-ic')
    return {
      locked: frame?.getAttribute('data-cursor-locked') === '1',
      readout: ro?.textContent?.trim() ?? null,
      hasLockIc: !!lockIc,
      dataLocked: ro?.getAttribute('data-locked') === '1',
    }
  })
}

async function shot(name, fn) {
  if (only && only !== name) return
  const browser = await webkit.launch()
  try {
    await startSrv()
    const { context, page } = await openLive(browser)
    await fn(page)
    await page.screenshot({ path: `${outDir}/${name}.png` })
    writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ name, fails: [...fails] }, null, 2))
    console.log('shot', name, 'fails so far', fails.length)
    await context.close()
  } finally {
    await browser.close()
    if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null }
  }
}

await shot('unlocked-default', async (page) => {
  const b = await gramBox(page)
  // Scrub unlocked: mouse drag places a free cursor.
  await drag(page, b.x + b.width * 0.35, b.y + b.height * 0.4, 40, 0)
  const c = await readCursor(page)
  ok(c.readout !== null, 'unlocked: expected cursor readout')
  ok(!c.locked, 'unlocked: data-cursor-locked should be 0')
  ok(!c.hasLockIc, 'unlocked: no lock icon')
  console.log('unlocked', c)
})

await shot('locked-default', async (page) => {
  const b = await gramBox(page)
  await drag(page, b.x + b.width * 0.3, b.y + b.height * 0.45, 30, 0)
  const before = await readCursor(page)
  // Touch lock-tap away from the cursor — must not jump Hz (mouse hover would scrub first).
  await touchTap(page, b.x + b.width * 0.7, b.y + b.height * 0.55)
  const after = await readCursor(page)
  ok(after.locked, 'locked: data-cursor-locked')
  ok(after.hasLockIc, 'locked: lock icon on readout')
  ok(after.dataLocked, 'locked: data-locked on readout')
  // Readout Hz should match pre-tap (no jump). Compare leading number.
  const hz = (t) => Number((t || '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN)
  const bh = hz(before.readout), ah = hz(after.readout)
  ok(Number.isFinite(bh) && Number.isFinite(ah) && Math.abs(bh - ah) < 0.05, `lock tap jumped cursor ${bh} → ${ah}`)
  console.log('locked-default', { before, after })
})

await shot('locked-drag-ignored', async (page) => {
  const b = await gramBox(page)
  await drag(page, b.x + b.width * 0.28, b.y + b.height * 0.42, 25, 0)
  await touchTap(page, b.x + b.width * 0.5, b.y + b.height * 0.5)
  const locked = await readCursor(page)
  ok(locked.locked, 'pre-drag: locked')
  const hz0 = locked.readout
  // Big drag while locked — cursor Hz must stay put.
  await drag(page, b.x + b.width * 0.3, b.y + b.height * 0.4, 120, 30)
  const after = await readCursor(page)
  ok(after.locked, 'still locked after drag')
  ok(after.readout === hz0, `drag moved locked cursor: ${hz0} → ${after.readout}`)
  console.log('locked-drag', { hz0, after })
})

await shot('harm-locked', async (page) => {
  await page.getByRole('button', { name: 'HARM', exact: true }).click()
  await page.waitForTimeout(250)
  const canvas = page.locator('[data-testid=lofar]')
  const b = await gramBox(page)
  // Place fundamental (click).
  await canvas.click({ position: { x: b.width * 0.22, y: b.height * 0.5 }, force: true })
  await page.waitForSelector('[data-testid=harm-readout]', { timeout: 5000 })
  await page.waitForTimeout(250)
  const placed = await page.evaluate(() => document.querySelector('[data-testid=harm-readout]')?.textContent?.trim() ?? null)
  ok(!!placed && /F0/.test(placed), `harm not placed: ${placed}`)
  // Lock tap — different spot, classified tap toggles HARM lock.
  await canvas.click({ position: { x: b.width * 0.55, y: b.height * 0.6 }, force: true })
  await page.waitForTimeout(250)
  const info = await page.evaluate(() => {
    const ro = document.querySelector('[data-testid=harm-readout]')
    return {
      text: ro?.textContent?.trim() ?? null,
      locked: ro?.getAttribute('data-locked') === '1',
      hasLockIc: !!ro?.querySelector('.cursor-lock-ic'),
      dragLockable: document.querySelector('[data-testid=lofar-frame]')?.getAttribute('data-cursor-locked'),
    }
  })
  ok(info.text !== null, 'harm readout present')
  ok(info.locked && info.hasLockIc, `harm lock mark missing: ${JSON.stringify(info)}`)
  const before = info.text
  await drag(page, b.x + b.width * 0.25, b.y + b.height * 0.5, 80, 0)
  const after = await page.evaluate(() => document.querySelector('[data-testid=harm-readout]')?.textContent?.trim() ?? null)
  ok(after === before, `harm moved while locked: ${before} → ${after}`)
  console.log('harm-locked', { placed, before, after, info })
})

if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {} }
writeFileSync(`${outDir}/summary.json`, JSON.stringify({ fails }, null, 2))
console.log(JSON.stringify({ fails }, null, 2))
if (fails.length) process.exitCode = 1
