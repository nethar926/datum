/**
 * Headless COMB shots at 951 / 669 / 382 — live LOFAR + Cuts.
 * Label: headless capture, not touch/device validation.
 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4260
const out = process.env.OUT || '/workspace/comb-shots'
mkdirSync(out, { recursive: true })

try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
await new Promise((r) => setTimeout(r, 400))
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url).pathname,
})
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 200))
}

const browser = await chromium.launch()
const report = []

async function closeSheets(page) {
  for (let i = 0; i < 4; i++) {
    if (!(await page.locator('.sheet-root.open').count())) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
}

/** Place COMB: pin centre then drag right to set spacing via pointer events on the gram frame. */
async function placeComb(page, centreFrac = 0.35, spacingFrac = 0.48) {
  // Phone ToolScroll can swallow Playwright force-clicks; dispatch a real click in-page.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=comb-tool], [data-testid=cut-comb-tool]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  })
  await page.waitForTimeout(300)
  const frame = page.locator('[data-testid=lofar-frame], [data-testid=cut-lofar-frame]').first()
  await frame.waitFor({ timeout: 10000 })
  const box = await frame.boundingBox()
  if (!box) throw new Error('no gram frame')
  const y = box.y + box.height * 0.55
  const x0 = box.x + box.width * centreFrac
  const x1 = box.x + box.width * spacingFrac
  await page.mouse.move(x0, y)
  await page.mouse.down()
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.mouse.move(x1, y)
  await page.mouse.down()
  await page.waitForTimeout(60)
  await page.mouse.move(x1 + 2, y)
  await page.mouse.up()
  await page.waitForTimeout(400)
}

async function shotLive(w, h) {
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: w, height: h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?gram=lofar&autoplay&rate=16`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.waitForTimeout(2500)
  if (await page.locator('.play-btn.primary').count()) await page.getByTestId('play-btn').click({ force: true }).catch(() => {})
  await page.waitForTimeout(4000)
  await placeComb(page)
  const readout = await page.getByTestId('comb-readout').textContent().catch(() => '')
  const marks = await page.locator('.comb-marker').count()
  const path = `${out}/comb-live-lofar-${w}.png`
  await page.screenshot({ path, fullPage: false })
  report.push({ shot: path, kind: `live-lofar-${w}`, readout, marks, headless: true })
  await ctx.close()
}

async function shotCuts(w, h) {
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: w, height: h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?demon=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.getByTestId('tab-cuts').click({ force: true })
  await page.locator('[data-testid=cut-picker]').waitFor({ timeout: 10000 })
  await page.getByTestId('cut-pick-1').click({ force: true })
  await page.locator('[data-testid=cuts-screen][data-cut-id="cut-cinderlilt-cav"]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const title = await page.locator('.cut-player .navbar, [data-testid=cuts-screen]').first().textContent().catch(() => '')
  // Prefer LOFAR for COMB
  const lofarBtn = page.getByTestId('cut-gram-mode-lofar')
  if (await lofarBtn.count()) await lofarBtn.click({ force: true })
  await page.waitForTimeout(800)
  const play = page.locator('[data-testid=cut-play]').first()
  if (await play.count() && (await play.getAttribute('aria-label')) !== 'Pause') await play.click({ force: true })
  await page.waitForTimeout(5000)
  await placeComb(page, 0.4, 0.55)
  const readout = await page.getByTestId('comb-readout').textContent().catch(() => '')
  const marks = await page.locator('.comb-marker').count()
  const path = `${out}/comb-cuts-${w}.png`
  await page.screenshot({ path, fullPage: false })
  report.push({ shot: path, kind: `cuts-${w}`, title: title?.slice(0, 40), readout, marks, headless: true })
  await ctx.close()
}

for (const [w, h] of [[951, 600], [669, 600], [382, 600]]) {
  await shotLive(w, h)
  await shotCuts(w, h)
}

writeFileSync(`${out}/comb-shots-report.json`, JSON.stringify({ note: 'headless capture, not touch/device validation', report }, null, 2))
console.log(JSON.stringify({ note: 'headless', report }, null, 2))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
