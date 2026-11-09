
/**
 * Chrome-green gram fill shots (headless; not touch/device validation).
 * - live LOFAR with data @ 951x600
 * - live DEMON with lines @ 951x600
 * - phone 382 folded live DEMON or LOFAR
 * - Cuts DEMON on cut-cinderlilt-cav
 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4252
const out = process.env.OUT || '/workspace/chrome-green-shots'
mkdirSync(out, { recursive: true })
const MIN = 160

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

async function canvasStats(page, testId) {
  return page.evaluate(async (tid) => {
    const c = document.querySelector(`[data-testid="${tid}"]`)
    if (!(c instanceof HTMLCanvasElement)) return { h: 0, w: 0, nonBlack: 0 }
    const h = c.clientHeight, w = c.clientWidth
    // Sample CSS pixels via a 2d read of the WebGL canvas is unreliable; use luminance from a PNG of the frame instead.
    return { h, w, nonBlack: -1 }
  }, testId)
}

async function pngNonEmpty(page, selector) {
  const loc = page.locator(selector).first()
  let buf
  try {
    if (await loc.count() && await loc.isVisible()) buf = await loc.screenshot({ timeout: 5000 })
    else buf = await page.screenshot({ fullPage: false })
  } catch {
    buf = await page.screenshot({ fullPage: false })
  }
  const { writeFileSync: w, unlinkSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const path = join(tmpdir(), `gramshot-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
  w(path, buf)
  const py = `
from PIL import Image
import json, statistics
im=Image.open(${JSON.stringify(path)}).convert('RGB')
w,h=im.size; px=im.load()
ys=[]
for y in range(int(h*0.08), int(h*0.92), max(1,h//80)):
  for x in range(int(w*0.02), int(w*0.98), max(1,w//80)):
    r,g,b=px[x,y]; ys.append(0.2126*r+0.7152*g+0.0722*b)
mean=sum(ys)/len(ys) if ys else 0
var=statistics.pvariance(ys) if len(ys)>1 else 0
print(json.dumps({"w":w,"h":h,"mean":mean,"variance":var,"n":len(ys)}))
`
  try {
    const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' })
    if (r.status !== 0) return { err: r.stderr || r.stdout, variance: 0, mean: 0 }
    return JSON.parse(r.stdout.trim().split('\n').pop())
  } finally {
    try { unlinkSync(path) } catch {}
  }
}

// ---- Live LOFAR 951 ----
{
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 951, height: 600 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?gram=lofar&autoplay&rate=16`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.getByTestId('gram-mode-lofar').click({ force: true }).catch(() => {})
  if (await page.locator('.play-btn.primary').count()) await page.getByTestId('play-btn').click({ force: true })
  await page.waitForTimeout(6000)
  await closeSheets(page)
  const h = await page.evaluate(() => document.querySelector('[data-testid=lofar]')?.clientHeight ?? 0)
  const sample = await pngNonEmpty(page, '[data-testid=lofar-frame]')
  const path = `${out}/after-live-lofar-951.png`
  await page.screenshot({ path, fullPage: false })
  report.push({ shot: path, kind: 'live-lofar-951', canvasH: h, sample, ok: h >= MIN && sample.variance > 5 })
  await ctx.close()
}

// ---- Live DEMON 951 ----
{
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 951, height: 600 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?gram=demon&autoplay&rate=16&demon=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  const demonBtn = page.getByTestId('gram-mode-demon')
  await demonBtn.waitFor({ timeout: 15000 })
  if (!(await demonBtn.isDisabled())) await demonBtn.click({ force: true })
  if (await page.locator('.play-btn.primary').count()) await page.getByTestId('play-btn').click({ force: true })
  await page.waitForTimeout(8000)
  await closeSheets(page)
  await page.waitForSelector('[data-testid=demon-panel][data-visible="1"]', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(1000)
  const h = await page.evaluate(() => document.querySelector('[data-testid=demon]')?.clientHeight ?? 0)
  const sample = await pngNonEmpty(page, '[data-testid=demon-panel]')
  const path = `${out}/after-live-demon-951.png`
  await page.screenshot({ path, fullPage: false })
  report.push({ shot: path, kind: 'live-demon-951', canvasH: h, sample, ok: h >= MIN && sample.variance > 2 })
  await ctx.close()
}

// ---- Phone 382 DEMON (or LOFAR fallback) ----
{
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 382, height: 600 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?gram=demon&autoplay&rate=16&demon=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  const demonBtn = page.getByTestId('gram-mode-demon')
  let mode = 'demon'
  if (await demonBtn.count() && !(await demonBtn.isDisabled())) await demonBtn.click({ force: true })
  else { mode = 'lofar'; await page.getByTestId('gram-mode-lofar').click({ force: true }).catch(() => {}) }
  if (await page.locator('.play-btn.primary').count()) await page.getByTestId('play-btn').click({ force: true })
  await page.waitForTimeout(5000)
  await closeSheets(page)
  const tid = mode === 'demon' ? 'demon' : 'lofar'
  const h = await page.evaluate((t) => document.querySelector(`[data-testid=${t}]`)?.clientHeight ?? 0, tid)
  const sample = await pngNonEmpty(page, `[data-testid=${tid}-frame]`)
  const path = `${out}/after-382.png`
  await page.screenshot({ path, fullPage: false })
  report.push({ shot: path, kind: `live-${mode}-382`, canvasH: h, sample, ok: h >= MIN && sample.variance > 2 })
  await ctx.close()
}

// ---- Cuts DEMON cut-cinderlilt-cav ----
{
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 951, height: 600 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?demon=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.getByTestId('tab-cuts').click({ force: true })
  await page.locator('[data-testid=cut-picker]').waitFor({ timeout: 10000 })
  // Prefer explicit cut id; fall back to first pick (lesson pack puts cinderlilt-cav first).
  await page.getByTestId('cut-pick-1').click({ force: true })
  await page.locator('[data-testid=cuts-screen][data-cut-id="cut-cinderlilt-cav"]').waitFor({ timeout: 15000 })
  await page.locator('[data-testid=cut-bar]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const cutDemon = page.getByTestId('cut-gram-mode-demon')
  const demonBtnCount = await cutDemon.count()
  if (demonBtnCount && !(await cutDemon.isDisabled())) {
    await cutDemon.click({ force: true })
    await page.waitForTimeout(2500)
  }
  const play = page.locator('[data-testid=cut-play]').first()
  if (await play.count() && (await play.getAttribute('aria-label')) !== 'Pause') await play.click({ force: true })
  await page.waitForTimeout(9000)
  const h = await page.evaluate(() => {
    const c = document.querySelector('.cut-player [data-testid=demon]')
    return c?.clientHeight ?? 0
  })
  const sample = await pngNonEmpty(page, '[data-testid=demon-panel], [data-testid=cut-gram]')
  const path = `${out}/after-cuts-cinderlilt-demon-951.png`
  await page.screenshot({ path, fullPage: false })
  report.push({ shot: path, kind: 'cuts-cinderlilt-demon', demonBtnCount, canvasH: h, sample, ok: demonBtnCount > 0 && h >= 80 && sample.variance > 2 })
  await ctx.close()
}

writeFileSync(`${out}/gram-shots-report.json`, JSON.stringify({ note: 'headless capture, not touch/device validation', report }, null, 2))
console.log(JSON.stringify({ note: 'headless capture, not touch/device validation', report }, null, 2))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
if (report.some((r) => !r.ok)) process.exit(2)
