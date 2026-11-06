// CUT player smoke (WebKit): open Cuts tab, pick a cut, play a few seconds, assert dark gram with real rows
// (element screenshot luminance via PIL — WebGL preserveDrawingBuffer is false), switch back to Live.
// Port 4201 for HIG3 (4190 is browser-restricted). PORT env overrides.
// Run after `npm run build`. Saves docs/m3-cuts-*.png and docs/m3-hig3-*.png (mid-scrub).
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4201
mkdirSync('docs', { recursive: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview on ${port} not ready`)
}
const DESK = { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }

/** Luminance stats over a PNG buffer (CUT gram element screenshot). */
function samplePng(buf) {
  const path = join(tmpdir(), `datum-cut-gram-${process.pid}.png`)
  writeFileSync(path, buf)
  const py = `
from PIL import Image
import json, sys
im = Image.open(${JSON.stringify(path)}).convert('RGB')
w, h = im.size
if w < 64 or h < 64:
    print(json.dumps({"err": f"shot too small {w}x{h}"})); raise SystemExit
px = im.load()
x0, x1 = int(w*0.08), int(w*0.88)
y0, y1 = int(h*0.08), int(h*0.88)
sx = max(1, (x1-x0)//64); sy = max(1, (y1-y0)//64)
n=sumY=sum2=dark=0
for y in range(y0, y1, sy):
  for x in range(x0, x1, sx):
    r,g,b = px[x,y]
    Y = 0.2126*r + 0.7152*g + 0.0722*b
    sumY += Y; sum2 += Y*Y; n += 1
    if Y < 40: dark += 1
mean = sumY/n; var = sum2/n - mean*mean
print(json.dumps({"w":w,"h":h,"mean":mean,"variance":var,"darkFrac":dark/n,"n":n}))
`
  try {
    const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' })
    if (r.status !== 0) return { err: `pil failed: ${r.stderr || r.stdout}` }
    return JSON.parse(r.stdout.trim().split('\n').pop())
  } finally {
    try { unlinkSync(path) } catch {}
  }
}


/** Fraction of gram rows (vertical) that have non-blank content in a left-band column strip. */
function samplePngHeight(buf) {
  const path = join(tmpdir(), `datum-cut-h-${process.pid}.png`)
  writeFileSync(path, buf)
  const py = `
from PIL import Image
import json
im = Image.open(${JSON.stringify(path)}).convert('RGB')
w, h = im.size
if w < 64 or h < 64:
    print(json.dumps({"err": f"shot too small {w}x{h}"})); raise SystemExit
px = im.load()
x0, x1 = int(w*0.05), int(w*0.35)
sy = max(1, h // 128)
filled = 0; rows = 0
for y in range(0, h, sy):
  rows += 1
  lit = 0; n = 0
  for x in range(x0, x1, max(1, (x1-x0)//32)):
    r,g,b = px[x,y]
    Y = 0.2126*r + 0.7152*g + 0.0722*b
    n += 1
    if Y > 18: lit += 1
  if n and lit / n > 0.08: filled += 1
print(json.dumps({"w":w,"h":h,"filledFrac":filled/rows,"filled":filled,"rows":rows}))
`
  try {
    const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' })
    if (r.status !== 0) return { err: `pil failed: ${r.stderr || r.stdout}` }
    return JSON.parse(r.stdout.trim().split('\n').pop())
  } finally {
    try { unlinkSync(path) } catch {}
  }
}

try {
  await startSrv()
  const browser = await webkit.launch()
  const specs = [
    ['iphone-portrait', devices['iPhone 15']],
    ['desktop', DESK],
  ]
  for (const [slug, ctxOpts] of specs) {
    const ctx = await browser.newContext(ctxOpts), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => { try { localStorage.removeItem('datum.band'); localStorage.removeItem('datum.gram') } catch {} })
    await page.goto(`http://127.0.0.1:${port}/datum/?autoplay&rate=16`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await dismissSplash(page)
    await page.locator('[data-testid=lofar]').waitFor({ timeout: 20000 })
    await page.waitForTimeout(1200)
    const F = (m) => `${slug}: ${m}`
    const tap = async (sel) => {
      const loc = page.locator(sel).first()
      await loc.scrollIntoViewIfNeeded()
      if (slug.startsWith('iphone')) await loc.tap()
      else await loc.click()
    }
    await tap('[data-testid=tab-cuts]')
    await page.locator('[data-testid=cut-picker]').waitFor({ timeout: 8000 })
    ok(await page.locator('[data-testid=cut-pick-1]').count() === 1, F('no cut 1'))
    const rowBb = await page.locator('[data-testid=cut-pick-1]').boundingBox()
    ok(rowBb && rowBb.height >= 44, F(`cut row < 44 ${JSON.stringify(rowBb)}`))
    await tap('[data-testid=cut-pick-1]')
    await page.locator('[data-testid=cut-bar]').waitFor({ timeout: 10000 })
    await page.locator('[data-testid=cut-gram]').waitFor({ timeout: 8000 })

    ok(await page.locator('[data-testid=cut-score]').count() === 1, F(`score count ${await page.locator('[data-testid=cut-score]').count()}`))
    const deck = page.locator('[data-testid=cut-deck-open]')
    ok(await deck.count() === 1, F('no ID Deck'))
    const titleBox = await page.locator('[data-testid=cuts-screen-nav] .nav-title').boundingBox()
    const deckBox = await deck.boundingBox()
    ok(titleBox && deckBox && deckBox.x >= titleBox.x + titleBox.width - 4, F(`ID Deck overlaps title ${JSON.stringify({ titleBox, deckBox })}`))

    const play = page.locator('[data-testid=cut-play]').first()
    if ((await play.getAttribute('aria-label')) !== 'Pause') await tap('[data-testid=cut-play]')
    await page.waitForTimeout(4500)
    const t0 = await page.locator('[data-testid=cut-time]').innerText()
    ok(/\d{2}:\d{2} \/ \d{2}:\d{2}/.test(t0), F(`bad cut time ${t0}`))
    const [mm] = t0.split('/')
    const parts = mm.trim().split(':').map(Number)
    const elapsed = parts[0] * 60 + parts[1]
    ok(elapsed >= 5, F(`playback too short ${t0}`))

    const gramBox = await page.locator('[data-testid=cut-gram]').boundingBox()
    ok(gramBox && gramBox.width >= 120 && gramBox.height >= 120, F(`cut-gram too small ${JSON.stringify(gramBox)}`))
    const canvasBox = await page.locator('[data-testid=cut-gram] canvas').boundingBox()
    ok(canvasBox && canvasBox.width >= 80 && canvasBox.height >= 80, F(`cut canvas too small ${JSON.stringify(canvasBox)}`))

    const shot = await page.locator('[data-testid=cut-gram]').screenshot()
    const g = samplePng(shot)
    ok(!g.err, F(`gram sample: ${g.err || JSON.stringify(g)}`))
    if (!g.err) {
      ok(g.mean < 80, F(`gram not dark (mean luminance ${g.mean.toFixed(1)})`))
      ok(g.variance > 20, F(`gram blank / no tonal variance (var ${g.variance.toFixed(1)})`))
      ok(g.darkFrac > 0.35, F(`gram too bright (darkFrac ${g.darkFrac.toFixed(2)})`))
      console.log(`${slug}: gram ${g.w}x${g.h} mean=${g.mean.toFixed(1)} var=${g.variance.toFixed(1)} dark=${g.darkFrac.toFixed(2)} · time ${t0.trim()}`)
    }

    // HIG3: scrubber seeks directly (~70%) — instant first paint, then full-height backfill.
    const scrub = page.locator('[data-testid=cut-scrubber]')
    const durAttr = await scrub.getAttribute('max')
    const dur = Number(durAttr)
    ok(Number.isFinite(dur) && dur > 60, F(`bad scrub max ${durAttr}`))
    const target = Math.floor(dur * 0.7)
    const tBefore = await page.locator('[data-testid=cut-time]').innerText()
    const seekStart = Date.now()
    await scrub.evaluate((el, v) => {
      const input = el
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, String(v))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, target)
    // Instant first paint: time readout reaches target without a multi-second fast-forward climb.
    await page.waitForFunction((tgt) => {
      const t = document.querySelector('[data-testid=cut-time]')?.textContent || ''
      const mm = t.split('/')[0]?.trim().split(':').map(Number)
      if (!mm || mm.length < 2 || mm.some((x) => !Number.isFinite(x))) return false
      const elapsed = mm[0] * 60 + mm[1]
      return elapsed >= tgt - 1 && elapsed <= tgt + 1
    }, target, { timeout: 3000 })
    const seekMs = Date.now() - seekStart
    ok(seekMs < 1500, F(`seek felt slow / restarted (${seekMs} ms) from ${tBefore}`))
    const tAfter = await page.locator('[data-testid=cut-time]').innerText()
    const [mm2] = tAfter.split('/')
    const parts2 = mm2.trim().split(':').map(Number)
    const elapsed2 = parts2[0] * 60 + parts2[1]
    ok(Math.abs(elapsed2 - target) <= 1, F(`time readout ${tAfter} != target ${target}`))
    ok(elapsed2 > dur * 0.5, F(`looks like restart after seek: ${tAfter}`))

    // Within 600 ms the backfill must populate ≥90% of the gram height (non-blank rows).
    // Wait (no screenshot) so the budget measures backfill, not PIL/screenshot overhead.
    const fillStart = Date.now()
    await page.waitForTimeout(520)
    const fillMs = Date.now() - fillStart
    const shotFill = await page.locator('[data-testid=cut-gram]').screenshot()
    const fill = samplePngHeight(shotFill)
    ok(!fill?.err, F(`height sample: ${fill?.err || JSON.stringify(fill)}`))
    ok(fill && fill.filledFrac >= 0.9, F(`seek gram height fill ${((fill && fill.filledFrac) || 0).toFixed(2)} < 0.90 after ${fillMs}ms`))
    ok(fillMs <= 600, F(`full-height backfill took ${fillMs}ms (>600)`))
    console.log(`${slug}: seek→${target}s firstPaint=${seekMs}ms fullFill=${fillMs}ms height=${(fill.filledFrac).toFixed(2)} · ${tAfter.trim()}`)

    // Review shots: scrub to ~42% (near CPA) at the default CUT view — no forced zoom/contrast.
    const shotTarget = Math.floor(dur * 0.42)
    await scrub.evaluate((el, v) => {
      const input = el
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, String(v))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, shotTarget)
    await page.waitForFunction((tgt) => {
      const t = document.querySelector('[data-testid=cut-time]')?.textContent || ''
      const mm = t.split('/')[0]?.trim().split(':').map(Number)
      if (!mm || mm.length < 2 || mm.some((x) => !Number.isFinite(x))) return false
      const elapsed = mm[0] * 60 + mm[1]
      return elapsed >= tgt - 1 && elapsed <= tgt + 1
    }, shotTarget, { timeout: 3000 })
    await page.waitForTimeout(520)
    const tShot = await page.locator('[data-testid=cut-time]').innerText()
    console.log(`${slug}: review scrub→${shotTarget}s · ${tShot.trim()}`)
    // Pause so the shot is mid-scrub, not scrolling.
    if ((await page.locator('[data-testid=cut-play]').getAttribute('aria-label')) === 'Pause') {
      await tap('[data-testid=cut-play]')
    }
    await page.waitForTimeout(150)

    const out = slug === 'iphone-portrait' ? 'iphone-portrait' : 'desktop'
    await page.screenshot({ path: `docs/m3-cuts-${out}.png`, fullPage: true })
    await page.screenshot({ path: `docs/m3-hig3-${out}.png`, fullPage: true })

    if (slug === 'desktop') {
      await tap('[data-testid=cut-deck-open]')
      await page.locator('[data-testid=cut-deck]').waitFor()
      await tap('[data-testid=cut-deck-card]')
      await page.waitForTimeout(200)
      ok(!(await page.locator('[data-testid=cut-submit]').isDisabled()), F('submit still disabled'))
      await tap('[data-testid=cut-submit]')
      await page.locator('[data-testid=cut-reveal]').waitFor({ timeout: 5000 })
      const banner = await page.locator('[data-testid=cut-reveal-banner]').innerText()
      ok(/CORRECT|WRONG/.test(banner), F(`reveal banner: ${banner}`))
      await tap('[data-testid=cut-reveal-close]')
      await page.waitForTimeout(300)
    }

    await tap('[data-testid=tab-live]')
    await page.waitForTimeout(1200)
    ok(await page.locator('[data-testid=workspace]').isVisible(), F('workspace not visible on Live'))
    ok(await page.locator('[data-testid=cut-bar]').count() === 0, F('cut bar still mounted after Live'))
    ok(await page.locator('[data-testid=lofar]').count() === 1, F('live gram missing after Live'))
    const scn = await page.locator('.nav-scn').first().innerText().catch(() => '')
    ok(!/cut:/i.test(scn), F(`still on cut scenario: ${scn}`))
    ok(errs.length === 0, F(`console errors: ${errs.slice(0, 3).join(' | ')}`))
    await ctx.close()
  }
  await browser.close()
} finally {
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}
if (fails.length) { console.error('FAIL\n' + fails.map((f) => ' - ' + f).join('\n')); process.exit(1) }
console.log('cuts-shot OK')
