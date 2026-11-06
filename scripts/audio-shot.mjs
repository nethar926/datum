// Listen audio smoke: starts muted, unmute creates a running AudioContext, FOCUS merges into
// the top cursor readout (never covers newest gram rows), width/SHIFT live in a speaker menu,
// mute tears down, nav fits at 390×844. Port 4197.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const port = Number(process.env.PORT) || 4197
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

const overlaps = (a, b, pad = 0) => !(!a || !b
  || a.x + a.width + pad <= b.x || b.x + b.width + pad <= a.x
  || a.y + a.height + pad <= b.y || b.y + b.height + pad <= a.y)

const fullyIn = (box, vw, vh, inset = 0) => !!box
  && box.x >= -0.5 + inset
  && box.y >= -0.5 + inset
  && box.x + box.width <= vw + 0.5 - inset
  && box.y + box.height <= vh + 0.5 - inset

const longPress = async (page, loc) => {
  const box = await loc.boundingBox()
  if (!box) throw new Error('no box for long-press')
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector('[data-testid=listen-btn]')
    const opts = { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, buttons: 1 }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
  }, { x, y })
  await page.waitForTimeout(500)
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector('[data-testid=listen-btn]')
    const opts = { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, buttons: 0 }
    el.dispatchEvent(new PointerEvent('pointerup', opts))
  }, { x, y })
}

const VIEWS = [
  ['iphone-portrait', {
    ...devices['iPhone 15'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }],
  ['desktop', {
    viewport: { width: 1440, height: 900 },
    userAgent: devices['Desktop Safari'].userAgent,
    deviceScaleFactor: 1, isMobile: false, hasTouch: false,
  }],
]

await startSrv()
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
})
try {
  for (const [name, device] of VIEWS) {
    const touch = !!device.isMobile || !!device.hasTouch
    const vw = device.viewport.width, vh = device.viewport.height
    const ctx = await browser.newContext({ ...device })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForSelector('[data-testid=lofar]', { timeout: 30000 })
    await page.waitForTimeout(3500) // let gram rows fill so the shot shows data

    const press = (loc) => (touch ? loc.tap() : loc.click())
    const btn = page.locator('[data-testid=listen-btn]')
    ok(await btn.count() === 1, `${name}: listen button missing`)
    ok(await btn.getAttribute('aria-pressed') === 'false', `${name}: should start muted`)
    ok(await page.locator('[data-testid=listen-menu]').count() === 0, `${name}: menu closed at boot`)
    ok(await page.locator('[data-testid=listen-focus]').count() === 0, `${name}: no overlay FOCUS strip`)

    // Nav chrome: every nav button fully inside the viewport (esp. 390×844).
    const navBtns = page.locator('[data-testid=navbar] button, [data-testid=navbar] .listen-btn, [data-testid=listen-btn], [data-testid=play-btn]')
    const nNav = await page.locator('[data-testid=navbar] button').count()
    ok(nNav >= 4, `${name}: expected rate+play(+listen) buttons, got ${nNav}`)
    for (let i = 0; i < nNav; i++) {
      const b = await page.locator('[data-testid=navbar] button').nth(i).boundingBox()
      ok(fullyIn(b, vw, vh), `${name}: nav button ${i} clipped ${JSON.stringify(b)}`)
    }
    const listenBox = await btn.boundingBox()
    const playBox = await page.locator('[data-testid=play-btn]').boundingBox()
    ok(fullyIn(listenBox, vw, vh), `${name}: listen btn clipped`)
    ok(fullyIn(playBox, vw, vh), `${name}: play/pause clipped ${JSON.stringify(playBox)}`)
    if (touch) {
      // Subtitle dropped on phone so the trail fits.
      const sub = await page.locator('[data-testid=navbar] .nav-scn').count()
      ok(sub === 0, `${name}: Ridgeline subtitle should be hidden on phone`)
    }

    const bootState = await page.evaluate(() => {
      const eng = window.__datumListen
      return { running: !!eng?.isRunning, ctx: eng?.contextState ?? null }
    })
    ok(bootState.running === false && bootState.ctx === null, `${name}: no context at boot`)

    // Unmute
    await press(btn)
    await page.waitForTimeout(600)
    ok(await btn.getAttribute('aria-pressed') === 'true', `${name}: unmuted`)
    const hot = await page.evaluate(() => {
      const eng = window.__datumListen
      return { running: !!eng?.isRunning, ctx: eng?.contextState ?? null }
    })
    ok(hot.running && hot.ctx === 'running', `${name}: context running after unmute (got ${JSON.stringify(hot)})`)

    // Open FOCUS menu via long-press (does not leave an overlay on the gram).
    await longPress(page, btn)
    await page.waitForSelector('[data-testid=listen-menu]', { timeout: 4000 })
    ok(await page.locator('[data-testid=focus-width-10]').count() === 1, `${name}: width chips in menu`)
    await press(page.locator('[data-testid=focus-width-25]'))
    await press(page.locator('[data-testid=shift-up]'))
    ok(await page.locator('[data-testid=shift-up]').getAttribute('aria-checked') === 'true', `${name}: shift on`)
    // Dismiss menu
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid=listen-menu]', { state: 'detached', timeout: 3000 }).catch(() => null)
    ok(await page.locator('[data-testid=listen-menu]').count() === 0, `${name}: menu closed`)

    // Hover/tap gram → FOCUS merges into top cursor readout (not a bottom overlay).
    const gram = page.locator('[data-testid=lofar]')
    const gbox = await gram.boundingBox()
    ok(!!gbox, `${name}: gram box`)
    if (gbox) {
      const x = gbox.x + gbox.width * 0.35
      const y = gbox.y + gbox.height * 0.4 // mid gram, not newest band
      if (touch) await page.touchscreen.tap(x, y)
      else await page.mouse.move(x, y)
      await page.waitForTimeout(350)
      if (!touch) {
        const cur = page.locator('[data-testid=lofar-cursor]')
        ok(await cur.count() === 1, `${name}: cursor readout present`)
        const txt = ((await cur.textContent()) ?? '').trim()
        ok(/FOCUS ±\d+/.test(txt), `${name}: FOCUS merged into readout ("${txt}")`)
        const cbox = await cur.boundingBox()
        // Must not intersect the bottom 25% of the gram (newest rows, default dir).
        const newestBand = { x: gbox.x, y: gbox.y + gbox.height * 0.75, width: gbox.width, height: gbox.height * 0.25 }
        ok(cbox && !overlaps(cbox, newestBand, 0), `${name}: FOCUS/cursor readout intersects newest 25% of gram`)
        ok(cbox && cbox.y < gbox.y + gbox.height * 0.25, `${name}: readout should sit in top quarter`)
      }
      // No floating listen-focus overlay anywhere.
      ok(await page.locator('[data-testid=listen-focus]').count() === 0, `${name}: floating FOCUS overlay must not exist`)
      // Nothing with data-testid focus-capsule on the gram body.
      ok(await page.locator('[data-testid=focus-capsule]').count() === 0, `${name}: no separate focus-capsule on gram`)
    }

    // Mute tears down
    await press(btn)
    await page.waitForTimeout(400)
    ok(await btn.getAttribute('aria-pressed') === 'false', `${name}: muted again`)
    const cold = await page.evaluate(() => {
      const eng = window.__datumListen
      return { running: !!eng?.isRunning, ctx: eng?.contextState ?? null }
    })
    ok(!cold.running && cold.ctx === null, `${name}: torn down after mute`)

    // Re-unmute + open menu briefly then dismiss for a clean shot with visible gram + audio on.
    await press(btn)
    await page.waitForTimeout(500)
    if (gbox && !touch) {
      await page.mouse.move(gbox.x + gbox.width * 0.4, gbox.y + gbox.height * 0.35)
      await page.waitForTimeout(250)
    } else if (gbox && touch) {
      await page.touchscreen.tap(gbox.x + gbox.width * 0.4, gbox.y + gbox.height * 0.35)
      await page.waitForTimeout(250)
    }

    // Final nav clip check with audio on.
    const play2 = await page.locator('[data-testid=play-btn]').boundingBox()
    ok(fullyIn(play2, vw, vh), `${name}: play still fully in view with listen on`)

    const realErrs = errs.filter((e) => !/favicon|ResizeObserver|AudioContext/.test(e))
    ok(realErrs.length === 0, `${name}: page errors ${realErrs.slice(0, 3).join(' | ')}`)

    await page.screenshot({ path: `docs/m3-audio-${name}.png`, fullPage: false })
    await ctx.close()
  }
} finally {
  await browser.close()
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}

if (fails.length) {
  console.error('AUDIO SMOKE FAIL:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exit(1)
}
console.log('audio-shot OK → docs/m3-audio-iphone-portrait.png, docs/m3-audio-desktop.png')
