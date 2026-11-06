// HIG micro-push 1: selected-Hz marker label must not intersect the top-left
// cursor readout (incl. FOCUS suffix) at portrait, landscape, and desktop.
// Never covers newest gram rows (bottom 25% by default). Port 4199.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4199
mkdirSync('docs', { recursive: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }

const overlaps = (a, b, pad = 0) => !(!a || !b
  || a.x + a.width + pad <= b.x || b.x + b.width + pad <= a.x
  || a.y + a.height + pad <= b.y || b.y + b.height + pad <= a.y)

let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore', detached: true,
  })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview on ${port} not ready`)
}

const URL = `http://127.0.0.1:${port}/datum/?autoplay&rate=16&tab=live`

const VIEWS = [
  ['iphone-portrait', {
    ...devices['iPhone 15'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }],
  ['iphone-landscape', {
    ...devices['iPhone 15 landscape'],
  }],
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
    const vw = device.viewport.width, vh = device.viewport.height
    const ctx = await browser.newContext({ ...device })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => {
      try {
        localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' }))
        localStorage.removeItem('datum.band')
        // Force A2HS card off so splash is one tap.
        localStorage.setItem('datum.a2hs.hide', '1')
      } catch {}
    })
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await dismissSplash(page)
    await page.waitForSelector('[data-testid=lofar]', { timeout: 30000 })
    await page.waitForTimeout(3500)

    const F = (m) => `${name}: ${m}`
    const press = (loc) => (touch ? loc.tap() : loc.click())

    // Unmute so FOCUS merges into the readout (harder collision case).
    const listen = page.locator('[data-testid=listen-btn]')
    if (await listen.count()) {
      await press(listen)
      await page.waitForTimeout(400)
    }

    const gram = page.locator('[data-testid=lofar]')
    const gbox = await gram.boundingBox()
    ok(!!gbox, F('gram missing'))
    if (!gbox) { await ctx.close(); continue }

    // Select a frequency near the left (under/near the readout).
    const sx = gbox.x + Math.min(72, gbox.width * 0.12)
    const sy = gbox.y + gbox.height * 0.4
    if (touch) await page.touchscreen.tap(sx, sy)
    else await page.mouse.click(sx, sy)
    await page.waitForTimeout(300)

    const marker = page.locator('[data-testid=lofar-sel-marker]')
    const label = page.locator('[data-testid=lofar-sel-label]')
    ok(await marker.count() === 1, F('sel-marker missing after tap near readout'))
    ok(await label.count() === 1, F('sel-label missing'))

    // Keep the top-left cursor readout visible so we assert against the real collision case.
    // Desktop: mouse hover. Touch: dispatch a mouse move (WebKit still updates cursor state).
    await page.mouse.move(sx + 10, sy)
    await page.waitForTimeout(350)
    // Second tick lets the measured-readout layout effect re-place the label.
    await page.mouse.move(sx + 12, sy)
    await page.waitForTimeout(200)

    const cursor = page.locator('[data-testid=lofar-cursor]')
    ok(await cursor.count() === 1, F('cursor readout missing after hover (needed for collision assert)'))

    const lbox = await label.boundingBox()
    ok(!!lbox, F('sel-label has no box'))
    const cbox = await cursor.boundingBox()
    ok(!!cbox, F('cursor readout has no box'))
    const side = await label.getAttribute('data-side')
    const txt = ((await cursor.textContent()) ?? '').trim()
    ok(txt.length > 0, F('empty cursor readout'))
    ok(cbox && lbox && !overlaps(cbox, lbox, 2), F(`sel-label intersects readout side=${side} ${JSON.stringify({ cbox, lbox, txt })}`))
    // Prefer a dropped/flipped label when the marker is under the left chrome.
    if (lbox && cbox && lbox.x < cbox.x + cbox.width + 40) {
      ok(lbox.y >= cbox.y + cbox.height - 1 || side === 'left', F(`near-readout label should drop or flip (side=${side}, ly=${lbox.y}, cy=${cbox.y}+${cbox.height})`))
    }

    // Never over newest rows (bottom 25%).
    const newestBand = { x: gbox.x, y: gbox.y + gbox.height * 0.75, width: gbox.width, height: gbox.height * 0.25 }
    ok(lbox && !overlaps(lbox, newestBand, 0), F('sel-label covers newest 25% of gram'))
    ok(lbox && lbox.y < gbox.y + gbox.height * 0.25, F('sel-label should sit in top quarter'))

    // Label fully inside the gram frame (allow 1 px raster slop).
    ok(lbox && lbox.x >= gbox.x - 1 && lbox.x + lbox.width <= gbox.x + gbox.width + 1, F(`sel-label clipped horizontally ${JSON.stringify(lbox)}`))

    const realErrs = errs.filter((e) => !/favicon|ResizeObserver|AudioContext/.test(e))
    ok(realErrs.length === 0, F(`page errors ${realErrs.slice(0, 3).join(' | ')}`))

    await page.screenshot({ path: `docs/m3-hig1-${name}.png`, fullPage: false })
    console.log(name, `vw=${vw}x${vh}`, `side=${side}`, `label=${lbox && `${Math.round(lbox.x)},${Math.round(lbox.y)} ${Math.round(lbox.width)}x${Math.round(lbox.height)}`}`, `cursor=${cbox && `${Math.round(cbox.x)},${Math.round(cbox.y)} ${Math.round(cbox.width)}x${Math.round(cbox.height)}`}`, `txt=${JSON.stringify(txt)}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}

if (fails.length) {
  console.error('FAIL', fails.length)
  for (const f of fails) console.error(' -', f)
  process.exit(1)
}
console.log('ok', VIEWS.length, 'views')
