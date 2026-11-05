// Smoke test + screenshot: serve dist via vite preview, autoplay at 16×, fail on any page/GL error (WebGL readback is blank without preserveDrawingBuffer, so tonals are checked by eye), save ${process.env.SHOT ?? "docs/m1.png"}.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = 4179
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const errors = []
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&palette=${process.env.PALETTE ?? "green"}`)
  await page.waitForSelector('[data-testid=lofar]')
  if (process.env.SCN) { await page.waitForTimeout(1500); await page.selectOption('[data-testid="scenario-select"]', process.env.SCN) }
  await page.waitForTimeout(Number(process.env.SHOOT_MS ?? 20000))
  if (await page.locator('.gl-error').count()) errors.push(await page.locator('.gl-error').innerText())
  if (process.env.DRAG) {
    // Place two manual bearing cursors (buoys 11 and 12) by dragging from each buoy; they should cross-fix.
    const box = await page.locator('[data-testid=tactical]').boundingBox()
    const m = 18000 / Math.min(box.width, box.height)
    const sx = (x) => box.x + box.width / 2 + x / m, sy = (y) => box.y + box.height / 2 - y / m
    for (const [bx, by, tx, ty] of [[-2000, 2000, 1500, 5500], [2000, 2000, -1000, 5000]]) {
      await page.mouse.move(sx(bx), sy(by)); await page.mouse.down()
      await page.mouse.move(sx((bx + tx) / 2), sy((by + ty) / 2), { steps: 5 }); await page.mouse.move(sx(tx), sy(ty), { steps: 5 }); await page.mouse.up()
    }
    await page.waitForTimeout(500)
  }
  if (process.env.CPA) {
    // Mark a short diagonal run of points on the LOFAR (UI path only; positions are not a real tonal).
    await page.getByRole('button', { name: 'CPA', exact: true }).click()
    const box = await page.locator('[data-testid=lofar]').boundingBox()
    for (let k = 0; k < 6; k++) await page.mouse.click(box.x + box.width * (0.3 + 0.01 * k), box.y + box.height * (0.05 + 0.03 * k))
    const t = await page.locator('[data-testid=cpa-readout]').innerText()
    if (!/CPA/.test(t)) errors.push('cpa readout missing')
    console.log('cpa:', t)
    await page.waitForTimeout(300)
  }
  if (process.env.LM) {
    await page.getByRole('button', { name: 'LM', exact: true }).click()
    const box = await page.locator('[data-testid=lofar]').boundingBox()
    const y = box.y + box.height * 0.1
    await page.mouse.move(box.x + box.width * 0.08, y); await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.05, y, { steps: 6 }); await page.mouse.up()
    const t = await page.locator('[data-testid=lm-readout]').innerText()
    if (!/RELATIVE/.test(t)) errors.push('lm readout should be relative with no basis: ' + t)
    console.log('lm:', t)
    await page.waitForTimeout(300)
  }
  if (process.env.HARM) {
    await page.click('button:has-text("HARM")')
    const c = await page.locator('[data-testid="lofar"]').boundingBox()
    await page.mouse.click(c.x + c.width * 0.072, c.y + c.height * 0.5)
    await page.click('button:has-text("CROSS")')
    await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.35)
    await page.waitForTimeout(300)
  }
  if (process.env.SETTINGS) {
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.locator('#traffic').fill('1')
    const t = await page.locator('[data-testid=traffic-label]').innerText()
    if (t !== 'Heavy') errors.push('traffic label ' + t)
    console.log('traffic:', t)
  }
  if (process.env.NEWSCN) {
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.waitForSelector('.modal')
  }
  await page.screenshot({ path: process.env.SHOT ?? 'docs/m1.png' })
  await browser.close()
  console.log(JSON.stringify({ errors }))
  if (errors.length) process.exitCode = 1
} finally { try { process.kill(-srv.pid) } catch { srv.kill() } }
