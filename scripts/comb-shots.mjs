/**
 * Headless COMB shots at 951 / 669 / 382 — live LOFAR (singing-prop scratch) + Cuts.
 * Label: headless capture, not touch/device validation.
 * Measures geometric mark pixel spacing (must be even) and MATCHED at drawn vs 1.5× spacing.
 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4260
const out = process.env.OUT || '/workspace/comb-shots'
mkdirSync(out, { recursive: true })

const LIVE_SEED = 90
const LIVE_F0 = 313.3
const LIVE_PSR = 2.257
const LIVE_SIDEBANDS = 3
const LIVE_VIEW = { lo: LIVE_F0 - 22, hi: LIVE_F0 + 22 }

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

async function ensureGramDetent(page) {
  const grab = page.getByTestId('plot-grabber')
  if (!(await grab.count())) return
  const box = await grab.boundingBox()
  if (!box) return
  const midX = box.x + box.width / 2
  await page.mouse.move(midX, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(midX, Math.max(40, box.y - 320), { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(450)
}

async function waitShotApi(page) {
  await page.waitForFunction(() => !!window.__datumShot, null, { timeout: 15000 })
}

async function placeViaHook(page, centreHz, spacingHz, sidebands, view) {
  await waitShotApi(page)
  await page.evaluate(({ centreHz, spacingHz, sidebands, view }) => {
    window.__datumShot.setView(view.lo, view.hi)
    window.__datumShot.setComb(centreHz, spacingHz, sidebands)
  }, { centreHz, spacingHz, sidebands, view })
  await page.waitForTimeout(500)
}

async function measureMarkSpacing(page) {
  return page.evaluate(() => {
    const marks = [...document.querySelectorAll('.comb-marker')]
      .map((el) => {
        const n = Number(el.getAttribute('data-n'))
        const r = el.getBoundingClientRect()
        return { n, x: r.left, hasLabel: !!el.querySelector('span'), label: el.querySelector('span')?.textContent ?? '' }
      })
      .filter((m) => Number.isFinite(m.n))
      .sort((a, b) => a.n - b.n)
    const gaps = []
    for (let i = 1; i < marks.length; i++) {
      gaps.push({ from: marks[i - 1].n, to: marks[i].n, px: marks[i].x - marks[i - 1].x })
    }
    const hasC = marks.some((m) => m.n === 0 && m.hasLabel && m.label === 'C')
    const peaks = document.querySelectorAll('.comb-peak-tick').length
    return { marks, gaps, hasC, peaks }
  })
}

async function readCombState(page) {
  const readout = await page.locator('[data-testid=cuts-screen] [data-testid=comb-readout], [data-testid=live-gram-panel] [data-testid=comb-readout]').last().textContent().catch(() => '')
  const marks = await page.locator('.comb-marker').count()
  const cursor = await page.locator('[data-testid=lofar-cursor], [data-testid=cut-lofar-cursor]').first().textContent().catch(() => '')
  const spacing = await measureMarkSpacing(page)
  const matched = /·\s*(\d+)\s*\/\s*(\d+)/.exec(readout || '')
  // Gap evenness: adjacent same-order-step gaps should be within ~2 px
  const stepGaps = spacing.gaps.filter((g) => g.to - g.from === 1).map((g) => g.px)
  const mean = stepGaps.length ? stepGaps.reduce((a, b) => a + b, 0) / stepGaps.length : 0
  const maxDev = stepGaps.length ? Math.max(...stepGaps.map((g) => Math.abs(g - mean))) : 0
  return {
    readout, marks, cursor, spacing,
    matched: matched ? { n: Number(matched[1]), slots: Number(matched[2]) } : null,
    evenSpacing: { meanPx: mean, maxDevPx: maxDev, ok: maxDev <= 2.5, stepGaps },
  }
}

async function parkCursor(page, testId) {
  const frame = page.locator(`[data-testid=${testId}]`).first()
  const box = await frame.boundingBox()
  if (box) await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.55)
  await page.waitForTimeout(200)
}

async function matchedAtSpacing(page, centreHz, spacingHz, sidebands, view) {
  await placeViaHook(page, centreHz, spacingHz, sidebands, view)
  await page.waitForTimeout(300)
  const readout = await page.locator('[data-testid=cuts-screen] [data-testid=comb-readout], [data-testid=live-gram-panel] [data-testid=comb-readout]').last().textContent().catch(() => '')
  const matched = /·\s*(\d+)\s*\/\s*(\d+)/.exec(readout || '')
  return matched ? { n: Number(matched[1]), slots: Number(matched[2]), readout } : { n: null, slots: null, readout }
}

async function shotLive(w, h) {
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: w, height: h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  const url = `http://127.0.0.1:${port}/datum/?gram=lofar&autoplay&rate=32&shot=1&scenario=generated&seed=${LIVE_SEED}&speedLo=5&speedHi=14&diff=easy&cpaLo=0.4&cpaHi=1.2`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.waitForTimeout(1200)
  if (await page.locator('.play-btn.primary').count()) await page.getByTestId('play-btn').click({ force: true }).catch(() => {})
  await ensureGramDetent(page)
  await waitShotApi(page)
  await page.evaluate((view) => window.__datumShot.setView(view.lo, view.hi), LIVE_VIEW)
  await page.waitForTimeout(18000)
  // Wrong spacing first (for MATCHED comparison), then drawn spacing for the screenshot.
  const wrong = await matchedAtSpacing(page, LIVE_F0, LIVE_PSR * 1.5, LIVE_SIDEBANDS, LIVE_VIEW)
  await placeViaHook(page, LIVE_F0, LIVE_PSR, LIVE_SIDEBANDS, LIVE_VIEW)
  await parkCursor(page, 'lofar-frame')
  const state = await readCombState(page)
  const path = `${out}/comb-live-lofar-${w}.png`
  await page.screenshot({ path, fullPage: false })
  report.push({
    shot: path, kind: `live-lofar-${w}`, ...state, headless: true,
    drawn: { f0: LIVE_F0, psr: LIVE_PSR, sidebands: LIVE_SIDEBANDS, seed: LIVE_SEED },
    matchedDrawn: state.matched,
    matchedWrong15x: wrong,
  })
  await ctx.close()
}

async function shotCuts(w, h) {
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: w, height: h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?demon=1&shot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.getByTestId('tab-cuts').click({ force: true })
  await page.locator('[data-testid=cut-picker]').waitFor({ timeout: 10000 })
  await page.getByTestId('cut-pick-1').click({ force: true })
  await page.locator('[data-testid=cuts-screen][data-cut-id="cut-cinderlilt-cav"]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  const title = await page.locator('.cut-player .nav-title b').first().textContent().catch(() => '')
  const lofarBtn = page.getByTestId('cut-gram-mode-lofar')
  if (await lofarBtn.count()) await lofarBtn.click({ force: true })
  await page.waitForTimeout(500)
  const play = page.locator('[data-testid=cut-play]').first()
  if (await play.count() && (await play.getAttribute('aria-label')) !== 'Pause') await play.click({ force: true })
  await waitShotApi(page)
  // Focus a band with visible structure; wait long enough for a tall waterfall.
  const cutCentre = 100
  const cutPsr = 1.2
  const cutView = { lo: 82, hi: 118 }
  await page.evaluate((view) => window.__datumShot.setView(view.lo, view.hi), cutView)
  await page.waitForTimeout(20000)
  const wrong = await matchedAtSpacing(page, cutCentre, cutPsr * 1.5, 5, cutView)
  await placeViaHook(page, cutCentre, cutPsr, 5, cutView)
  await parkCursor(page, 'cut-lofar-frame')
  const state = await readCombState(page)
  const path = `${out}/comb-cuts-${w}.png`
  await page.screenshot({ path, fullPage: false })
  report.push({
    shot: path, kind: `cuts-${w}`, title: (title || '').slice(0, 40), ...state, headless: true,
    drawn: { f0: cutCentre, psr: cutPsr, note: 'cut focus ~1.2 Hz' },
    matchedDrawn: state.matched,
    matchedWrong15x: wrong,
  })
  await ctx.close()
}

for (const [w, h] of [[951, 600], [669, 600], [382, 600]]) {
  await shotLive(w, h)
  await shotCuts(w, h)
}

writeFileSync(`${out}/comb-shots-report.json`, JSON.stringify({
  note: 'headless capture, not touch/device validation',
  scratchAcoustics: 'm3-acoustics-src-swath@6cc48c9 (not committed)',
  liveDrawn: { seed: LIVE_SEED, f0: LIVE_F0, psr: LIVE_PSR, sidebands: LIVE_SIDEBANDS },
  matchGate: { peakDbOverMedian: 3, tolBins: 0.5, tolSpacingFrac: 0.15 },
  report,
}, null, 2))
console.log(JSON.stringify({ note: 'headless', report }, null, 2))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
