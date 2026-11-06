// iOS app structure + Liquid Glass smoke (WebKit). Run after `npm run build`. Port 4191 (PORT env overrides).
// Checks: tab bar (Live/Cuts/Plot/Settings), glass chrome never over the gram/plot, 44 pt targets, no page scroll,
// light/dark chrome with dark instruments, portrait split grabber (drag, clamp, persist, double-tap reset), tab bar
// minimize while working the gram, sheet detents + swipe dismiss, Settings large title collapse + gram flip,
// Cuts placeholder, HORZ hairline + Zulu label (toggle + persistence), glass fallback, frame pacing with glass on/off.
// Saves docs/m3-ios-*.png.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'

const port = Number(process.env.PORT) || 4191
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid) } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {} await new Promise((r) => setTimeout(r, 200)) }
  throw new Error('preview did not start on ' + port)
}
const URL = (q = '') => `http://127.0.0.1:${port}/datum/?autoplay&rate=16${q}`
const goto = async (page, url) => {
  for (let a = 0; a < 3; a++) { try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); return } catch (e) { if (a === 2) throw e; await startSrv() } }
}
const DESK = { viewport: { width: 1440, height: 900 }, userAgent: devices['Desktop Safari'].userAgent, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
const VIEWS = [
  ['iphone-portrait-dark', devices['iPhone 15'], 'dark'],
  ['iphone-portrait-light', devices['iPhone 15'], 'light'],
  ['iphone-landscape', devices['iPhone 15 landscape'], 'dark'],
  ['ipad-portrait', devices['iPad Pro 11'], 'light'],
  ['desktop', DESK, 'dark'],
]
const rate = (page, ms = 2000) => page.evaluate((ms) => new Promise((res) => {
  const d = []; let last = performance.now(); const t0 = last
  const f = (t) => { d.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ fps: (d.length * 1000) / (t - t0), p50: d[Math.floor(d.length * 0.5)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] }) } }
  requestAnimationFrame(f)
}), ms)
const fmt = (r) => `${r.fps.toFixed(1)} fps, p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms`

const measure = (page) => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } }
  const vis = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 }
  const inter = (a, b) => a && b && Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y))
  const small = [], outside = []
  for (const el of document.querySelectorAll('button, select, [role=tab], [role=button]')) {
    if (!vis(el)) continue
    const r = R(el); if (r.w < 2 || r.h < 2) continue
    // Clipped inside a horizontal scroller (tool bar / head strip): judge by the scroller.
    const sc = el.closest('.tool-scroll, .panel-head, .drop-tools, .drop-bar'); const sr = sc ? R(sc) : null
    if (sr && (r.right <= sr.x + 1 || r.x >= sr.right - 1)) continue
    if (r.right < 0 || r.bottom < 0 || r.x > vw || r.y > vh) { outside.push((el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)); continue }
    if (r.w < 44 || r.h < 44) small.push({ t: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20), w: Math.round(r.w), h: Math.round(r.h) })
  }
  const gram = R(document.querySelector('[data-testid=lofar]')), plot = R(document.querySelector('[data-testid=tactical]'))
  const glass = [...document.querySelectorAll('.navbar, .tabbar, .toolbar-glass')].filter(vis).map(R)
  const over = glass.reduce((s, g) => s + (inter(g, gram) || 0) + (inter(g, plot) || 0), 0)
  const before = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el, '::before'); const a = getComputedStyle(el, '::after'); return { bf: s.webkitBackdropFilter || s.backdropFilter, bg: s.backgroundColor, spec: /gradient/.test(a.backgroundImage) && /inset/.test(a.boxShadow) } }
  const sc = document.scrollingElement
  // (1) Zulu/NOW time labels fully inside the gram's time axis.
  const yClip = []
  for (const ax of document.querySelectorAll('.axis-y')) { if (!vis(ax)) continue; const a = R(ax)
    for (const sp of ax.querySelectorAll('span')) { const r = R(sp); if (r.y < a.y - 0.5 || r.bottom > a.bottom + 0.5) yClip.push(sp.textContent) } }
  // (2) Tool strips that overflow must show the affordance (edge fade + chevron) on the side that has more.
  const toolCut = []
  for (const w of document.querySelectorAll('.tool-scroll-wrap')) { if (!vis(w)) continue; const t = w.querySelector('.tool-scroll')
    const moreR = t.scrollLeft + t.clientWidth < t.scrollWidth - 2
    if (moreR && (w.dataset.moreR !== '1' || !w.querySelector('.tool-more-r'))) toolCut.push('no right affordance')
    if (!moreR && w.dataset.moreR === '1') toolCut.push('stale right affordance') }
  // (3) The drop status chip shows its whole text (no ellipsis, no clamp overflow).
  const hintEl = document.querySelector('[data-testid=drop-hint]')
  const hintClip = hintEl && vis(hintEl) && (hintEl.scrollWidth > hintEl.clientWidth + 1 || hintEl.scrollHeight > hintEl.clientHeight + 1) ? hintEl.innerText : null
  return {
    yClip, toolCut, hintClip,
    vw, vh, small, outside, over, gram, plot,
    scrolls: sc.scrollWidth > vw + 1 || sc.scrollHeight > vh + 1,
    scheme: document.documentElement.dataset.scheme, glass: document.documentElement.dataset.glass,
    navBg: getComputedStyle(document.body).backgroundColor,
    gramBg: getComputedStyle(document.querySelector('.gram-panel .panel-body')).backgroundColor,
    plotBg: getComputedStyle(document.querySelector('.tac-panel .panel-body')).backgroundColor,
    tabGlass: before('.tabbar'), navGlass: before('.navbar'), floatGlass: before('[data-testid=layers-open]'),
    tabs: [...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-label')),
    gramDir: document.querySelector('[data-gram-dir]')?.getAttribute('data-gram-dir'),
  }
})

const perf = []
try {
  await startSrv()
  const browser = await webkit.launch()
  for (const [slug, dev, scheme] of VIEWS) {
    const ctx = await browser.newContext({ ...dev, colorScheme: scheme }), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    // Fresh prefs on the first load only (reloads must keep what the test persisted).
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('ios.seeded')) { for (const k of ['datum.gramDir', 'datum.band', 'datum.split.v', 'datum.split.h', 'datum.horz', 'datum.scheme', 'datum.glass']) localStorage.removeItem(k); sessionStorage.setItem('ios.seeded', '1') } } catch {} })
    await goto(page, URL())
    await page.waitForSelector('[data-testid=lofar]'); await page.waitForTimeout(6000)
    const F = (m) => `${slug}: ${m}`
    const m = await measure(page)
    console.log(slug, JSON.stringify({ scheme: m.scheme, glass: m.glass, gram: m.gram && [Math.round(m.gram.w), Math.round(m.gram.h)], plot: m.plot && [Math.round(m.plot.w), Math.round(m.plot.h)], small: m.small.length, over: m.over, floatBf: m.floatGlass?.bf }))
    ok(m.scheme === scheme, F(`scheme ${m.scheme} != ${scheme}`))
    ok(JSON.stringify(m.tabs) === JSON.stringify(['Live', 'Cuts', 'Plot', 'Settings']), F(`tabs ${m.tabs}`))
    ok(!m.scrolls, F('page scrolls'))
    ok(!m.small.length, F(`targets < 44: ${JSON.stringify(m.small.slice(0, 6))}`))
    ok(!m.outside.length, F(`buttons off screen: ${JSON.stringify(m.outside.slice(0, 6))}`))
    ok(m.over === 0, F(`glass chrome overlaps the gram/plot by ${m.over} px²`))
    ok(m.gram && m.gram.h >= (slug.startsWith('iphone-landscape') ? 110 : 150) && m.gram.right <= m.vw + 1, F(`gram too small/off screen ${JSON.stringify(m.gram)}`))
    ok(m.plot && m.plot.h >= 100 && m.plot.w >= 150 && m.plot.bottom <= m.vh + 1, F(`plot too small/off screen ${JSON.stringify(m.plot)}`))
    ok(!m.yClip.length, F(`time-axis labels clipped: ${JSON.stringify(m.yClip)}`))
    ok(!m.toolCut.length, F(`tool strip: ${m.toolCut.join(', ')}`))
    ok(!m.hintClip, F(`drop hint truncated: "${m.hintClip}"`))
    ok(m.gramBg === 'rgb(0, 0, 0)', F(`gram body not black (${m.gramBg})`))
    ok(/^rgb\(5, 8, 10\)$/.test(m.plotBg), F(`plot body not dark (${m.plotBg})`))
    // Dock + Live nav sit over the flat app background: tinted material + specular rim, no backdrop pass (perf).
    // Real backdrop blur is on glass that has live content behind it (floating plot buttons, sheets, scrolling navs).
    ok(m.tabGlass?.spec && m.navGlass?.spec && !/rgba?\(0, 0, 0, 0\)/.test(m.tabGlass.bg), F(`chrome glass missing material/specular (${JSON.stringify([m.tabGlass, m.navGlass])})`))
    ok(m.glass === 'reduced' || /blur/.test(m.floatGlass?.bf ?? ''), F(`no backdrop blur on floating plot glass (${JSON.stringify(m.floatGlass)})`))
    await page.screenshot({ path: `docs/m3-ios-${slug}.png` })

    if (slug === 'iphone-portrait-dark') {
      // Frame pacing with Liquid Glass on, then the reduced (opaque) fallback.
      perf.push([`${slug} glass full idle`, await rate(page)])
      // Tab bar minimize: touching the gram collapses it to the active tab; the gram does not resize.
      const g0 = (await measure(page)).gram
      const gb = await page.locator('[data-testid=lofar]').boundingBox()
      await page.touchscreen.tap(gb.x + gb.width * 0.5, gb.y + gb.height * 0.5); await page.waitForTimeout(300)
      ok(await page.locator('[data-testid=tabbar]').getAttribute('data-min') === '1', F('tab bar did not minimize while working the gram'))
      const g1 = (await measure(page)).gram
      ok(Math.abs(g1.h - g0.h) < 0.5 && Math.abs(g1.w - g0.w) < 0.5, F(`gram resized on minimize (${g0.h} → ${g1.h})`))
      const tw = await page.locator('[data-testid=gram-tools]').boundingBox()
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-minimized.png' })
      await page.locator('[data-testid=tab-live]').tap(); await page.waitForTimeout(300)
      ok(await page.locator('[data-testid=tabbar]').getAttribute('data-min') === '0', F('tapping the mini tab bar did not expand it'))
      const tw2 = await page.locator('[data-testid=gram-tools]').boundingBox()
      ok(tw.width > tw2.width + 80, F(`tool bar did not gain room while minimized (${tw.width} vs ${tw2.width})`))
      // Split grabber: drag down 70 px → gram grows; persisted; clamp at the extremes; double-tap resets.
      const H = page.locator('[data-testid=split-handle]'), hb = await H.boundingBox()
      ok(hb.height >= 20, F('split handle missing'))
      const hit = await H.evaluate((e) => { const r = e.getBoundingClientRect(); const a = getComputedStyle(e, '::before'); return r.height + 2 * Math.abs(parseFloat(a.top)) })
      ok(hit >= 44, F(`split handle hit area ${hit} < 44`))
      const dragBy = async (dy) => {
        const c = { x: hb.x + hb.width / 2, y: (await H.boundingBox()).y + hb.height / 2 }
        const ev = (type, y) => H.dispatchEvent(type, { pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: c.x, clientY: y, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
        await ev('pointerdown', c.y); for (let k = 1; k <= 10; k++) await ev('pointermove', c.y + (dy * k) / 10); await ev('pointerup', c.y + dy)
        await page.waitForTimeout(320)
      }
      const p0 = (await measure(page)).gram.h
      await dragBy(70)
      const p1 = (await measure(page)).gram.h
      ok(p1 > p0 + 50, F(`split drag did not grow the gram (${p0} → ${p1})`))
      const saved = await page.evaluate(() => localStorage.getItem('datum.split.v'))
      ok(saved && +saved > 0.6, F(`split not persisted (${saved})`))
      await dragBy(-900)
      const clampTop = await measure(page)
      ok(clampTop.gram.h + 44 >= 168 - 2, F(`gram pane under min after clamp (${clampTop.gram.h})`))
      await dragBy(900)
      const clampBot = await measure(page)
      ok(clampBot.plot.h >= 118, F(`plot pane under min after clamp (${clampBot.plot.h})`))
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-split-max.png' })
      await page.reload(); await page.waitForSelector('[data-testid=lofar]'); await page.waitForTimeout(1500)
      const afterReload = (await measure(page)).gram.h
      ok(Math.abs(afterReload - clampBot.gram.h) < 3, F(`split did not survive reload (${clampBot.gram.h} → ${afterReload})`))
      const c = await H.boundingBox()
      await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2); await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2); await page.waitForTimeout(350)
      const reset = await page.evaluate(() => +localStorage.getItem('datum.split.v'))
      ok(Math.abs(reset - 0.6) < 0.02, F(`double-tap did not reset the split (${reset})`))
      // Sheet: buoy info opens at medium, drags to large, swipes down to dismiss.
      await page.locator('[data-testid=buoy-info]').tap(); await page.waitForTimeout(350)
      const sheet = page.locator('[data-testid=buoy-sheet]')
      ok(await sheet.getAttribute('data-detent') === 'medium', F('sheet did not open at medium'))
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-sheet-medium.png' })
      const top = page.locator('[data-testid=buoy-sheet] .sheet-top')
      const sw = async (dy) => { const b = await top.boundingBox(); const x = b.x + b.width / 2, y = b.y + 30
        const ev = (type, yy) => top.dispatchEvent(type, { pointerId: 31, pointerType: 'touch', isPrimary: true, clientX: x, clientY: yy, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
        await ev('pointerdown', y); for (let k = 1; k <= 8; k++) { await ev('pointermove', y + (dy * k) / 8); await page.waitForTimeout(16) } await ev('pointerup', y + dy); await page.waitForTimeout(350) }
      await sw(-260)
      ok(await sheet.getAttribute('data-detent') === 'large', F('swipe up did not reach the large detent'))
      await sw(400)
      ok(await page.locator('[data-testid=buoy-sheet]').count() === 0, F('swipe down did not dismiss the sheet'))
      // Plot layers sheet from the floating glass button.
      await page.locator('[data-testid=layers-open]').tap(); await page.waitForTimeout(350)
      ok(await page.locator('[data-testid=layers-sheet]').isVisible(), F('layers sheet did not open'))
      await page.getByRole('button', { name: 'Close Plot layers' }).tap(); await page.waitForTimeout(350)
      // Cuts placeholder.
      await page.locator('[data-testid=tab-cuts]').tap(); await page.waitForTimeout(300)
      ok(/Coming soon/.test(await page.locator('[data-testid=cuts-screen]').innerText()), F('Cuts placeholder missing'))
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-cuts.png' })
      // Settings: inset grouped list, large title collapses on scroll, gram flip, appearance override.
      await page.locator('[data-testid=tab-settings]').tap(); await page.waitForTimeout(300)
      ok(await page.locator('[data-testid=settings]').getAttribute('data-collapsed') === '0', F('large title not expanded at top'))
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-settings.png' })
      await page.locator('[data-testid=settings] .screen-scroll').evaluate((e) => { e.scrollTop = 220; e.dispatchEvent(new Event('scroll')) }); await page.waitForTimeout(300)
      ok(await page.locator('[data-testid=settings]').getAttribute('data-collapsed') === '1', F('large title did not collapse on scroll'))
      ok(+(await page.locator('[data-testid=settings-nav] .nav-title').evaluate((e) => getComputedStyle(e).opacity)) > 0.9, F('inline title not shown after collapse'))
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-settings-scrolled.png' })
      await page.locator('[data-testid=gram-dir-top]').tap(); await page.waitForTimeout(150)
      ok(await page.locator('[data-gram-dir]').getAttribute('data-gram-dir') === 'top', F('gram flip in Settings did not apply'))
      await page.locator('[data-testid=gram-dir-bottom]').tap()
      await page.locator('[data-testid=scheme-light]').tap(); await page.waitForTimeout(200)
      ok(await page.evaluate(() => document.documentElement.dataset.scheme) === 'light', F('appearance override did not switch to light'))
      await page.locator('[data-testid=glass-reduced]').tap(); await page.waitForTimeout(200)
      const red = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.tabbar'), '::before'); return { g: document.documentElement.dataset.glass, bf: s.webkitBackdropFilter || s.backdropFilter, bg: s.backgroundColor } })
      ok(red.g === 'reduced' && !/blur/.test(red.bf), F(`reduced glass still blurs (${JSON.stringify(red)})`))
      await page.locator('[data-testid=tab-live]').tap(); await page.waitForTimeout(800)
      perf.push([`${slug} glass reduced idle`, await rate(page)])
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-light-reduced.png' })
      await page.locator('[data-testid=tab-settings]').tap(); await page.waitForTimeout(200)
      await page.locator('[data-testid=glass-auto]').tap(); await page.locator('[data-testid=scheme-system]').tap()
      await page.locator('[data-testid=tab-plot]').tap(); await page.waitForTimeout(600)
      const pm = await measure(page)
      ok(pm.plot.h > 380 && pm.over === 0, F(`Plot tab not full height (${JSON.stringify(pm.plot)})`))
      await page.screenshot({ path: 'docs/m3-ios-iphone-portrait-plot.png' })
      await page.locator('[data-testid=tab-live]').tap(); await page.waitForTimeout(600)
      ok(await page.evaluate(() => { const c = document.querySelector('[data-testid=lofar]'); return c && c.clientHeight > 100 && !c.getContext('webgl2').isContextLost() }), F('gram not alive after tab round trip'))
    }
    if (slug === 'desktop') {
      // HORZ: off by default; on → hairline across the gram at the hover row with a Zulu label at the edge; persisted.
      const horz = page.locator('[data-testid=horz-tool]')
      ok(await horz.getAttribute('aria-pressed') === 'false', F('HORZ not off by default'))
      const gb = await page.locator('[data-testid=lofar]').boundingBox()
      await page.mouse.move(gb.x + gb.width * 0.4, gb.y + gb.height * 0.4)
      ok(await page.locator('[data-testid=lofar-horz]').count() === 0, F('hairline shown while HORZ off'))
      await horz.click(); await page.mouse.move(gb.x + gb.width * 0.45, gb.y + gb.height * 0.3); await page.mouse.move(gb.x + gb.width * 0.5, gb.y + gb.height * 0.35); await page.waitForTimeout(120)
      ok(await horz.getAttribute('aria-pressed') === 'true', F('HORZ did not toggle on'))
      const hl = await page.locator('[data-testid=lofar-horz] .horz-line').boundingBox()
      ok(hl && Math.abs(hl.y - (gb.y + gb.height * 0.35)) < 2.5 && hl.width >= gb.width - 2, F(`hairline not at the hover row / not full width (${JSON.stringify(hl)} vs y ${gb.y + gb.height * 0.35})`))
      const z = await page.locator('[data-testid=lofar-horz-zulu]').innerText()
      ok(/^\d{6}Z$/.test(z), F(`Zulu label ${z}`))
      ok(await page.locator('[data-testid=lofar-cross]').count() === 0, F('HORZ must not show the crosshair readout'))
      ok(await page.evaluate(() => localStorage.getItem('datum.horz')) === '1', F('HORZ not persisted on'))
      await page.screenshot({ path: 'docs/m3-ios-desktop-horz.png' })
      await page.reload(); await page.waitForSelector('[data-testid=lofar]'); await page.waitForTimeout(1500)
      ok(await page.locator('[data-testid=horz-tool]').getAttribute('aria-pressed') === 'true', F('HORZ did not survive reload'))
      await page.locator('[data-testid=horz-tool]').click(); await page.mouse.move(gb.x + gb.width * 0.5, gb.y + gb.height * 0.5); await page.waitForTimeout(100)
      ok(await page.locator('[data-testid=lofar-horz]').count() === 0 && await page.evaluate(() => localStorage.getItem('datum.horz')) === '0', F('HORZ did not toggle off'))
      ok(await page.locator('button', { hasText: /^CROSS$/ }).count() === 0, F('CROSS still present'))
      perf.push([`${slug} glass full idle`, await rate(page)])
    }
    ok(!errs.length, F(`console errors: ${errs.slice(0, 3).join(' | ')}`))
    await ctx.close()
  }
  await browser.close()
} finally { try { if (srv) process.kill(-srv.pid) } catch {} }
for (const [k, r] of perf) console.log(`perf ${k}: ${fmt(r)}`)
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) }
console.log('ios smoke OK')
