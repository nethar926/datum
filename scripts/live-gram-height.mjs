
/**
 * DOM height gate for the live gram after the DEMON toggle layout fix.
 * Asserts LOFAR/DIFAR/DEMON canvas clientHeight >= MIN at several viewports.
 * Fails on tip 3182902 / 2f2a9ec (DEMON ~0; LOFAR starved by empty second row).
 */
import { spawn, execSync } from 'node:child_process'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4251
const MIN = Number(process.env.GRAM_MIN_H) || 160
const VIEWS = [
  { w: 951, h: 600 },
  { w: 669, h: 600 },
  { w: 382, h: 600 },
  { w: 1280, h: 800 },
]
const MODES = ['lofar', 'difar', 'demon']

try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url).pathname,
})
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 200))
}

const browser = await chromium.launch()
const rows = []
let failed = false
for (const view of VIEWS) {
  for (const mode of MODES) {
    const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: view.w, height: view.h }, colorScheme: 'dark' })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${port}/datum/?gram=difar&autoplay&rate=16`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await dismissSplash(page)
    await page.waitForTimeout(1200)
    const modeBtn = page.getByTestId(`gram-mode-${mode}`)
    if (await modeBtn.count()) await modeBtn.click({ force: true })
    await page.waitForTimeout(800)
    if (await page.locator('.play-btn.primary').count()) await page.getByTestId('play-btn').click({ force: true }).catch(() => {})
    await page.waitForTimeout(500)
    const m = await page.evaluate((mode) => {
      const frameSel = mode === 'demon' ? '[data-testid=demon-frame]' : '[data-testid=lofar-frame]'
      const canvasSel = mode === 'demon' ? '[data-testid=demon]' : '[data-testid=lofar]'
      const frame = document.querySelector(frameSel)
      const canvas = document.querySelector(canvasSel)
      const left = document.querySelector('.workspace-left')
      const panel = mode === 'demon'
        ? document.querySelector('[data-testid=demon-panel]')
        : document.querySelector('[data-testid=live-gram-panel], .gram-box')
      return {
        frameH: frame?.clientHeight ?? 0,
        canvasH: canvas?.clientHeight ?? 0,
        panelH: panel?.clientHeight ?? 0,
        leftH: left?.clientHeight ?? 0,
        leftRows: left ? getComputedStyle(left).gridTemplateRows : '',
        demonVisible: document.querySelector('[data-testid=demon-panel]')?.getAttribute('data-visible'),
      }
    }, mode)
    // Pane must fill workspace-left; canvas must be non-trivial (0px was the Lance block).
    // DEMON head+hint shrink the canvas vs LOFAR — compare panelH to left, not inner frame.
    const canvasMin = mode === 'demon' ? 72 : MIN
    const paneH = m.panelH || m.frameH
    const paneOk = paneH >= canvasMin && (m.leftH < 1 || paneH >= m.leftH * 0.9)
    const pass = m.canvasH >= canvasMin && paneOk
    if (!pass) failed = true
    rows.push({ view, mode, min: canvasMin, pass, ...m })
    await ctx.close()
  }
}
console.log(JSON.stringify({ failed, rows }, null, 2))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
if (failed) process.exit(2)
