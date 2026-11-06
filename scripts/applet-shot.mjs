// DIFAR wheel applet: open from the legend, exercise rotate / null / isolate / steps / look, screenshot. docs/m3-applet-*.png
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
const port = Number(process.env.PORT) || 4182
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()
  for (const [slug, dev] of [['ipad', 'iPad Pro 11 landscape'], ['iphone', 'iPhone 15']]) {
    const ctx = await browser.newContext({ ...devices[dev] }), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&gram=difar`)
    await page.waitForSelector('[data-testid=difar-legend]'); await page.waitForTimeout(3500)
    await page.locator('[data-testid=difar-legend]').tap()
    await page.waitForSelector('[data-testid=difar-applet]'); await page.waitForTimeout(300)
    await page.screenshot({ path: `docs/m3-applet-${slug}-open.png` })
    const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=difar-applet] button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length)
    ok(!small, `${slug}: ${small} applet targets < 44`)
    const wb = await page.locator('[data-testid=difar-applet-wheel]').boundingBox(), cx = wb.x + wb.width / 2, cy = wb.y + wb.height / 2
    // Drag from N to E: red follows to 090.
    const w = page.locator('[data-testid=difar-applet-wheel]')
    const ev = (t, x, y) => w.dispatchEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, button: 0, buttons: t === 'pointerup' ? 0 : 1 })
    const r = wb.width * 0.4
    await ev('pointerdown', cx, cy - r)
    for (let a = 5; a <= 90; a += 5) { const t = (a * Math.PI) / 180; await ev('pointermove', cx + r * Math.sin(t), cy - r * Math.cos(t)) }
    await ev('pointerup', cx + r, cy)
    const rot = await page.locator('[data-testid=difar-applet-rot]').innerText()
    ok(/^(08[5-9]|09[0-5])°$/.test(rot), `${slug}: drag rotate gave ${rot}`)
    // Tap the S sector (isolate) and the W sector (null).
    await page.locator('[data-testid=da-tool-isolate]').tap(); await page.touchscreen.tap(cx, cy + r)
    await page.locator('[data-testid=da-tool-null]').tap(); await page.touchscreen.tap(cx - r, cy)
    await page.locator('[data-testid=da-steps] button', { hasText: '8' }).tap()
    await page.waitForTimeout(200)
    const sum = await page.locator('.da-sum').innerText()
    ok(sum.includes('8 STEP') && sum.includes('ISO S') && sum.includes('NULL W'), `${slug}: summary ${sum}`)
    await page.screenshot({ path: `docs/m3-applet-${slug}-custom.png` })
    await page.locator('[data-testid=da-look] button', { hasText: 'Pastel' }).tap(); await page.waitForTimeout(150)
    await page.screenshot({ path: `docs/m3-applet-${slug}-pastel.png` })
    // Persist across reload.
    await page.locator('[data-testid=difar-applet-close]').tap()
    await page.reload(); await page.waitForSelector('[data-testid=difar-legend]')
    ok(/CUSTOM/.test(await page.locator('[data-testid=difar-legend]').innerText()), `${slug}: settings not persisted`)
    await page.waitForTimeout(2500); await page.screenshot({ path: `docs/m3-applet-${slug}-gram.png` })
    await page.locator('[data-testid=difar-legend]').tap(); await page.locator('[data-testid=da-reset]').tap()
    ok(/BRG = HUE/.test(await page.locator('[data-testid=difar-legend]').innerText()), `${slug}: reset failed`)
    ok(!errs.length, `${slug}: page errors ${errs.join(' | ')}`)
    await ctx.close(); console.log(slug, 'done')
  }
  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('applet smoke OK')
