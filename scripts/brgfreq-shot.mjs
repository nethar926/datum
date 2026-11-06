// m3-fe-brg-freq smoke (WebKit): B sends DIFAR bearing at hovered gram frequency;
// phone BRG arms pick-freq then gram tap sends. Port 4189. Saves docs/m3-brgfreq-*.png.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'

const port = 4189
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()

  const waitBrg = async (page, ms = 2500) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const n = await page.locator('[data-testid=brg-readout]').count()
      if (n) {
        const t = await page.locator('[data-testid=brg-readout]').innerText()
        if (t) return t
      }
      await page.waitForTimeout(100)
    }
    const n = await page.locator('[data-testid=brg-readout]').count()
    return n ? await page.locator('[data-testid=brg-readout]').innerText() : ''
  }

  // ---- Desktop / iPad: hover gram + B ----
  {
    const slug = 'ipad'
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] })
    const page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => { try { localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' })); localStorage.removeItem('datum.band') } catch {} })
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=5`)
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(8000)
    const F = (m) => `${slug}: ${m}`

    // Prefer a DIFAR buoy channel (label ends with D).
    const buoyBtns = page.locator('[aria-label="Buoy channel"] button')
    const n = await buoyBtns.count()
    let pickedDifar = false
    for (let i = 0; i < n; i++) {
      const t = (await buoyBtns.nth(i).innerText()).trim()
      if (/D$/.test(t)) { await buoyBtns.nth(i).click(); pickedDifar = true; break }
    }
    ok(pickedDifar || n > 0, F('no buoy channel buttons'))
    await page.waitForTimeout(1500)

    const box = await cv.boundingBox()
    await page.screenshot({ path: `docs/m3-brgfreq-${slug}-before.png` })
    // Hover mid-gram (likely a tonal region after warm-up).
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35)
    await page.waitForTimeout(200)
    await page.keyboard.press('b')
    const hud = await waitBrg(page)
    console.log(slug, 'hud after hover+B:', hud)
    ok(/BRG \d{3}° @/.test(hud) || /No bearing/.test(hud), F(`no BRG HUD after hover+B (${hud})`))
    // If we got a real bearing, BRG should not stay armed (sent immediately).
    if (/BRG \d{3}° @/.test(hud)) {
      ok(await page.locator('[data-testid=brg-btn]').getAttribute('aria-pressed') === 'false', F('BRG still armed after hover send'))
      const tac = page.locator('[data-testid=tactical]')
      ok(await tac.getAttribute('data-arm') === 'idle', F('tactical still armed after hover send'))
    }
    await page.screenshot({ path: `docs/m3-brgfreq-${slug}-hover-b.png` })

    // Off-gram B still arms tactical.
    const tac = page.locator('[data-testid=tactical]')
    const tb = await tac.boundingBox()
    await page.mouse.move(tb.x + tb.width * 0.15, tb.y + tb.height * 0.15)
    await page.waitForTimeout(100)
    await page.keyboard.press('b')
    await page.waitForTimeout(200)
    ok(await page.locator('[data-testid=brg-btn]').getAttribute('aria-pressed') === 'true', F('off-gram B did not arm'))
    const phase = await tac.getAttribute('data-arm')
    ok(phase === 'aim' || phase === 'pick-buoy', F(`off-gram B phase ${phase}`))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    ok(await tac.getAttribute('data-arm') === 'idle', F('Esc did not cancel'))
    await page.screenshot({ path: `docs/m3-brgfreq-${slug}-offgram-arm.png` })

    ok(!errs.length, F(`page errors ${errs.join(' | ')}`))
    await ctx.close(); console.log(slug, 'done')
  }

  // ---- Phone: BRG → tap gram ----
  {
    const slug = 'iphone'
    const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'] })
    const page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => { try { localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' })); localStorage.removeItem('datum.band') } catch {} })
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=5`)
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(8000)
    const F = (m) => `${slug}: ${m}`

    // Ensure a DIFAR is selected if possible.
    const buoyBtns = page.locator('[aria-label="Buoy channel"] button')
    const n = await buoyBtns.count()
    for (let i = 0; i < n; i++) {
      const t = (await buoyBtns.nth(i).innerText()).trim()
      if (/D$/.test(t)) { await buoyBtns.nth(i).tap(); break }
    }
    await page.waitForTimeout(1200)

    // Open tac to reach BRG, arm, then close so gram is tappable.
    const tacOpen = page.locator('[data-testid=tac-open]')
    if (await tacOpen.count()) { await tacOpen.tap(); await page.waitForTimeout(400) }
    const brg = page.locator('[data-testid=brg-btn]')
    ok(await brg.isVisible(), F('BRG not visible'))
    const bb = await brg.boundingBox()
    ok(bb && bb.height >= 44 && bb.width >= 44, F(`BRG under 44`))
    await brg.tap(); await page.waitForTimeout(200)
    ok(await brg.getAttribute('aria-pressed') === 'true', F('BRG did not arm'))
    const tac = page.locator('[data-testid=tactical]')
    const phase = await tac.getAttribute('data-arm')
    console.log(slug, 'phase after BRG', phase)
    ok(phase === 'pick-freq' || phase === 'pick-buoy' || phase === 'aim', F(`unexpected phase ${phase}`))
    await page.screenshot({ path: `docs/m3-brgfreq-${slug}-armed.png` })

    // Close tactical overlay.
    if (await page.locator('[data-testid=tac-panel].open').count()) {
      const close = page.locator('[data-testid=tac-panel] button[aria-label="Close tactical"]')
      if (await close.count()) await close.tap()
      else await page.locator('.tac-scrim.open').click({ force: true }).catch(() => {})
      await page.waitForTimeout(400)
    }
    // Still armed after closing tac.
    ok(await brg.getAttribute('aria-pressed') === 'true', F('lost arm after closing tac'))

    const box = await cv.boundingBox()
    await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.35)
    const hud = await waitBrg(page)
    console.log(slug, 'hud after gram tap:', hud)
    ok(/BRG \d{3}° @/.test(hud) || /No bearing/.test(hud), F(`no BRG HUD after gram tap (${hud})`))
    if (/BRG \d{3}° @/.test(hud)) {
      ok(await brg.getAttribute('aria-pressed') === 'false', F('still armed after gram send'))
    }
    await page.screenshot({ path: `docs/m3-brgfreq-${slug}-gram-tap.png` })

    ok(!errs.length, F(`page errors ${errs.join(' | ')}`))
    await ctx.close(); console.log(slug, 'done')
  }

  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('brgfreq smoke OK')
