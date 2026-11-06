// m3-fe-layout smoke (WebKit): no off-viewport interactives, no overlapping buttons, ≥44 px targets,
// TAC reachable on phone landscape, gram height floors, newest-at-bottom by default, Zulu Y / Hz X.
// Run after `npm run build`. Saves docs/m3-layout-*.png. Port 4191.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'

const port = Number(process.env.PORT) || 4191
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid) } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('preview did not start on ' + port)
}
const goto = async (page, url) => {
  for (let a = 0; a < 3; a++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); return }
    catch (e) { if (a === 2) throw e; console.log('restart preview', e.message); await startSrv() }
  }
}

const VIEWS = [
  ['iphone-portrait', { ...devices['iPhone 15'] }, { gramMin: 150 }],
  ['iphone-landscape', { ...devices['iPhone 15 landscape'] }, { gramMin: 110 }],
  ['ipad-portrait', { ...devices['iPad Pro 11'] }, { gramMin: 400 }],
  ['ipad-landscape', { ...devices['iPad Pro 11 landscape'] }, { gramMin: 360 }],
  ['desktop', {
    viewport: { width: 1440, height: 900 },
    userAgent: devices['Desktop Safari'].userAgent,
    deviceScaleFactor: 1, isMobile: false, hasTouch: false,
  }, { gramMin: 400 }],
]

const measure = async (page) => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } }
  const vis = (el) => { const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden' && +st.opacity > 0 }
  const outside = []
  for (const el of document.querySelectorAll('button, [role=button], [data-testid$="-btn"]')) {
    if (!vis(el)) continue
    const r = rect(el); if (r.w < 2 || r.h < 2) continue
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) outside.push({ t: (el.innerText || '').trim().slice(0, 24), ...r })
  }
  const small = []
  for (const el of document.querySelectorAll('button, [role=button], [data-testid$="-btn"]')) {
    if (!vis(el)) continue
    const r = rect(el); if (r.w < 2 || r.h < 2) continue
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue
    if (r.w < 44 || r.h < 44) small.push({ t: (el.innerText || '').trim().slice(0, 24), w: Math.round(r.w), h: Math.round(r.h) })
  }
  const btns = [...document.querySelectorAll('button, [role=button], [data-testid$="-btn"]')]
    .map((el) => ({ el, r: rect(el) }))
    .filter(({ el, r }) => vis(el) && r.w > 2 && r.h > 2 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh)
  const overlaps = []
  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y))
  for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
    const a = btns[i], b = btns[j]
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue
    if (a.el.closest('.seg') && a.el.closest('.seg') === b.el.closest('.seg')) continue
    const ar = area(a.r, b.r)
    if (ar > 80) overlaps.push({ a: (a.el.innerText || '').trim().slice(0, 20), b: (b.el.innerText || '').trim().slice(0, 20), ar: Math.round(ar) })
  }
  const gram = document.querySelector('[data-testid=lofar]')
  const frame = document.querySelector('[data-testid=lofar-frame]')
  const axisY = document.querySelector('[data-testid=lofar-time-axis]')
  const axisX = document.querySelector('[data-testid=lofar-freq-axis]')
  const tacOpen = document.querySelector('[data-testid=tac-open]')
  const g = gram ? rect(gram) : null
  return {
    vw, vh, outside, small, overlaps,
    gramH: g ? g.h : (document.querySelector('.gram')?.getBoundingClientRect().height || 0),
    bodyH: document.querySelector('.panel.gram-panel .panel-body')?.getBoundingClientRect().height || 0,
    appDir: document.querySelector('[data-gram-dir]')?.getAttribute('data-gram-dir'),
    dir: frame?.getAttribute('data-dir'),
    yLabels: axisY ? [...axisY.querySelectorAll('span')].map((s) => s.textContent) : [],
    xLabels: axisX ? [...axisX.querySelectorAll('span')].map((s) => s.textContent) : [],
    tacBox: tacOpen ? rect(tacOpen) : null,
    plotBox: document.querySelector('[data-testid=tactical]') ? rect(document.querySelector('[data-testid=tactical]')) : null,
  }
})

try {
  await startSrv()
  for (const [slug, opts, floors] of VIEWS) {
    const browser = await webkit.launch()
    try {
      const ctx = await browser.newContext(opts)
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(String(e)))
      await page.addInitScript(() => { try { localStorage.removeItem('datum.gramDir'); localStorage.removeItem('datum.band') } catch {} })
      await goto(page, `http://127.0.0.1:${port}/datum/`)
      await page.waitForTimeout(800)
      await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/Acknowledge/i.test(b.innerText || '')) b.click() })
      await page.screenshot({ path: `docs/m3-layout-${slug}-before.png`, fullPage: false })

      await goto(page, `http://127.0.0.1:${port}/datum/?autoplay&rate=16`)
      await page.waitForTimeout(800)
      await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/Acknowledge/i.test(b.innerText || '')) b.click() })
      try { await page.waitForSelector('[data-testid=lofar]', { timeout: 10000 }) } catch {}
      await page.waitForTimeout(4500)
      await page.screenshot({ path: `docs/m3-layout-${slug}-after.png`, fullPage: false })

      const m = await measure(page)
      const F = (msg) => `${slug}: ${msg}`
      ok((m.appDir || m.dir) === 'bottom', F(`dir not bottom (${m.appDir}/${m.dir})`))
      const gh = Math.max(m.gramH, Math.max(0, m.bodyH - 44))
      ok(gh >= floors.gramMin, F(`gram height ${Math.round(gh)} (canvas=${Math.round(m.gramH)} body=${Math.round(m.bodyH)}) < floor ${floors.gramMin}`))
      ok(!m.outside.filter((o) => /^TAC$/i.test(o.t)).length, F(`TAC outside`))
      ok(!m.overlaps.length, F(`${m.overlaps.length} overlaps e.g. ${JSON.stringify(m.overlaps.slice(0, 4))}`))
      ok(!m.small.length, F(`${m.small.length} targets < 44 e.g. ${JSON.stringify(m.small.slice(0, 6))}`))
      {
        // The tactical plot is always on screen (side by side in landscape, stacked in portrait).
        const t = m.plotBox
        ok(!!t && t.w >= 120 && t.h >= 100 && t.x >= -1 && t.right <= m.vw + 2 && t.y >= -1 && t.bottom <= m.vh + 2,
          F(`tactical plot not on screen (${JSON.stringify(t)} vw=${m.vw})`))
      }
      ok(m.yLabels.some((t) => t === 'now') && m.yLabels.some((t) => /^\d{4}Z$/.test(t || '')),
        F(`Y labels not Zulu: ${JSON.stringify(m.yLabels)}`))
      ok(m.xLabels.some((t) => /Hz/i.test(t || '')), F(`X labels missing Hz: ${JSON.stringify(m.xLabels)}`))
      ok(!errs.length, F(`page errors ${errs.join(' | ')}`))
      console.log(slug, `gram=${Math.round(gh)}px`, `dir=${m.appDir}`, `y=${m.yLabels.join(',')}`, `lt44=${m.small.length}`, `ov=${m.overlaps.length}`)
      await ctx.close()
    } finally { await browser.close() }
  }

  {
    const browser = await webkit.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: devices['Desktop Safari'].userAgent })
      const page = await ctx.newPage()
      await page.addInitScript(() => {
        if (!sessionStorage.getItem('datum.layoutSmoke.seeded')) {
          try { localStorage.removeItem('datum.gramDir') } catch {}
          sessionStorage.setItem('datum.layoutSmoke.seeded', '1')
        }
      })
      await goto(page, `http://127.0.0.1:${port}/datum/?autoplay&rate=16`)
      await page.waitForSelector('[data-testid=lofar]'); await page.waitForTimeout(1500)
      await page.getByRole('tab', { name: 'Settings' }).click()
      await page.locator('[data-testid=gram-dir-top]').click()
      await page.waitForTimeout(150)
      ok((await page.locator('[data-gram-dir]').getAttribute('data-gram-dir')) === 'top', 'settings did not flip to top')
      ok((await page.evaluate(() => localStorage.getItem('datum.gramDir'))) === 'top', 'localStorage not top after click')
      await page.reload(); await page.waitForSelector('[data-testid=lofar]'); await page.waitForTimeout(1000)
      ok((await page.locator('[data-gram-dir]').getAttribute('data-gram-dir')) === 'top', 'gramDir did not persist')
      await page.screenshot({ path: 'docs/m3-layout-desktop-topdir.png', fullPage: false })
      await ctx.close(); console.log('flip persist ok')
    } finally { await browser.close() }
  }
} finally { try { if (srv) process.kill(-srv.pid) } catch {} }

if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) }
console.log('layout smoke OK')
