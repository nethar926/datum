
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = 4222
const out = '/workspace/demon-live-shots'
mkdirSync(out, { recursive: true })

let srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true })
const ready = async () => {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('preview not ready')
}
await ready()
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(`http://127.0.0.1:${port}/datum/?gram=demon`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await dismissSplash(page)
await page.waitForTimeout(2500)
const btn = page.getByTestId('gram-mode-demon')
if (await btn.count()) {
  await btn.click()
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: `${out}/live-demon.png`, fullPage: false })
const panel = page.getByTestId('demon-panel')
if (await panel.count()) await panel.screenshot({ path: `${out}/live-demon-panel.png` })
const hint = page.getByTestId('demon-hint')
const hintText = (await hint.count()) ? await hint.innerText() : '(no hint)'
console.log(JSON.stringify({ hintText, panelVisible: await panel.count() }))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
process.exit(0)
