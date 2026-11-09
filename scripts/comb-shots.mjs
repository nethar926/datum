/**
 * Headless COMB shots at 951 / 669 / 382 — live LOFAR (singing-prop scratch) + Cuts.
 * Label: headless capture, not touch/device validation.
 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const log = (m) => { try { process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`) } catch {} }

const port = Number(process.env.PORT) || 4260
const out = process.env.OUT || '/workspace/comb-shots'
mkdirSync(out, { recursive: true })

/** Seed-90 singing-prop under tip scratch: f0=313.3, shaft Hz ≈ 2.1724. */
const LIVE_SEED = 90
const LIVE_F0 = 313.3
const LIVE_PSR = 2.1724
const LIVE_SIDEBANDS = 3
const LIVE_VIEW = { lo: LIVE_F0 - 22, hi: LIVE_F0 + 22 }
const LIVE_TRUE_LINES = Array.from({ length: 2 * LIVE_SIDEBANDS + 1 }, (_, i) => {
  const n = i - LIVE_SIDEBANDS
  return { n, hz: LIVE_F0 + n * LIVE_PSR }
})

/**
 * cut-cinderlilt-cav: singing gated off at 14 kn.
 * cut-brindleflux-snork (picker Cut 4): singing ON, f0=158.24, PSR≈5.252.
 */
const CUT_PICK = 4
const CUT_ID = 'cut-brindleflux-snork'
const CUT_F0 = 158.24
const CUT_PSR = 5.2523
const CUT_SIDEBANDS = 3
const CUT_VIEW = { lo: CUT_F0 - 40, hi: CUT_F0 + 40 }
const CUT_TRUE_LINES = Array.from({ length: 2 * CUT_SIDEBANDS + 1 }, (_, i) => {
  const n = i - CUT_SIDEBANDS
  return { n, hz: CUT_F0 + n * CUT_PSR }
})
const CUT_NOTE =
  'Switched from cut-cinderlilt-cav (singing gated off) to cut-brindleflux-snork (singing ON).'

try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
await new Promise((r) => setTimeout(r, 400))
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url).pathname,
})
log(`starting preview :${port}`)
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 200))
}
log('preview up')

const browser = await chromium.launch()
const report = []

async function closeSheets(page) {
  for (let i = 0; i < 4; i++) {
    if (!(await page.locator('.sheet-root.open').count())) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

async function waitShotApi(page) {
  await page.waitForFunction(() => !!window.__datumShot, null, { timeout: 15000 })
}

async function setComb(page, centreHz, spacingHz, sidebands, view) {
  await page.evaluate(({ centreHz, spacingHz, sidebands, view }) => {
    window.__datumShot.setView(view.lo, view.hi)
    window.__datumShot.setComb(centreHz, spacingHz, sidebands)
  }, { centreHz, spacingHz, sidebands, view })
}

async function readMatched(page) {
  const readout = await page.locator('[data-testid=cuts-screen] [data-testid=comb-readout], [data-testid=live-gram-panel] [data-testid=comb-readout]').last().textContent().catch(() => '')
  const matched = /·\s*(\d+)\s*\/\s*(\d+)/.exec(readout || '')
  return {
    readout,
    matched: matched ? { n: Number(matched[1]), slots: Number(matched[2]) } : null,
  }
}

/** Place once, wait for MATCHED to climb, then pause playback so the shot freezes on the peak. */
async function waitForMatched(page, { minMatched = 5, tries = 40, gapMs = 400, playTestId = 'play-btn' } = {}) {
  let best = { n: -1, slots: null, readout: '' }
  const attempts = []
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(gapMs)
    const cur = await readMatched(page)
    const n = cur.matched?.n ?? -1
    attempts.push({ i, n, readout: cur.readout })
    if (n > best.n) best = { n, slots: cur.matched?.slots ?? null, readout: cur.readout }
    if (n >= minMatched) {
      const btn = page.getByTestId(playTestId).first()
      if (await btn.count()) {
        const label = await btn.getAttribute('aria-label')
        if (label === 'Pause') await btn.click({ force: true }).catch(() => {})
      }
      await page.waitForTimeout(200)
      // Re-read after pause (row sampler still current).
      const frozen = await readMatched(page)
      return {
        n: frozen.matched?.n ?? best.n,
        slots: frozen.matched?.slots ?? best.slots,
        readout: frozen.readout || best.readout,
        attempts, paused: true,
      }
    }
  }
  // Freeze anyway so the screenshot does not drift further.
  const btn = page.getByTestId(playTestId).first()
  if (await btn.count()) {
    const label = await btn.getAttribute('aria-label')
    if (label === 'Pause') await btn.click({ force: true }).catch(() => {})
  }
  return { ...best, attempts, paused: false }
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
    for (let i = 1; i < marks.length; i++) gaps.push({ from: marks[i - 1].n, to: marks[i].n, px: marks[i].x - marks[i - 1].x })
    const hasC = marks.some((m) => m.n === 0 && m.hasLabel && m.label === 'C')
    const peaks = document.querySelectorAll('.comb-peak-tick').length
    return { marks, gaps, hasC, peaks }
  })
}

async function diagnoseGeometry(page, trueLines, view) {
  return page.evaluate(({ trueLines, view }) => {
    const canvas = document.querySelector('.gram canvas')
    const frame = canvas?.getBoundingClientRect()
    const width = frame?.width || 1
    const left = frame?.left || 0
    const freqToX = (f) => ((f - view.lo) / (view.hi - view.lo)) * width
    const marks = [...document.querySelectorAll('.comb-marker')]
      .map((el) => {
        const n = Number(el.getAttribute('data-n'))
        const r = el.getBoundingClientRect()
        return { n, markPx: r.left - left }
      })
      .filter((m) => Number.isFinite(m.n))
      .sort((a, b) => a.n - b.n)
    const rows = trueLines.map((t) => {
      const mark = marks.find((m) => m.n === t.n)
      const linePx = freqToX(t.hz)
      const markPx = mark?.markPx ?? null
      return {
        n: t.n, trueHz: t.hz, markPx, linePx,
        offsetPx: markPx == null ? null : markPx - linePx,
        absOffsetPx: markPx == null ? null : Math.abs(markPx - linePx),
      }
    })
    const cursor = document.querySelector('[data-testid$="-cursor"]')
    const axisY = document.querySelector('.axis-y')
    let cursorClear = null
    if (cursor && axisY && frame) {
      const cr = cursor.getBoundingClientRect()
      const ar = axisY.getBoundingClientRect()
      cursorClear = {
        cursorRight: cr.right, axisLeft: ar.left, gapPx: ar.left - cr.right,
        clippedPastGram: cr.right > frame.right + ar.width + 2, text: cursor.textContent,
      }
    }
    return { width, rows, maxAbsOffsetPx: Math.max(0, ...rows.map((r) => r.absOffsetPx ?? 0)), cursorClear }
  }, { trueLines, view })
}

async function readCombState(page) {
  const { readout, matched } = await readMatched(page)
  const marks = await page.locator('.comb-marker').count()
  const cursor = await page.locator('[data-testid=lofar-cursor], [data-testid=cut-lofar-cursor]').first().textContent().catch(() => '')
  const spacing = await measureMarkSpacing(page)
  const stepGaps = spacing.gaps.filter((g) => g.to - g.from === 1).map((g) => g.px)
  const mean = stepGaps.length ? stepGaps.reduce((a, b) => a + b, 0) / stepGaps.length : 0
  const maxDev = stepGaps.length ? Math.max(...stepGaps.map((g) => Math.abs(g - mean))) : 0
  return {
    readout, marks, cursor, spacing, matched,
    evenSpacing: { meanPx: mean, maxDevPx: maxDev, ok: maxDev <= 2.5, stepGaps },
  }
}

async function parkCursor(page, testId) {
  const frame = page.locator(`[data-testid=${testId}]`).first()
  const box = await frame.boundingBox()
  if (box) await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.45)
  await page.waitForTimeout(150)
}

async function shotLive(w, h) {
  log(`live ${w} start`)
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: w, height: h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  const url = `http://127.0.0.1:${port}/datum/?gram=lofar&autoplay&rate=8&shot=1&scenario=generated&seed=${LIVE_SEED}&speedLo=5&speedHi=14&diff=easy&cpaLo=0.4&cpaHi=1.2`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.waitForTimeout(600)
  if (await page.locator('.play-btn.primary').count()) await page.getByTestId('play-btn').click({ force: true }).catch(() => {})
  await waitShotApi(page)
  await page.evaluate((view) => window.__datumShot.setView(view.lo, view.hi), LIVE_VIEW)
  log(`live ${w} wait SNR`)
  await page.waitForTimeout(12000)
  await setComb(page, LIVE_F0, LIVE_PSR * 1.5, LIVE_SIDEBANDS, LIVE_VIEW)
  await page.waitForTimeout(300)
  const wrong = await readMatched(page)
  await setComb(page, LIVE_F0, LIVE_PSR, LIVE_SIDEBANDS, LIVE_VIEW)
  const best = await waitForMatched(page, { minMatched: 5, tries: 45, gapMs: 350, playTestId: 'play-btn' })
  log(`live ${w} best MATCHED ${best.n} paused=${best.paused}`)
  await parkCursor(page, 'lofar-frame')
  const state = await readCombState(page)
  const geometry = await diagnoseGeometry(page, LIVE_TRUE_LINES, LIVE_VIEW)
  const path = `${out}/comb-live-lofar-${w}.png`
  await page.screenshot({ path, fullPage: false })
  report.push({
    shot: path, kind: `live-lofar-${w}`, ...state, geometry, headless: true,
    drawn: { f0: LIVE_F0, psr: LIVE_PSR, sidebands: LIVE_SIDEBANDS, seed: LIVE_SEED },
    trueLines: LIVE_TRUE_LINES, matchedDrawn: state.matched, matchedWrong15x: wrong, bestMatchedPoll: best,
  })
  await ctx.close()
  log(`live ${w} done → ${path}`)
}

async function shotCuts(w, h) {
  log(`cuts ${w} start`)
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: w, height: h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/datum/?demon=1&shot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await closeSheets(page)
  await page.getByTestId('tab-cuts').click({ force: true })
  await page.locator('[data-testid=cut-picker]').waitFor({ timeout: 10000 })
  await page.getByTestId(`cut-pick-${CUT_PICK}`).click({ force: true })
  await page.locator(`[data-testid=cuts-screen][data-cut-id="${CUT_ID}"]`).waitFor({ timeout: 15000 })
  await page.waitForTimeout(600)
  const title = await page.locator('.cut-player .nav-title b').first().textContent().catch(() => '')
  const lofarBtn = page.getByTestId('cut-gram-mode-lofar')
  if (await lofarBtn.count()) await lofarBtn.click({ force: true })
  await page.waitForTimeout(300)
  const play = page.locator('[data-testid=cut-play]').first()
  if (await play.count() && (await play.getAttribute('aria-label')) !== 'Pause') await play.click({ force: true })
  await waitShotApi(page)
  await page.evaluate((view) => window.__datumShot.setView(view.lo, view.hi), CUT_VIEW)
  log(`cuts ${w} wait SNR`)
  await page.waitForTimeout(20000)
  await setComb(page, CUT_F0, CUT_PSR * 1.5, CUT_SIDEBANDS, CUT_VIEW)
  await page.waitForTimeout(300)
  const wrong = await readMatched(page)
  await setComb(page, CUT_F0, CUT_PSR, CUT_SIDEBANDS, CUT_VIEW)
  const best = await waitForMatched(page, { minMatched: 5, tries: 40, gapMs: 350, playTestId: 'cut-play' })
  log(`cuts ${w} best MATCHED ${best.n} paused=${best.paused}`)
  await parkCursor(page, 'cut-lofar-frame')
  const state = await readCombState(page)
  const geometry = await diagnoseGeometry(page, CUT_TRUE_LINES, CUT_VIEW)
  const path = `${out}/comb-cuts-${w}.png`
  await page.screenshot({ path, fullPage: false })
  report.push({
    shot: path, kind: `cuts-${w}`, title: (title || '').slice(0, 40), ...state, geometry, headless: true,
    drawn: { f0: CUT_F0, psr: CUT_PSR, sidebands: CUT_SIDEBANDS, cutId: CUT_ID, note: CUT_NOTE },
    trueLines: CUT_TRUE_LINES, matchedDrawn: state.matched, matchedWrong15x: wrong, bestMatchedPoll: best,
  })
  await ctx.close()
  log(`cuts ${w} done → ${path}`)
}

for (const [w, h] of [[951, 600], [669, 600], [382, 600]]) {
  await shotLive(w, h)
  await shotCuts(w, h)
}

writeFileSync(`${out}/comb-shots-report.json`, JSON.stringify({
  note: 'headless capture, not touch/device validation',
  scratchAcoustics: 'm3-src-swath@9875e3d singing-prop (not committed)',
  liveDrawn: { seed: LIVE_SEED, f0: LIVE_F0, psr: LIVE_PSR, sidebands: LIVE_SIDEBANDS },
  cutDrawn: { cutId: CUT_ID, f0: CUT_F0, psr: CUT_PSR, sidebands: CUT_SIDEBANDS, note: CUT_NOTE },
  matchGate: { peakDbOverMedian: 3, tolBins: 0.5, tolSpacingFrac: 0.15 },
  report,
}, null, 2))
log('ALL DONE')
console.log(JSON.stringify({ note: 'headless', summary: report.map((r) => ({
  kind: r.kind, matched: r.matched, pollBest: r.bestMatchedPoll?.n,
  maxAbsOffsetPx: r.geometry?.maxAbsOffsetPx, cursorGap: r.geometry?.cursorClear?.gapPx,
  even: r.evenSpacing?.ok, readout: r.readout,
})) }, null, 2))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
