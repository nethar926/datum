// m3-fe-center smoke (WebKit): center-on-frequency + manual bearing arm.
// Covers: freq-axis tap → CTR, CENTER button, desktop C key, no gram wipe on center,
// desktop B arm→aim, phone BRG arm→aim, 44 px targets, no console errors.
// Mutual exclusion with drop arm is covered lightly (B disarms drop).
// Run after `npm run build`. Saves docs/m3-center-*.png. Port 4187.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4187
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
const LIT = 6
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()

  const litOf = async (page, cv) => {
    const png = (await cv.screenshot()).toString('base64')
    return page.evaluate(async ([b64, LIT]) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let rows = 0
      for (let y = 0; y < c.height; y++) {
        let n = 0
        for (let x = 0, i = y * c.width * 4; x < c.width; x++, i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > LIT) n++
        if (n >= c.width * 0.02) rows++
      }
      return rows / c.height
    }, [png, LIT])
  }
  const ctrText = async (page) => {
    const n = await page.locator('[data-testid=ctr-readout]').count()
    if (!n) return ''
    return page.locator('[data-testid=ctr-readout]').innerText()
  }
  const waitCtr = async (page, ms = 2000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const s = await ctrText(page)
      if (/CTR /.test(s)) return s
      await page.waitForTimeout(100)
    }
    return await ctrText(page)
  }

  // ---- Desktop / iPad ----
  {
    const slug = 'ipad'
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] })
    const page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => { try { localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' })); localStorage.removeItem('datum.band') } catch {} })
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=5`)
    await dismissSplash(page)
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(7000)
    const F = (m) => `${slug}: ${m}`
    const lit0 = await litOf(page, cv)
    ok(lit0 > 0.02, F(`gram not lit before center (${lit0})`))
    await page.screenshot({ path: `docs/m3-center-${slug}-before.png` })

    const box = await cv.boundingBox()
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4)
    await page.waitForTimeout(200)
    ok(await page.locator('.sel-marker').count() === 1, F('tap did not select a line'))
    const centerBtn = page.locator('[data-testid=center-btn]')
    ok(await centerBtn.isVisible(), F('CENTER button not visible with selection'))
    const cb = await centerBtn.boundingBox()
    ok(cb && cb.height >= 44 && cb.width >= 44, F(`CENTER under 44 (${cb && Math.round(cb.width)}x${Math.round(cb.height)})`))
    await centerBtn.click()
    const ctr1 = await waitCtr(page)
    ok(/CTR /.test(ctr1), F(`CTR not shown after CENTER (${ctr1})`))
    await page.screenshot({ path: `docs/m3-center-${slug}-center-btn.png` })
    const lit1 = await litOf(page, cv)
    ok(lit1 > lit0 * 0.4, F(`gram wiped after CENTER (${lit0} → ${lit1})`))

    const axis = page.locator('[data-testid=lofar-freq-axis]')
    ok(await axis.count() === 1, F('freq axis missing'))
    const ab = await axis.boundingBox()
    ok(ab && ab.height >= 44, F(`axis height ${ab && ab.height}`))
    await axis.click({ position: { x: ab.width * 0.7, y: ab.height * 0.5 } })
    const ctr2 = await waitCtr(page)
    ok(/CTR /.test(ctr2), F(`axis tap: no CTR (${ctr2})`))
    const lit2 = await litOf(page, cv)
    ok(lit2 > lit0 * 0.4, F(`gram wiped after axis tap (${lit0} → ${lit2})`))
    await page.screenshot({ path: `docs/m3-center-${slug}-axis.png` })

    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5)
    await page.waitForTimeout(100)
    await page.keyboard.press('c')
    const ctr3 = await waitCtr(page)
    ok(/CTR /.test(ctr3), F(`C key: no CTR (${ctr3})`))
    await page.screenshot({ path: `docs/m3-center-${slug}-key-c.png` })

    ok(await page.locator('[data-testid=hz-field]').count() === 1, F('hz field missing on iPad'))

    // Leave the gram so B arms the tactical two-tap flow (hover+B is covered by brgfreq-shot).
    const tacPre = page.locator('[data-testid=tactical]')
    const tpb = await tacPre.boundingBox()
    await page.mouse.move(tpb.x + tpb.width * 0.2, tpb.y + tpb.height * 0.2)
    await page.waitForTimeout(100)

    const brg = page.locator('[data-testid=brg-btn]')
    ok(await brg.count() === 1, F('BRG missing'))
    const bb = await brg.boundingBox()
    ok(bb && bb.height >= 44 && bb.width >= 44, F(`BRG under 44`))
    // Arm a drop pattern first, then B should disarm it.
    const lineBtn = page.locator('[data-testid=drop-bar] button', { hasText: /Line/i }).first()
    if (await lineBtn.count()) {
      await lineBtn.click(); await page.waitForTimeout(150)
      ok(await page.locator('[data-testid=tactical]').getAttribute('data-arm') === 'drop', F('drop did not arm'))
    }
    await page.keyboard.press('b')
    await page.waitForTimeout(200)
    ok(await brg.getAttribute('aria-pressed') === 'true', F('B did not arm BRG'))
    const tac = page.locator('[data-testid=tactical]')
    const phase = await tac.getAttribute('data-arm')
    ok(phase === 'aim' || phase === 'pick-buoy', F(`plot not bearing-armed after B (got ${phase})`))
    console.log(`${slug}: arm phase after B = ${phase}`)
    await page.screenshot({ path: `docs/m3-center-${slug}-brg-armed.png` })

    const tb = await tac.boundingBox()
    if (phase === 'pick-buoy') {
      let picked = false
      for (const [fx, fy] of [[0.5, 0.55], [0.45, 0.5], [0.55, 0.5], [0.4, 0.6], [0.6, 0.45], [0.35, 0.45], [0.65, 0.55]]) {
        await page.mouse.click(tb.x + tb.width * fx, tb.y + tb.height * fy)
        await page.waitForTimeout(150)
        if (await tac.getAttribute('data-arm') === 'aim') { picked = true; break }
      }
      ok(picked, F('could not pick a DIFAR buoy while armed'))
    }
    ok(await tac.getAttribute('data-arm') === 'aim', F(`expected aim, got ${await tac.getAttribute('data-arm')}`))
    await page.mouse.click(tb.x + tb.width * 0.8, tb.y + tb.height * 0.2)
    await page.waitForTimeout(300)
    ok(await tac.getAttribute('data-arm') === 'idle', F('aim tap did not disarm'))
    ok(await brg.getAttribute('aria-pressed') === 'false', F('BRG still pressed after aim'))
    await page.screenshot({ path: `docs/m3-center-${slug}-brg-set.png` })

    await page.keyboard.press('b'); await page.waitForTimeout(100)
    await page.keyboard.press('Escape'); await page.waitForTimeout(100)
    ok(await tac.getAttribute('data-arm') === 'idle', F('Esc did not cancel arm'))

    ok(!errs.length, F(`page errors ${errs.join(' | ')}`))
    console.log(slug, 'lit', lit0.toFixed(2), '→', lit2.toFixed(2))
    await ctx.close(); console.log(slug, 'done')
  }

  // ---- Phone ----
  {
    const slug = 'iphone'
    const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'] })
    const page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => { try { localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' })); localStorage.removeItem('datum.band') } catch {} })
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=5`)
    await dismissSplash(page)
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(7000)
    const F = (m) => `${slug}: ${m}`
    const tacOpen = page.locator('[data-testid=tac-open]')
    if (await tacOpen.count()) { await tacOpen.tap(); await page.waitForTimeout(400) }
    const brg = page.locator('[data-testid=brg-btn]')
    ok(await brg.isVisible(), F('BRG not visible on phone'))
    const bb = await brg.boundingBox()
    ok(bb && bb.height >= 44 && bb.width >= 44, F(`phone BRG under 44 (${bb && Math.round(bb.width)}x${Math.round(bb.height)})`))
    ok(await page.locator('[data-testid=hz-field]').count() === 0, F('hz field should be hidden on phone'))

    await brg.tap(); await page.waitForTimeout(200)
    ok(await brg.getAttribute('aria-pressed') === 'true', F('BRG tap did not arm'))
    const tac = page.locator('[data-testid=tactical]')
    const tb = await tac.boundingBox()
    let phase = await tac.getAttribute('data-arm')
    console.log(`${slug}: arm phase after BRG = ${phase}`)
    // Phone BRG arms pick-freq (gram tap) when a DIFAR is selected; pick-buoy otherwise.
    ok(phase === 'pick-freq' || phase === 'pick-buoy' || phase === 'aim', F(`phone unexpected arm ${phase}`))
    if (phase === 'pick-freq' || phase === 'pick-buoy') {
      let picked = false
      for (const [fx, fy] of [[0.5, 0.35], [0.4, 0.25], [0.6, 0.3], [0.3, 0.25], [0.7, 0.25], [0.5, 0.2], [0.45, 0.4], [0.55, 0.4]]) {
        await page.touchscreen.tap(tb.x + tb.width * fx, tb.y + tb.height * fy)
        await page.waitForTimeout(150)
        if (await tac.getAttribute('data-arm') === 'aim') { picked = true; break }
      }
      ok(picked, F('phone: could not pick DIFAR buoy from pick-freq/pick-buoy'))
    }
    ok(await tac.getAttribute('data-arm') === 'aim', F(`phone expected aim, got ${await tac.getAttribute('data-arm')}`))
    await page.touchscreen.tap(tb.x + tb.width * 0.8, tb.y + tb.height * 0.2)
    await page.waitForTimeout(300)
    ok(await tac.getAttribute('data-arm') === 'idle', F('phone aim did not disarm'))
    await page.screenshot({ path: `docs/m3-center-${slug}-brg.png` })

    if (await page.locator('[data-testid=tac-panel].open').count()) {
      // Close via the panel ✕ (tac-open sits under the slide-over and is intercepted).
      const close = page.locator('[data-testid=tac-panel] button[aria-label="Close tactical"]')
      if (await close.count()) await close.tap()
      else await page.locator('.tac-scrim.open').click({ force: true }).catch(() => {})
      await page.waitForTimeout(400)
    }
    const lit0 = await litOf(page, cv)
    const box = await cv.boundingBox()
    await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.4)
    await page.waitForTimeout(250)
    if (await page.locator('[data-testid=center-btn]').count()) {
      const cbb = await page.locator('[data-testid=center-btn]').boundingBox()
      ok(cbb && cbb.height >= 44 && cbb.width >= 44, F('phone CENTER under 44'))
      await page.locator('[data-testid=center-btn]').tap()
      ok(/CTR /.test(await waitCtr(page)), F(`phone CENTER: no CTR (${await ctrText(page)})`))
    }
    const axis = page.locator('[data-testid=lofar-freq-axis]')
    const ab = await axis.boundingBox()
    ok(ab && ab.height >= 44, F(`phone axis height ${ab && ab.height} (want ≥44)`))
    await axis.click({ position: { x: ab.width * 0.6, y: ab.height * 0.5 }, force: true })
    ok(/CTR /.test(await waitCtr(page)), F(`phone axis: no CTR (${await ctrText(page)})`))
    const lit1 = await litOf(page, cv)
    ok(lit1 > lit0 * 0.4 || lit1 > 0.02, F(`phone gram wiped (${lit0} → ${lit1})`))
    await page.screenshot({ path: `docs/m3-center-${slug}-axis.png` })

    const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=center-btn], [data-testid=brg-btn], [data-testid=res-step] button, [data-testid=filter-seg] button, [data-testid=vernier]')]
      .filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || '').trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) } })
      .filter((r) => r.w < 44 || r.h < 44))
    ok(!small.length, F(`targets < 44: ${JSON.stringify(small.slice(0, 8))}`))

    ok(!errs.length, F(`page errors ${errs.join(' | ')}`))
    await ctx.close(); console.log(slug, 'done')
  }

  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('center smoke OK')
