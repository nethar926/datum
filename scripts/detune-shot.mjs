// Buoy detune smoke (WebKit): manual drop → green integrating → white working; DETUNE/TUNE;
// NO CH when the RX pool cannot cover the ask; status legend. Port 4195 (PORT env overrides).
// Run after `npm run build`. Saves docs/m3-detune-iphone-portrait.png and docs/m3-detune-desktop.png.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4195
const INTEGRATE_MS = 2500
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
const URL = `http://127.0.0.1:${port}/datum/?autoplay&rate=16&tab=live`
const SPAN_M = 18000

const VIEWS = [
  ['iphone-portrait', devices['iPhone 15']],
  ['desktop', {
    viewport: { width: 1440, height: 900 },
    userAgent: devices['Desktop Safari'].userAgent,
    deviceScaleFactor: 1, isMobile: false, hasTouch: false,
  }],
]

await startSrv()
const browser = await webkit.launch()
try {
  for (const [name, device] of VIEWS) {
    const touch = !!device.isMobile || !!device.hasTouch
    const ctx = await browser.newContext(device)
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await dismissSplash(page)
    await page.waitForSelector('[data-testid=tactical]', { timeout: 30000 })
    await page.waitForTimeout(3500)

    const plot = page.locator('[data-testid=tactical]')
    const press = (loc) => (touch ? loc.tap() : loc.click())
    const at = async (x, y) => {
      const b = await plot.boundingBox()
      const mpp = SPAN_M / Math.min(b.width, b.height)
      return [b.x + b.width / 2 + x / mpp, b.y + b.height / 2 - y / mpp]
    }
    const pointer = (type, [x, y]) => page.evaluate(([type, x, y]) => {
      document.querySelector('[data-testid=tactical]').dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true,
        bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
      }))
    }, [type, x, y])
    const tapPlot = async (wx, wy) => {
      const p = await at(wx, wy)
      if (!touch) { await page.mouse.click(...p); return }
      await pointer('pointerdown', p); await page.waitForTimeout(30); await pointer('pointerup', p)
    }

    // Layers sheet: buoy status legend.
    await press(page.locator('[data-testid=layers-open]'))
    await page.waitForSelector('[data-testid=layers-sheet]', { timeout: 8000 })
    ok(await page.locator('[data-testid=buoy-status-legend]').count() === 1, `${name}: status legend missing`)
    ok(await page.locator('[data-testid=buoy-status-legend] [data-health=working]').count() === 1, `${name}: working legend`)
    ok(await page.locator('[data-testid=buoy-status-legend] [data-health=detuned]').count() === 1, `${name}: detuned legend`)
    ok(await page.locator('[data-testid=buoy-status-legend] [data-health=dead]').count() === 1, `${name}: dead legend`)
    ok(await page.locator('[data-testid=buoy-status-legend] [data-health=error]').count() === 1, `${name}: error legend`)
    // Dismiss sheet (scrim / close).
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid=layers-sheet]', { state: 'detached', timeout: 5000 }).catch(() => null)
    await page.waitForTimeout(400)

    const countBefore = parseInt((await page.locator('[data-testid=buoy-count]').textContent()) ?? 'NaN')
    ok(countBefore >= 6, `${name}: field count ${countBefore}`)

    // Manual single drop → integrating (green).
    await press(page.locator('[data-testid=drop-palette] [data-pattern=single]'))
    await page.waitForTimeout(300)
    await tapPlot(-5500, 2500)
    await page.waitForSelector('[data-testid=drop-go]', { timeout: 5000 })
    await press(page.locator('[data-testid=drop-go]'))
    await page.waitForFunction((n) => {
      const v = parseInt(document.querySelector('[data-testid=buoy-count]')?.textContent ?? 'NaN')
      return v === n
    }, countBefore + 1, { timeout: 6000 })

    // Select the newest channel chip (last buoy-seg button).
    const chips = page.locator('[data-testid=buoy-seg] button')
    await press(chips.last())
    await page.waitForTimeout(200)
    // Integrating badge or data-health while delay runs.
    const health1 = await chips.last().getAttribute('data-health')
    ok(health1 === 'integrating' || await page.locator('[data-testid=integrating-badge]').count() > 0,
      `${name}: expected integrating after drop (health=${health1})`)
    console.log(`${name}: post-drop health=${health1}`)

    // Wait out the integration delay → working (white).
    await page.waitForTimeout(INTEGRATE_MS + 600)
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid=buoy-seg] button[aria-pressed=true]')
      return b?.getAttribute('data-health') === 'working'
    }, { timeout: 5000 }).catch(() => null)
    const health2 = await page.locator('[data-testid=buoy-seg] button[aria-pressed=true]').getAttribute('data-health')
    ok(health2 === 'working', `${name}: expected working after integrate (health=${health2})`)

    // DETUNE: open sheet (buttons present), drive the store (sheet medium detent clips actions on phone).
    await press(page.locator('[data-testid=buoy-info]'))
    await page.waitForSelector('[data-testid=buoy-sheet]', { timeout: 5000 })
    ok(await page.locator('[data-testid=buoy-detune]').count() === 1, `${name}: DETUNE button missing`)
    ok(await page.locator('[data-testid=buoy-tune]').count() === 1, `${name}: TUNE button missing`)
    // Medium detent: DETUNE/TUNE live in the sheet-actions row under the header — fully in viewport.
    {
      ok(await page.locator('[data-testid=sheet-actions]').count() === 1, `${name}: sheet-actions missing`)
      ok(await page.locator('[data-testid=buoy-actions]').count() === 1, `${name}: buoy-actions row missing`)
      // Wait for the sheet enter transition (transform) so medium-detent geometry is real.
      await page.waitForFunction(() => {
        const root = document.querySelector('.sheet-root')
        const btn = document.querySelector('[data-testid=buoy-detune]')
        if (!root?.classList.contains('open') || !btn) return false
        const r = btn.getBoundingClientRect()
        return r.y >= 0 && r.bottom <= window.innerHeight + 1
      }, { timeout: 5000 })
      const detent = await page.locator('[data-testid=buoy-sheet]').getAttribute('data-detent')
      ok(detent === 'medium', `${name}: expected medium detent, got ${detent}`)
      const vh = page.viewportSize()?.height ?? 0
      for (const id of ['buoy-detune', 'buoy-tune']) {
        const box = await page.locator(`[data-testid=${id}]`).boundingBox()
        ok(!!box, `${name}: ${id} no box`)
        if (box) {
          ok(box.y >= 0 && box.y + box.height <= vh + 1,
            `${name}: ${id} not in viewport at medium detent (y=${box.y}, h=${box.height}, vh=${vh})`)
          ok(box.height >= 40, `${name}: ${id} shorter than 44pt (${box.height})`)
        }
      }
    }
    const buoyId = await page.evaluate(() => {
      const d = window.__datumDetune
      const pressed = document.querySelector('[data-testid=buoy-seg] button[aria-pressed=true]')
      const label = pressed?.textContent ?? ''
      const n = parseInt(label, 10)
      // Prefer FE state matching the pressed chip channel; fall back to last integrating/working.
      const all = d.all()
      const hit = all.find((b) => b.channel === n) || all.find((b) => b.health === 'working' || b.health === 'integrating')
      if (!hit) return null
      d.detune(hit.buoyId)
      return hit.buoyId
    })
    ok(buoyId != null, `${name}: no buoy to detune`)
    await page.waitForTimeout(200)
    const stDet = await page.locator('[data-testid=buoy-status]').getAttribute('data-health')
    ok(stDet === 'detuned', `${name}: DETUNE → ${stDet}`)
    ok(await page.locator('[data-testid=buoy-fe-channel]').innerText() === '—', `${name}: channel not freed`)
    await page.locator('[data-testid=buoy-sheet] .sheet-close').click({ force: true })
    await page.waitForTimeout(350)
    ok(await page.locator('[data-testid=detuned-badge]').count() === 1, `${name}: DETUNED badge missing`)

    // TUNE re-acquires.
    await press(page.locator('[data-testid=buoy-info]'))
    await page.waitForSelector('[data-testid=buoy-sheet]', { timeout: 5000 })
    const tuneOk = await page.evaluate((id) => {
      const r = window.__datumDetune.tune(id)
      return r
    }, buoyId)
    ok(tuneOk?.ok === true, `${name}: TUNE failed ${JSON.stringify(tuneOk)}`)
    await page.waitForTimeout(200)
    const stTune = await page.locator('[data-testid=buoy-status]').getAttribute('data-health')
    ok(stTune === 'integrating' || stTune === 'working', `${name}: TUNE → ${stTune}`)
    await page.locator('[data-testid=buoy-sheet] .sheet-close').click({ force: true })
    await page.waitForTimeout(INTEGRATE_MS + 500)

    // NO CH: ask for more channels than the free pool.
    const noCh = await page.evaluate(() => {
      const d = window.__datumDetune
      if (!d) return 'no-store'
      d.allocateForDrop(99)
      return d.noCh
    })
    ok(noCh === 'NO CH', `${name}: allocateForDrop did not set NO CH (${noCh})`)
    await page.waitForTimeout(200)
    const toast = await page.locator('[data-testid=drop-hint]').innerText().catch(() => '')
    const chip = await page.locator('[data-testid=noch-chip]').count()
    ok(/NO CH/.test(toast) || chip > 0, `${name}: NO CH not shown (toast="${toast}", chip=${chip})`)

    // Colourful shot: force error + dead on two earlier buoys for the legend-in-situ look.
    await page.evaluate(() => {
      const d = window.__datumDetune
      const all = d?.all?.() ?? []
      if (all[0]) d.setHealth(all[0].buoyId, 'error')
      if (all[1]) d.setHealth(all[1].buoyId, 'dead')
      // Leave one detuned for green on the plot.
      if (all[2]) d.detune(all[2].buoyId)
    })
    await page.waitForTimeout(300)

    // Plot tab for a clean tactical shot (phone).
    if (name === 'iphone-portrait') {
      await page.getByRole('tab', { name: 'Plot' }).click()
      await page.waitForTimeout(700)
    }
    await page.screenshot({ path: `docs/m3-detune-${name === 'iphone-portrait' ? 'iphone-portrait' : 'desktop'}.png` })
    console.log('shot', name)

    ok(!errs.length, `${name}: page errors ${errs.join(' | ')}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}
if (fails.length) { console.error('FAILS\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('detune-shot OK')
