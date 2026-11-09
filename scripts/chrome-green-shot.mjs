
/**
 * Chrome-green Duo screenshots + layout assertion (headless; not touch/device validation).
 * VIEWPORTS: 951 (open landscape), 669 (open upright), 382 (folded). Height 600 (no Duo preset).
 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const tag = process.env.TAG || 'after'
const port = Number(process.env.PORT) || 4232
const out = process.env.OUT || '/workspace/chrome-green-shots'
mkdirSync(out, { recursive: true })
const VIEWS = [
  { name: '951', width: 951, height: 600 },
  { name: '669', width: 669, height: 600 },
  { name: '382', width: 382, height: 600 },
]

try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
await new Promise((r) => setTimeout(r, 400))
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url).pathname,
})
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 200))
}

async function closeSheets(page) {
  for (let i = 0; i < 4; i++) {
    if (!(await page.locator('.sheet-root.open').count())) break
    const close = page.locator('[data-testid="buoy-sheet-close"], .sheet-root.open [data-testid$="-close"]').first()
    if (await close.count()) await close.click({ force: true }).catch(() => {})
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
}

const browser = await chromium.launch()
const report = []

for (const VIEW of VIEWS) {
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: VIEW, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    try {
      localStorage.setItem('datum.appearance', 'dark')
      localStorage.setItem('datum.horz', '0')
      localStorage.setItem('datum.scheme', 'dark')
    } catch {}
  })
  await page.goto(`http://127.0.0.1:${port}/datum/?gram=difar`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dismissSplash(page)
  await page.waitForTimeout(1200)
  await closeSheets(page)

  // Select a non-default buoy once (re-clicking the active buoy opens buoy-sheet).
  const buoys = page.locator('[data-testid^="buoy-ch-"]')
  const n = await buoys.count()
  if (n > 1) await buoys.nth(1).click({ force: true })
  else if (n === 1) await buoys.first().click({ force: true })
  await page.waitForTimeout(200)
  await closeSheets(page)

  // Start playback so the gram paints data.
  if (await page.locator('.play-btn.primary').count()) {
    await page.getByTestId('play-btn').click({ force: true }).catch(() => {})
  }
  await page.waitForTimeout(VIEW.name === '951' ? 5000 : 2800)
  await closeSheets(page)

  await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="gram-tools-scroll"]')
    if (scroll) scroll.scrollLeft = 0
    const horz = document.querySelector('[data-testid="horz-tool"]')
    if (horz instanceof HTMLElement) {
      horz.click()
      if (horz.getAttribute('aria-pressed') !== 'true') horz.click()
    }
  })
  await page.waitForTimeout(300)
  await closeSheets(page)
  // Keep tools scrolled to start so FIX…HORZ show at 951.
  await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="gram-tools-scroll"]')
    if (scroll) scroll.scrollLeft = 0
  })

  const layout = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="gram-tools"]')
    if (!bar) return { ok: false, reason: 'no gram-tools' }
    const br = bar.getBoundingClientRect()
    const labels = ['FIX', 'BRG', 'DOP', 'HARM', 'LM', 'HORZ']
    const tools = [...bar.querySelectorAll('button.tool')].filter((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      return labels.includes(t)
    })
    const rows = tools.map((el) => {
      const r = el.getBoundingClientRect()
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      const fully = r.left >= br.left - 0.5 && r.right <= br.right + 0.5 && r.width > 8
      const clipped = r.left < br.right && r.right > br.right + 0.5
      return { test: el.getAttribute('data-testid'), text, pressed: el.getAttribute('aria-pressed'), fully, clipped, minH: Math.round(r.height) }
    })
    const vw = window.innerWidth
    const requireAll = vw >= 900
    const primary = rows.filter((r) => labels.includes(r.text))
    const clipped = rows.filter((r) => r.clipped)
    const partialLabel = rows.filter((r) => ['LN', 'HA', 'HO', 'BR', 'DO', 'FI'].includes(r.text))
    const allPrimaryFull = !requireAll || (primary.length >= 6 && primary.every((r) => r.fully))
    const sheetOpen = !!document.querySelector('.sheet-root.open')
    // At folded/narrow widths a tool may straddle the scroll edge (chevron + fade); that is OK.
    // At ≥900 every primary tool must be fully inside the bar with no mid-clip.
    const okNarrow = partialLabel.length === 0 && !sheetOpen
    const okWide = okNarrow && clipped.length === 0 && allPrimaryFull
    return {
      ok: requireAll ? okWide : okNarrow,
      vw, requireAll, clipped, partialLabel, sheetOpen,
      primary: primary.map((r) => ({ text: r.text, fully: r.fully, pressed: r.pressed, h: r.minH })),
      trailingW: Math.round(document.querySelector('[data-testid="gram-tools-trailing"]')?.getBoundingClientRect().width || 0),
      barW: Math.round(br.width),
      horzPressed: document.querySelector('[data-testid="horz-tool"]')?.getAttribute('aria-pressed'),
      hasTrailing: document.querySelector('[data-testid="gram-tools"]')?.getAttribute('data-trailing'),
      scrollWrap: !!document.querySelector('[data-testid="gram-tools"] .tool-scroll-wrap'),
      playing: !document.querySelector('.play-btn.primary'),
    }
  })

  const fullPath = VIEW.name === '951' ? `${out}/${tag}-full.png` : `${out}/${tag}-${VIEW.name}.png`
  await page.screenshot({ path: fullPath, fullPage: false })
  if (VIEW.name === '951') {
    const dock = page.getByTestId('dock')
    if (await dock.count()) await dock.screenshot({ path: `${out}/${tag}-dock.png` })
    const chrome = page.getByTestId('chrome-bar')
    if (await chrome.count()) await chrome.screenshot({ path: `${out}/${tag}-chrome.png` })
    const tools = page.getByTestId('gram-tools')
    if (await tools.count()) await tools.screenshot({ path: `${out}/${tag}-tools.png` })
  }

  report.push({ viewport: VIEW, layout, note: 'headless capture, not touch/device validation', path: fullPath })
  if (VIEW.name === '951' && !layout.ok) console.error('LAYOUT_FAIL_951', JSON.stringify(layout, null, 2))
  await ctx.close()
}

writeFileSync(`${out}/${tag}-layout.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ tag, note: 'headless capture, not touch/device validation', report }, null, 2))
await browser.close()
try { process.kill(-srv.pid, 'SIGTERM') } catch {}
try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
// tidy dupes from earlier naming glitch
try { execSync(`rm -f ${out}/after-382-full.png ${out}/after-669-full.png ${out}/before-382-full.png ${out}/before-669-full.png`) } catch {}
if (report.some((r) => r.viewport.name === '951' && !r.layout.ok)) process.exit(2)
