// Touch smoke on Playwright WebKit (iOS Safari engine) for the three target device profiles.
// Checks: layout class, no page scroll, 44 pt targets, 16 px inputs, tap-select, HARM drag, pinch zoom,
// long-press crosshair, sheets / slide-over, WebGL context-loss recovery. Saves docs/m3-touch-<profile>.png.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'

const port = 4181
const PROFILES = [
  ['ipad-landscape', 'iPad Pro 11 landscape', 'wide'],
  ['iphone-portrait', 'iPhone 15', 'phonePortrait'],
  ['iphone-landscape', 'iPhone 15 landscape', 'phoneLandscape'],
]
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()
  for (const [slug, dev, want] of PROFILES) {
    const errs = []
    const ctx = await browser.newContext({ ...devices[dev] })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16`)
    await page.waitForSelector('[data-testid=lofar]')
    await page.waitForTimeout(4000)
    const F = (m) => `${slug}: ${m}`
    ok(await page.getAttribute('.app', 'data-layout') === want, F(`layout ${await page.getAttribute('.app', 'data-layout')} != ${want}`))
    const sc = await page.evaluate(() => ({ w: document.scrollingElement.scrollWidth, h: document.scrollingElement.scrollHeight, iw: innerWidth, ih: innerHeight }))
    ok(sc.w <= sc.iw + 1 && sc.h <= sc.ih + 1, F(`page scrolls ${JSON.stringify(sc)}`))
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) } }).filter((r) => r.w < 44 || r.h < 44))
    ok(!small.length, F(`targets < 44pt: ${JSON.stringify(small.slice(0, 6))}`))
    const box = await page.locator('[data-testid=lofar]').boundingBox()
    const pt = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
    // Tap selects a frequency.
    { const p = pt(0.4, 0.3); await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(150) }
    ok(await page.locator('.sel-marker').count() === 1, F('tap did not select'))
    // Synthetic touch pointers (Playwright's touchscreen only taps).
    const touch = (type, id, p) => page.locator('[data-testid=lofar]').dispatchEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: p.x, clientY: p.y, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
    // Long-press shows crosshair readout.
    { const p = pt(0.5, 0.5); await touch('pointerdown', 1, p); await page.waitForTimeout(650)
      ok(await page.locator('[data-testid=lofar-cross]').count() === 1, F('long-press: no crosshair readout')); await touch('pointerup', 1, p) }
    // Pinch: spread two fingers → narrower band in the readout.
    const span = async () => { const t = await page.locator('.panel-head .readout').first().innerText(); const m = t.match(/([\d.]+)–([\d.]+) HZ/); return m ? +m[2] - +m[1] : NaN }
    const s0 = await span()
    { const a = pt(0.45, 0.5), b = pt(0.55, 0.5); await touch('pointerdown', 1, a); await touch('pointerdown', 2, b)
      for (let k = 1; k <= 5; k++) { await touch('pointermove', 1, { x: a.x - k * 15, y: a.y }); await touch('pointermove', 2, { x: b.x + k * 15, y: b.y }) }
      await touch('pointerup', 1, a); await touch('pointerup', 2, b); await page.waitForTimeout(100) }
    const s1 = await span()
    ok(s1 < s0 * 0.8, F(`pinch did not zoom (${s0} → ${s1})`))
    // Double-tap resets the band.
    { const p = pt(0.6, 0.6); await page.touchscreen.tap(p.x, p.y); await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(150) }
    ok(await span() === s0, F(`double-tap did not reset (${await span()})`))
    // RES stepper / NB|BB from gramConfig.
    ok(/^RES 5 · 0\.5 Hz/.test(await page.locator('[data-testid=res-readout]').innerText()), F('RES: default readout'))
    const bbox = async (sel) => page.locator(sel).first().boundingBox()
    for (const sel of ['[data-testid=res-step] button', '[data-testid=filter-seg] button', '[data-testid=vernier]']) { const b = await bbox(sel); ok(b && b.height >= 44 && b.width >= 44, F(`RES: ${sel} under 44`)) }
    await page.locator('[data-testid=res-step] button').last().tap()
    await page.waitForFunction(() => /^RES 6 · 1 Hz/.test(document.querySelector('[data-testid=res-readout]')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => ok(false, F('RES: + did not step to RES 6')))
    await page.locator('[data-testid=filter-seg] button').last().tap()
    await page.waitForFunction(() => /· BB/.test(document.querySelector('[data-testid=gram-title]')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => ok(false, F('RES: BB did not apply')))
    await page.locator('[data-testid=filter-seg] button').first().tap(); await page.locator('[data-testid=res-step] button').first().tap()
    for (const sel of ['[data-testid=contrast-slider]', '[data-testid=contrast-reset]']) { const b = await bbox(sel); ok(b && b.height >= 44, F(`CONTRAST: ${sel} under 44`)) }
    await page.locator('[data-testid=contrast-slider]').fill('2')
    ok(/CON 2\.00×/.test(await page.locator('[data-testid=contrast-reset]').innerText()), F('CONTRAST: slider did not set 2.00×'))
    await page.locator('[data-testid=contrast-reset]').tap()
    ok(/CON 1\.00×/.test(await page.locator('[data-testid=contrast-reset]').innerText()), F('CONTRAST: reset did not return to 1.00×'))
    // HARM drag: tap HARM, drag on the gram, readout shows the fundamental.
    await page.getByRole('button', { name: 'HARM', exact: true }).evaluate((b) => b.scrollIntoView({ inline: 'center' }))
    await page.getByRole('button', { name: 'HARM', exact: true }).tap()
    { const a = pt(0.3, 0.4); await touch('pointerdown', 1, a); for (let k = 1; k <= 4; k++) await touch('pointermove', 1, { x: a.x + k * 10, y: a.y }); await touch('pointerup', 1, { x: a.x + 40, y: a.y }) }
    ok(/F0|Hz/i.test(await page.locator('[data-testid=harm-readout]').innerText().catch(() => '')), F('HARM drag: no readout'))
    await page.getByRole('button', { name: 'HARM', exact: true }).tap()
    // Phones: controls sheet opens and closes; landscape tactical slide-over.
    if (want !== 'wide') {
      await page.locator('[data-testid=menu-open]').tap(); await page.waitForTimeout(350)
      ok(await page.locator('[data-testid=menu-sheet]').isVisible(), F('menu sheet not visible'))
      const fs = await page.locator('[data-testid=menu-sheet] select').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
      ok(fs >= 16, F(`select font ${fs}px < 16`))
      await page.screenshot({ path: `docs/m3-touch-${slug}-sheet.png` })
      await page.getByRole('button', { name: 'Close Controls' }).tap(); await page.waitForTimeout(400)
      ok(await page.locator('[data-testid=menu-sheet]').count() === 0, F('menu sheet did not close'))
    }
    if (want === 'phoneLandscape') {
      await page.locator('[data-testid=tac-open]').tap(); await page.waitForTimeout(350)
      const tf = await page.locator('[data-testid=tac-panel]').evaluate((e) => getComputedStyle(e).transform)
      ok(tf === 'none', F(`tactical slide-over not open (${tf})`))
      await page.screenshot({ path: `docs/m3-touch-${slug}-tac.png` })
      await page.locator('.tac-scrim').tap({ position: { x: 20, y: 100 } }); await page.waitForTimeout(350)
    }
    // WebGL context loss without restore (iOS background): canvas must rebuild and keep drawing.
    const before = await page.locator('[data-testid=lofar]').elementHandle()
    await page.evaluate(() => document.querySelector('[data-testid=lofar]').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext())
    await page.waitForTimeout(1800)
    const same = await page.evaluate((el) => el.isConnected, before)
    ok(!same, F('lost context was not rebuilt'))
    ok(await page.evaluate(() => !document.querySelector('[data-testid=lofar]').getContext('webgl2').isContextLost()), F('rebuilt context is lost'))
    ok(!(await page.locator('.gl-error').count()), F('gl-error shown'))
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `docs/m3-touch-${slug}.png` })
    ok(!errs.length, F(`console errors: ${errs.slice(0, 3).join(' | ')}`))
    console.log(slug, 'done')
    await ctx.close()
  }
  await browser.close()
} finally { try { process.kill(-srv.pid) } catch { /* gone */ } }
if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1) }
console.log('touch smoke OK')
