// CUTDEMON smoke: brindleflux @ ~176 s, DEMON normalizeDemonRow + absolute 0..65.
// PORT=4211. OUT=/workspace/cutnorm-shots TAG=after|before
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4211
const out = process.env.OUT || '/workspace/cutnorm-shots'
const tag = process.env.TAG || 'after'
mkdirSync(out, { recursive: true })
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

const TARGET_S = 176
const SHAFT_HZ = 2.33
const DESK = { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }

function analyzePng(buf) {
  const path = join(tmpdir(), `cutdemon-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
  writeFileSync(path, buf)
  const py = `
from PIL import Image
import json
im = Image.open(${JSON.stringify(path)}).convert('RGB')
w, h = im.size
px = im.load()
y0, y1 = int(h*0.20), int(h*0.92)
left_cols=[]
for x in range(int(w*0.02), int(w*0.35), max(1,int(w*0.33)//40)):
  col=[]
  for y in range(y0,y1,max(1,(y1-y0)//64)):
    r,g,b=px[x,y]; col.append(0.2126*r+0.7152*g+0.0722*b)
  if col: left_cols.append(sum(col)/len(col))
mid_cols=[]
for x in range(int(w*0.55), int(w*0.95), max(1,int(w*0.4)//32)):
  col=[]
  for y in range(y0,y1,max(1,(y1-y0)//64)):
    r,g,b=px[x,y]; col.append(0.2126*r+0.7152*g+0.0722*b)
  if col: mid_cols.append(sum(col)/len(col))
left_cols.sort(); mid_cols.sort()
tonal_peak = left_cols[-1] if left_cols else 0
floor_med = mid_cols[len(mid_cols)//2] if mid_cols else 0
sat=n=0
for y in range(y0,y1,max(1,(y1-y0)//96)):
  for x in range(int(w*0.02), int(w*0.98), max(1,w//96)):
    r,g,b=px[x,y]; Y=0.2126*r+0.7152*g+0.0722*b
    n+=1
    if Y>=240: sat+=1
print(json.dumps({
  "w":w,"h":h,
  "tonalPeak":tonal_peak,"floorMed":floor_med,"tonalContrast":tonal_peak-floor_med,
  "satFrac": sat/n if n else 1,
}))
`
  try {
    const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' })
    if (r.status !== 0) return { err: r.stderr || r.stdout }
    return JSON.parse(r.stdout.trim().split('\n').pop())
  } finally {
    try { unlinkSync(path) } catch {}
  }
}

try {
  await startSrv()
  const browser = await webkit.launch()
  const ctx = await browser.newContext(DESK)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('datum.band')
      localStorage.removeItem('datum.gram')
      localStorage.setItem('datum.a2hs.hide', '1')
    } catch {}
  })
  await page.goto(`http://127.0.0.1:${port}/datum/?autoplay&rate=16&demon=1`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await dismissSplash(page)
  await page.locator('[data-testid=lofar]').waitFor({ timeout: 20000 })
  await page.waitForTimeout(400)

  const tap = async (sel) => {
    const loc = page.locator(sel).first()
    await loc.scrollIntoViewIfNeeded()
    await loc.click()
  }

  await tap('[data-testid=tab-cuts]')
  await page.locator('[data-testid=cut-picker]').waitFor({ timeout: 8000 })
  await tap('[data-testid=cut-pick-1]')
  await page.locator('[data-testid=cut-bar]').waitFor({ timeout: 10000 })
  await page.locator('[data-testid=cut-gram]').waitFor({ timeout: 8000 })
  const cutId = await page.locator('[data-testid=cuts-screen]').getAttribute('data-cut-id')
  ok(cutId === 'cut-brindleflux-snork', `expected brindleflux, got ${cutId}`)

  // Playback-fill from t≈0 (no seek): continuous play fills DEMON history.
  if ((await page.locator('[data-testid=cut-play]').getAttribute('aria-label')) !== 'Pause') await tap('[data-testid=cut-play]')
  const t0 = Date.now()
  await page.waitForFunction((tgt) => {
    const txt = document.querySelector('[data-testid=cut-time]')?.textContent || ''
    const mm = txt.split('/')[0]?.trim().split(':').map(Number)
    if (!mm || mm.length < 2 || mm.some((x) => !Number.isFinite(x))) return false
    return mm[0] * 60 + mm[1] >= tgt
  }, TARGET_S, { timeout: 60000 })
  console.log('reached target in', ((Date.now() - t0) / 1000).toFixed(1), 's wall')
  if ((await page.locator('[data-testid=cut-play]').getAttribute('aria-label')) === 'Pause') await tap('[data-testid=cut-play]')
  await page.waitForTimeout(400)

  const tNow = await page.locator('[data-testid=cut-time]').innerText()
  const mm = tNow.split('/')[0].trim().split(':').map(Number)
  const elapsedFinal = mm[0] * 60 + mm[1]
  ok(elapsedFinal >= TARGET_S - 1 && elapsedFinal <= TARGET_S + 40, `time ${tNow} not near ${TARGET_S}s`)
  console.log('cut time', tNow, 'elapsed', elapsedFinal)

  const panel = page.locator('[data-testid=demon-panel]')
  ok(await panel.count() === 1, 'demon-panel missing (need ?demon=1)')
  await panel.scrollIntoViewIfNeeded()
  const dCanvas = panel.locator('canvas').first()
  if (await dCanvas.count()) {
    const box = await dCanvas.boundingBox()
    if (box) {
      const x = Math.max(8, Math.min(box.width - 8, (SHAFT_HZ / 100) * box.width))
      await dCanvas.click({ position: { x, y: 40 } }).catch(() => {})
      await page.waitForTimeout(200)
    }
  }
  const demonBuf = await (await dCanvas.count() ? dCanvas : panel).screenshot()
  writeFileSync(join(out, `demon-only-${tag}.png`), demonBuf)
  writeFileSync(join(out, `demon-${tag}.png`), demonBuf) // compat alias
  await page.screenshot({ path: join(out, `demon-only-${tag}-full.png`) })
  const demon = analyzePng(demonBuf)
  console.log('DEMON metrics', demon)
  ok(!demon.err, `demon analyze: ${demon.err}`)
  if (tag === 'after') {
    ok(demon.satFrac < 0.05, `DEMON satFrac ${demon.satFrac?.toFixed(3)} >= 5%`)
    ok(demon.tonalContrast > 8, `DEMON tonal contrast ${demon.tonalContrast?.toFixed(1)} too low`)
    ok(demon.h > 80, `DEMON canvas too short (${demon.h}px)`)
  }

  const summary = {
    tag, cutId, time: tNow.trim(), targetS: TARGET_S, elapsed: elapsedFinal,
    expected: { demonShaft: 2.33, demonBlade: 11.67 },
    demon, errs: errs.slice(0, 5), fails: [...fails],
  }
  writeFileSync(join(out, `demon-only-${tag}.json`), JSON.stringify(summary, null, 2))
  ok(errs.length === 0, `console errors: ${errs.slice(0, 3).join(' | ')}`)
  await browser.close()
} finally {
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}
if (fails.length) { console.error('FAIL\n' + fails.map((m) => ' - ' + m).join('\n')); process.exit(1) }
console.log(`cutdemon-shot ${tag} ok`)
