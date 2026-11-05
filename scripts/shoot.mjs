// Smoke test + screenshot: serve dist via vite preview, autoplay at 16×, fail on any page/GL error (WebGL readback is blank without preserveDrawingBuffer, so tonals are checked by eye), save docs/m1.png.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = 4179
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const errors = []
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`http://localhost:${port}/sonar-sim/?autoplay&rate=16`)
  await page.waitForSelector('[data-testid=lofar]')
  await page.waitForTimeout(Number(process.env.SHOOT_MS ?? 20000))
  if (await page.locator('.gl-error').count()) errors.push(await page.locator('.gl-error').innerText())
  await page.screenshot({ path: 'docs/m1.png' })
  await browser.close()
  console.log(JSON.stringify({ errors }))
  if (errors.length) process.exitCode = 1
} finally { srv.kill() }
