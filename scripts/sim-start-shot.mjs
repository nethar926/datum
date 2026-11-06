// SIM start: Random (difficulty + Diesel/Nuke/Any) by default, Advanced collapsed; start runs; prefs persist. docs/m3-simstart-*.png
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
const port = 4183
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
const openNew = async (page) => {
  if (await page.locator('[data-testid=menu-open]').isVisible()) { await page.locator('[data-testid=menu-open]').tap(); await page.waitForTimeout(250) }
  await page.locator('button:visible', { hasText: /^New$/ }).first().tap()
  await page.waitForSelector('[data-testid=sim-start]')
}
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()
  for (const [slug, dev] of [['ipad', 'iPad Pro 11 landscape'], ['iphone', 'iPhone 15']]) {
    const ctx = await browser.newContext({ ...devices[dev] }), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16`)
    await page.waitForSelector('[data-testid=lofar]'); await page.waitForTimeout(1500)
    await openNew(page)
    ok(await page.locator('[data-testid=ns-adv]').count() === 0, `${slug}: advanced open by default`)
    ok(await page.locator('[data-testid=ns-diff] button').count() === 3, `${slug}: not 3 difficulties`)
    const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=sim-start] button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length)
    ok(!small, `${slug}: ${small} targets < 44`)
    await page.waitForTimeout(250); await page.screenshot({ path: `docs/m3-simstart-${slug}-random.png` })
    await page.locator('[data-testid=ns-plant] button', { hasText: 'Nuke' }).tap()
    await page.locator('[data-testid=ns-diff] button', { hasText: 'Difficult' }).tap()
    ok(/NUKE/.test(await page.locator('[data-testid=ns-summary]').innerText()), `${slug}: summary not NUKE`)
    await page.locator('[data-testid=ns-advanced]').tap(); await page.waitForTimeout(250)
    ok(await page.locator('[data-testid=ns-adv]').count() === 1, `${slug}: advanced did not open`)
    await page.screenshot({ path: `docs/m3-simstart-${slug}-advanced.png` })
    await page.locator('[data-testid=ns-start]').tap(); await page.waitForTimeout(1500)
    ok(await page.locator('[data-testid=sim-start]').count() === 0, `${slug}: start did not close`)
    await page.reload(); await page.waitForSelector('[data-testid=lofar]'); await page.waitForTimeout(800)
    await openNew(page)
    ok(await page.locator('[data-testid=ns-plant] button[aria-pressed=true]').innerText() === 'Nuke', `${slug}: plant not persisted`)
    ok(await page.locator('[data-testid=ns-diff] button[aria-pressed=true]').innerText() === 'Difficult', `${slug}: diff not persisted`)
    ok(!errs.length, `${slug}: page errors ${errs.join(' | ')}`)
    await ctx.close(); console.log(slug, 'done')
  }
  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('sim-start smoke OK')
