// Splash + Add to Home Screen smoke (WebKit). Thick material card (no bleed-through), A2HS on iOS
// UA when not standalone, Don't show again persists, standalone hides the card. Port 4198.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4198
mkdirSync('docs', { recursive: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview on ${port} not ready`)
}
const URL = `http://127.0.0.1:${port}/datum/?autoplay&rate=16&tab=live`
const prep = async (page) => {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('datum.a2hs.hide')
      localStorage.setItem('datum.scheme', 'dark') // screenshots / contrast checks in dark thick material
    } catch {}
  })
}

const fullyIn = (box, vw, vh, inset = 0) => !!box
  && box.x >= -0.5 + inset
  && box.y >= -0.5 + inset
  && box.x + box.width <= vw + 0.5 - inset
  && box.y + box.height <= vh + 0.5 - inset

/** Sample a grid of pixels inside an element and return luminance mean/variance (0–255²). */
const sampleLuma = async (page, sel, n = 8) => page.evaluate(({ sel, n }) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 8 || r.height < 8) return null
  // Draw the viewport into a canvas and sample the element's box (avoids reading through compositing tricks).
  // Playwright can't expose the live framebuffer; approximate by reading computed backgrounds of the
  // card + a2hs and asserting those paints are opaque, then sample via getImageData from a screenshot
  // is done outside. Here we only check computed opacity/alpha of the material layers.
  const card = document.querySelector('[data-testid=splash-card]')
  const a2hs = document.querySelector('[data-testid=splash-a2hs]')
  const cs = (e) => e ? getComputedStyle(e) : null
  const parseA = (bg) => {
    if (!bg) return 0
    const m = bg.match(/rgba?\(([^)]+)\)/i)
    if (!m) {
      // hex #rrggbb → opaque
      if (/^#([0-9a-f]{6})$/i.test(bg.trim())) return 1
      if (bg === 'transparent') return 0
      return 1
    }
    const parts = m[1].split(',').map((s) => s.trim())
    return parts.length === 4 ? Number(parts[3]) : 1
  }
  const cardBg = cs(card)?.backgroundColor
  const a2hsBg = cs(a2hs)?.backgroundColor
  const cardA = parseA(cardBg || '')
  const a2hsA = parseA(a2hsBg || '')
  // Grid of sample points inside the steps rect (for the screenshot-based variance below).
  const pts = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    pts.push({
      x: Math.round(r.x + (x + 0.5) * r.width / n),
      y: Math.round(r.y + (y + 0.5) * r.height / n),
    })
  }
  return { cardBg, a2hsBg, cardA, a2hsA, box: { x: r.x, y: r.y, w: r.width, h: r.height }, pts }
}, { sel, n })

const lumaVarianceFromShot = async (page, box, pts) => {
  const shot = await page.screenshot({ type: 'png' })
  // Decode PNG via createImageBitmap in the page.
  return page.evaluate(async ({ b64, box, pts }) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const dpr = c.width / window.innerWidth
    const lumas = []
    for (const p of pts) {
      const x = Math.min(c.width - 1, Math.max(0, Math.round(p.x * dpr)))
      const y = Math.min(c.height - 1, Math.max(0, Math.round(p.y * dpr)))
      const [r, gg, b] = g.getImageData(x, y, 1, 1).data
      lumas.push(0.2126 * r + 0.7152 * gg + 0.0722 * b)
    }
    const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length
    const variance = lumas.reduce((a, v) => a + (v - mean) * (v - mean), 0) / lumas.length
    return { mean, variance, n: lumas.length, dpr }
  }, { b64: shot.toString('base64'), box, pts })
}

const iphone = {
  ...devices['iPhone 15'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}
const iphoneSE = {
  ...devices['iPhone SE'],
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}
const desktop = {
  viewport: { width: 1440, height: 900 },
  userAgent: devices['Desktop Safari'].userAgent,
  deviceScaleFactor: 1, isMobile: false, hasTouch: false,
}

const assertOpaqueCard = async (page, label) => {
  const mat = await page.evaluate(() => {
    const card = document.querySelector('[data-testid=splash-card]')
    const a2hs = document.querySelector('[data-testid=splash-a2hs]')
    const steps = document.querySelector('[data-testid=splash-a2hs-steps]')
    if (!card || !a2hs || !steps) return null
    const parseA = (bg) => {
      if (!bg) return 0
      const m = bg.match(/rgba?\(([^)]+)\)/i)
      if (!m) return /^#([0-9a-f]{3,8})$/i.test(bg.trim()) || bg !== 'transparent' ? 1 : 0
      const parts = m[1].split(',').map((s) => s.trim())
      return parts.length === 4 ? Number(parts[3]) : 1
    }
    const cardBg = getComputedStyle(card).backgroundColor
    const a2hsBg = getComputedStyle(a2hs).backgroundColor
    const sr = steps.getBoundingClientRect()
    const ar = a2hs.getBoundingClientRect()
    // Solid samples: (1) a2hs top padding strip (no text), (2) step-area mid-gutters between rows.
    const pts = []
    for (let i = 0; i < 10; i++) pts.push({ x: Math.round(ar.x + 10 + i * (ar.width - 20) / 9), y: Math.round(ar.y + 6) })
    // Between step 1 and 2 (vertical gap), across the text column — should be solid inset fill if opaque.
    const gapY = Math.round(sr.y + sr.height * 0.33)
    for (let i = 0; i < 8; i++) pts.push({ x: Math.round(sr.x + sr.width * 0.35 + i * sr.width * 0.06), y: gapY })
    return { cardBg, a2hsBg, cardA: parseA(cardBg), a2hsA: parseA(a2hsBg), pts }
  })
  ok(!!mat, `${label}: a2hs/steps missing for opacity sample`)
  if (!mat) return
  ok(mat.cardA >= 0.99, `${label}: card alpha ${mat.cardA} < 1 (${mat.cardBg})`)
  ok(mat.a2hsA >= 0.99, `${label}: a2hs alpha ${mat.a2hsA} < 1 (${mat.a2hsBg})`)
  await page.waitForTimeout(1200) // gram paints; bleed would show if material were glass
  const stats = await lumaVarianceFromShot(page, null, mat.pts)
  ok(stats.variance < 180, `${label}: solid-region luma variance ${stats.variance.toFixed(1)} (mean ${stats.mean.toFixed(1)}) — content bleeding through`)
}

const assertButtonsNoWrap = async (page, label) => {
  for (const sel of ['[data-testid=splash-a2hs-notnow]', '[data-testid=splash-a2hs-dont]', '[data-testid=splash-continue]']) {
    if (await page.locator(sel).count() === 0) continue
    const box = await page.locator(sel).boundingBox()
    ok(!!box, `${label}: ${sel} missing box`)
    if (!box) continue
    ok(box.height >= 44 && box.height < 56, `${label}: ${sel} height ${box.height} (wrap or undersized)`)
  }
}

await startSrv()
const browser = await webkit.launch()
try {
  // ---- 1) iPhone portrait: splash + A2HS card ----
  {
    const ctx = await browser.newContext({ ...iphone })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await prep(page)
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForSelector('[data-testid=splash]', { timeout: 10000 })
    await page.waitForSelector('[data-testid=lofar]', { timeout: 30000 })
    ok(await page.locator('[data-testid=splash-scrim]').count() === 1, 'iphone: scrim missing')
    ok(await page.locator('[data-testid=splash-disclaimer]').count() === 1, 'iphone: disclaimer missing')
    ok(await page.locator('[data-testid=splash-logo]').count() === 1, 'iphone: logo missing')
    ok(await page.locator('[data-testid=splash-a2hs]').count() === 1, 'iphone: A2HS card should show')
    ok(await page.locator('[data-testid=splash-a2hs]').getAttribute('data-platform') === 'ios', 'iphone: platform ios')
    const card = await page.locator('[data-testid=splash-card]').boundingBox()
    const cont = await page.locator('[data-testid=splash-continue]').boundingBox()
    ok(fullyIn(card, 390, 844), `iphone: splash card clipped ${JSON.stringify(card)}`)
    ok(fullyIn(cont, 390, 844), `iphone: Continue clipped ${JSON.stringify(cont)}`)
    // 390×844 should fit without scrolling the card.
    const scroll = await page.locator('[data-testid=splash-card]').evaluate((e) => e.scrollHeight - e.clientHeight)
    ok(scroll <= 2, `iphone: card scrolls by ${scroll}px on 390×844`)
    await assertOpaqueCard(page, 'iphone')
    await assertButtonsNoWrap(page, 'iphone')
    await page.screenshot({ path: 'docs/m3-splash-iphone-portrait.png', fullPage: false })
    await page.screenshot({ path: 'docs/m3-splash-homescreen-card.png', fullPage: false })
    await page.locator('[data-testid=splash-continue]').tap()
    await page.waitForSelector('[data-testid=splash]', { state: 'detached', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(250)
    ok(await page.locator('[data-testid=splash]').count() === 0, 'iphone: splash still present after Continue')
    ok(errs.length === 0, `iphone: page errors ${errs.join(' | ')}`)
    await ctx.close()
  }

  // ---- 1b) Smallest iPhone 375×667 (scroll OK) ----
  {
    const ctx = await browser.newContext({ ...iphoneSE })
    const page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await prep(page)
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForSelector('[data-testid=splash-a2hs]', { timeout: 10000 })
    await page.waitForSelector('[data-testid=lofar]', { timeout: 30000 })
    const card = await page.locator('[data-testid=splash-card]').boundingBox()
    ok(fullyIn(card, 375, 667, -1), `se: card outside viewport ${JSON.stringify(card)}`)
    await assertOpaqueCard(page, 'se')
    await assertButtonsNoWrap(page, 'se')
    await page.screenshot({ path: 'docs/m3-splash-iphone-se.png', fullPage: false })
    await dismissSplash(page)
    await ctx.close()
  }

  // ---- 2) Don't show again persists across reload ----
  {
    const ctx = await browser.newContext({ ...iphone })
    const page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await prep(page)
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForSelector('[data-testid=splash-a2hs]', { timeout: 10000 })
    await page.locator('[data-testid=splash-a2hs-dont]').tap()
    ok(await page.locator('[data-testid=splash-a2hs]').count() === 0, 'persist: A2HS should hide after Don\'t show again')
    const stored = await page.evaluate(() => localStorage.getItem('datum.a2hs.hide'))
    ok(stored === '1', `persist: localStorage want 1 got ${stored}`)
    await page.locator('[data-testid=splash-continue]').tap()
    await page.waitForTimeout(250)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=splash]', { timeout: 10000 })
    ok(await page.locator('[data-testid=splash-a2hs]').count() === 0, 'persist: A2HS returned after Don\'t show again')
    ok(await page.locator('[data-testid=splash-continue]').count() === 1, 'persist: splash Continue still on every load')
    await dismissSplash(page)
    await ctx.close()
  }

  // ---- 3) Standalone emulation hides A2HS ----
  {
    const ctx = await browser.newContext({ ...iphone })
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true })
      const orig = window.matchMedia.bind(window)
      window.matchMedia = (q) => {
        if (String(q).includes('display-mode: standalone')) return { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
        return orig(q)
      }
    })
    const page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForSelector('[data-testid=splash]', { timeout: 10000 })
    ok(await page.locator('[data-testid=splash-a2hs]').count() === 0, 'standalone: A2HS should be hidden')
    ok(await page.locator('[data-testid=splash-continue]').count() === 1, 'standalone: splash still shows')
    const metas = await page.evaluate(() => ({
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
      mobile: document.querySelector('meta[name="mobile-web-app-capable"]')?.content,
      status: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
      title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
      manifest: document.querySelector('link[rel=manifest]')?.href,
    }))
    ok(metas.capable === 'yes', `meta capable ${metas.capable}`)
    ok(metas.mobile === 'yes', `meta mobile ${metas.mobile}`)
    ok(metas.status === 'black-translucent', `meta status ${metas.status}`)
    ok(metas.title === 'DATUM', `meta title ${metas.title}`)
    ok(/manifest\.webmanifest/.test(metas.manifest || ''), `manifest link ${metas.manifest}`)
    await dismissSplash(page)
    await ctx.close()
  }

  // ---- 4) Desktop: splash, no A2HS ----
  {
    const ctx = await browser.newContext({ ...desktop })
    const page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await prep(page)
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForSelector('[data-testid=splash]', { timeout: 10000 })
    await page.waitForSelector('[data-testid=lofar]', { timeout: 30000 })
    ok(await page.locator('[data-testid=splash-a2hs]').count() === 0, 'desktop: no A2HS')
    const card = await page.locator('[data-testid=splash-card]').boundingBox()
    ok(fullyIn(card, 1440, 900), `desktop: card clipped ${JSON.stringify(card)}`)
    // Desktop has no A2HS steps — sample the disclaimer area on the card instead.
    const mat = await page.evaluate(() => {
      const card = document.querySelector('[data-testid=splash-card]')
      const cs = getComputedStyle(card)
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/i)
      const a = m ? (m[1].split(',').length === 4 ? Number(m[1].split(',')[3].trim()) : 1) : 1
      return { bg: cs.backgroundColor, a }
    })
    ok(mat.a >= 0.9, `desktop: card alpha ${mat.a} (${mat.bg})`)
    await page.screenshot({ path: 'docs/m3-splash-desktop.png', fullPage: false })
    await dismissSplash(page)
    ok(await page.locator('[data-testid=splash]').count() === 0, 'desktop: splash cleared')
    await ctx.close()
  }
} finally {
  await browser.close()
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}

if (fails.length) {
  console.error('FAIL\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exit(1)
}
console.log('ok splash-shot: opaque card, no-wrap buttons, iphone+se+desktop')
