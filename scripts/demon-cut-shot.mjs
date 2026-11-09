
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = 4223
const out = '/workspace/demon-live-shots'
mkdirSync(out, { recursive: true })
let srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true })
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 200))
}
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(`http://127.0.0.1:${port}/datum/?demon=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await dismissSplash(page)
await page.waitForTimeout(800)
// open cuts tab if present
const cutsTab = page.getByRole('tab', { name: /cuts/i }).or(page.getByTestId('tab-cuts'))
if (await cutsTab.count()) { await cutsTab.first().click(); await page.waitForTimeout(600) }
// pick cinderlilt
const row = page.locator('[data-testid="cut-row"], .cut-row').filter({ hasText: /cinderlilt/i }).first()
if (await row.count()) { await row.click(); await page.waitForTimeout(2000) }
const demonBtn = page.getByTestId('cut-gram-mode-demon')
if (await demonBtn.count() && !(await demonBtn.isDisabled())) {
  await demonBtn.click(); await page.waitForTimeout(1500)
}
await page.screenshot({ path: `${out}/cuts-cinderlilt-demon.png`, fullPage: false })
const panel = page.getByTestId('demon-panel')
if (await panel.count()) await panel.screenshot({ path: `${out}/cuts-cinderlilt-demon-panel.png` })
console.log(JSON.stringify({
  demonBtn: await demonBtn.count(),
  panel: await panel.count(),
  hint: (await page.getByTestId('demon-hint').count()) ? await page.getByTestId('demon-hint').innerText() : null,
}))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
