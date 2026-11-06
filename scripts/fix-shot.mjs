// FIX cross-fix smoke (WebKit): spaced fixes, CSE/SPD, DYN EVENT, full dock on phone,
// no chrome overlap. Port 4196. Saves docs/m3-fix-iphone-portrait.png + desktop.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4196
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

const VIEWS = [
  ['iphone-portrait', {
    ...devices['iPhone 15'],
    // Explicit 390×844 portrait (CSS px) per review brief.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }],
  ['desktop', {
    viewport: { width: 1440, height: 900 },
    userAgent: devices['Desktop Safari'].userAgent,
    deviceScaleFactor: 1, isMobile: false, hasTouch: false,
  }],
]

const overlaps = (a, b, pad = 0) => !(!a || !b
  || a.x + a.width + pad <= b.x || b.x + b.width + pad <= a.x
  || a.y + a.height + pad <= b.y || b.y + b.height + pad <= a.y)

const fullyIn = (box, vw, vh, inset = 0) => !!box
  && box.x >= -0.5 + inset
  && box.y >= -0.5 + inset
  && box.x + box.width <= vw + 0.5 - inset
  && box.y + box.height <= vh + 0.5 - inset

const driveFixes = async (page) => page.evaluate(() => {
  const store = window.__datumFix
  const tac = window.__datumTactical
  if (!store) return { err: 'no-store' }
  if (!tac?.buoys) return { err: 'no-tactical' }
  const difars = tac.buoys.filter((b) => b.kind === 'difar' && b.state === 'live')
  if (difars.length < 2) return { err: `need-2-difar got ${difars.length}` }
  const pickPair = (list) => {
    let best = [list[0], list[1]], bestD = -1
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const dist = Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y)
      if (dist > bestD) { bestD = dist; best = [list[i], list[j]] }
    }
    return { a: best[0], b: best[1], base: bestD }
  }
  const { a, b, base } = pickPair(difars)
  store.reset()
  store.setArmed(true)
  store.newTrack()
  const spdKts = 10, dt = 300
  const spdMps = spdKts * 1852 / 3600
  const ux = (b.x - a.x) / base, uy = (b.y - a.y) / base
  const px = -uy, py = ux
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const origin = { x: mid.x + px * 4000 - ux * spdMps * dt, y: mid.y + py * 4000 - uy * spdMps * dt }
  const brgTo = (buoy, x, y) => {
    const dx = x - buoy.x, dy = y - buoy.y
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  }
  const results = []
  for (let i = 0; i < 3; i++) {
    const tS = 100 + i * dt
    const x = origin.x + ux * spdMps * (i * dt)
    const y = origin.y + uy * spdMps * (i * dt)
    const r = store.layFix(
      { [a.id]: brgTo(a, x, y), [b.id]: brgTo(b, x, y) },
      { [a.id]: tS, [b.id]: tS },
      tac.buoys, tS,
    )
    results.push(r.ok ? { ok: true, tag: r.fix.tag } : { ok: false, reason: r.reason })
  }
  return {
    results, fit: store.activeFit(), nFixes: store.fixes.length,
    tags: store.fixes.map((f) => f.tag), trackTag: store.tracks[0]?.tag,
  }
})

const afterDyn = async (page) => page.evaluate(() => {
  const store = window.__datumFix
  const tac = window.__datumTactical
  const difars = tac.buoys.filter((b) => b.kind === 'difar' && b.state === 'live')
  const pickPair = (list) => {
    let best = [list[0], list[1]], bestD = -1
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const dist = Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y)
      if (dist > bestD) { bestD = dist; best = [list[i], list[j]] }
    }
    return { a: best[0], b: best[1], base: bestD }
  }
  const { a, b, base } = pickPair(difars)
  const spdKts = 10, dt = 300
  const spdMps = spdKts * 1852 / 3600
  const ux = (b.x - a.x) / base, uy = (b.y - a.y) / base
  const px = -uy, py = ux
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const origin = { x: mid.x + px * 4000 - ux * spdMps * dt, y: mid.y + py * 4000 - uy * spdMps * dt }
  const brgTo = (buoy, x, y) => {
    const dx = x - buoy.x, dy = y - buoy.y
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  }
  store.dynEvent()
  const laid = []
  for (let i = 3; i < 5; i++) {
    const tS = 100 + i * dt
    const x = origin.x + ux * spdMps * (i * dt)
    const y = origin.y + uy * spdMps * (i * dt)
    const r = store.layFix(
      { [a.id]: brgTo(a, x, y), [b.id]: brgTo(b, x, y) },
      { [a.id]: tS, [b.id]: tS },
      tac.buoys, tS,
    )
    laid.push(r.ok ? { ok: true, tag: r.fix.tag } : { ok: false, reason: r.reason })
  }
  const all = store.all()
  return {
    laid, nFixes: all.fixes.length,
    closedLegs: all.legs.filter((l) => l.closed).length,
    openLegFixes: all.legs.find((l) => !l.closed)?.fixIds.length ?? 0,
    fit: store.activeFit(),
  }
})

const FIX_CONTROLS = [
  'fix-lay', 'fix-dyn', 'fix-undo', 'fix-clear', 'fix-tracks', 'fix-new-track', 'fix-done', 'fix-leg-readout',
]

await startSrv()
const browser = await webkit.launch()
try {
  for (const [name, device] of VIEWS) {
    const ctx = await browser.newContext(device)
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await dismissSplash(page)
    await page.waitForSelector('[data-testid=tactical]', { timeout: 30000 })
    await page.waitForTimeout(3500)
    await page.waitForFunction(() => !!window.__datumTactical?.buoys?.length, { timeout: 10000 }).catch(() => null)

    const vw = page.viewportSize()?.width ?? 0
    const vh = page.viewportSize()?.height ?? 0
    ok(vw > 0 && vh > 0, `${name}: no viewport`)

    // FIX pinned — reachable without scrolling.
    const fixTool = page.locator('[data-testid=fix-tool]')
    ok(await fixTool.count() === 1, `${name}: FIX tool missing`)
    const toolBox = await fixTool.boundingBox()
    ok(fullyIn(toolBox, vw, vh), `${name}: FIX tool not fully in viewport`)
    if (device.isMobile || device.hasTouch) await fixTool.tap()
    else await fixTool.click()
    await page.waitForTimeout(250)
    ok(await page.evaluate(() => !!window.__datumFix?.armed), `${name}: FIX not armed`)
    ok(await page.locator('[data-testid=fix-bar]').count() === 1, `${name}: fix-bar missing`)
    // Tab bar hidden while armed (full-width dock).
    ok(await page.locator('[data-testid=tabbar]').count() === 0, `${name}: tab bar still visible while FIX armed`)
    ok(await page.locator('[data-testid=gram-tools]').count() === 0, `${name}: gram-tools still visible`)

    const driven = await driveFixes(page)
    console.log(name, 'driven', JSON.stringify(driven))
    ok(!driven.err, `${name}: drive err ${driven.err}`)
    ok((driven.nFixes ?? 0) >= 3, `${name}: expected ≥3 fixes got ${driven.nFixes}`)
    ok(driven.fit && Number.isFinite(driven.fit.cseDeg), `${name}: CSE missing`)
    ok(driven.fit && Math.abs(driven.fit.spdKts - 10) < 0.5, `${name}: SPD off ${driven.fit?.spdKts}`)
    ok(Array.isArray(driven.tags) && driven.tags.join(',') === '1,2,3', `${name}: short tags ${driven.tags}`)

    await page.waitForSelector('[data-testid=fix-leg-readout]', { timeout: 5000 })
    await page.waitForFunction(() => /CSE/.test(document.querySelector('[data-testid=fix-leg-readout]')?.textContent || ''), { timeout: 5000 }).catch(() => null)
    const readoutText = await page.locator('[data-testid=fix-leg-readout]').innerText()
    ok(/CSE/.test(readoutText) && /SPD/.test(readoutText) && /°T/.test(readoutText), `${name}: readout "${readoutText}"`)

    // Every FIX control + CSE fully inside viewport; no mutual / pattern-row intersections.
    const boxes = {}
    for (const id of FIX_CONTROLS) {
      const loc = page.locator(`[data-testid=${id}]`).first()
      ok(await loc.count() >= 1, `${name}: missing ${id}`)
      const box = await loc.boundingBox()
      boxes[id] = box
      ok(fullyIn(box, vw, vh), `${name}: ${id} not fully in viewport ${JSON.stringify(box)} vw=${vw} vh=${vh}`)
      // DYN must show its label (not icon-only).
      if (id === 'fix-dyn') {
        const txt = await loc.innerText()
        ok(/DYN/i.test(txt), `${name}: DYN not labeled ("${txt}")`)
      }
    }
    const layersBox = await page.locator('[data-testid=layers-open]').boundingBox()
    const ringBox = await page.locator('[data-testid=ring-scale]').boundingBox()
    const acBox = await page.locator('[data-testid=ac-readout]').boundingBox()
    const patternBox = await page.locator('[data-testid=pattern-row]').boundingBox()
    const barBox = await page.locator('[data-testid=fix-bar]').boundingBox()
    const legBox = boxes['fix-leg-readout']

    ok(!overlaps(barBox, layersBox), `${name}: FIX bar overlaps layers`)
    ok(!overlaps(barBox, ringBox), `${name}: FIX bar overlaps ring-scale`)
    ok(!overlaps(barBox, acBox), `${name}: FIX bar overlaps A/C`)
    ok(!overlaps(legBox, layersBox), `${name}: CSE overlaps layers`)
    ok(!overlaps(legBox, ringBox), `${name}: CSE overlaps ring-scale`)
    ok(!overlaps(legBox, patternBox), `${name}: CSE overlaps pattern row`)
    ok(!overlaps(barBox, patternBox), `${name}: FIX bar overlaps pattern row`)
    // Controls don't overlap each other (skip tracks containing new-track).
    const peerIds = ['fix-lay', 'fix-dyn', 'fix-undo', 'fix-clear', 'fix-done', 'fix-leg-readout']
    for (let i = 0; i < peerIds.length; i++) {
      for (let j = i + 1; j < peerIds.length; j++) {
        ok(!overlaps(boxes[peerIds[i]], boxes[peerIds[j]]), `${name}: ${peerIds[i]} overlaps ${peerIds[j]}`)
      }
    }

    // Phone: full-plot shot — Done, re-open Plot tab, re-arm (tab bar visible only when disarmed).
    if (name === 'iphone-portrait') {
      await page.locator('[data-testid=fix-done]').tap()
      await page.waitForTimeout(200)
      await page.locator('[data-testid=tab-plot]').tap()
      await page.waitForTimeout(400)
      await page.locator('[data-testid=fix-tool-plot]').tap()
      await page.waitForTimeout(200)
      // Re-drive so CSE/SPD + marks are present on the Plot tab.
      await driveFixes(page)
      await page.waitForSelector('[data-testid=fix-leg-readout]', { timeout: 5000 })
      await page.waitForTimeout(200)
      // Re-check controls still fully on-screen on Plot tab.
      for (const id of ['fix-lay', 'fix-dyn', 'fix-undo', 'fix-clear', 'fix-tracks', 'fix-new-track', 'fix-done', 'fix-leg-readout']) {
        const box = await page.locator(`[data-testid=${id}]`).first().boundingBox()
        ok(fullyIn(box, vw, vh), `${name}/plot: ${id} not fully in viewport ${JSON.stringify(box)}`)
      }
      const leg2 = await page.locator('[data-testid=fix-leg-readout]').boundingBox()
      const pat2 = await page.locator('[data-testid=pattern-row]').boundingBox()
      ok(!overlaps(leg2, pat2), `${name}/plot: CSE overlaps pattern row`)
    }
    await page.evaluate(() => window.__datumFix?.clearFlash?.())
    await page.waitForTimeout(80)
    await page.screenshot({ path: `docs/m3-fix-${name === 'iphone-portrait' ? 'iphone-portrait' : 'desktop'}.png` })
    console.log('shot', name)

    // Parallel reject toast after the shot.
    await page.evaluate(() => {
      const store = window.__datumFix
      const tac = window.__datumTactical
      const difars = tac.buoys.filter((b) => b.kind === 'difar' && b.state === 'live')
      store.layFix({ [difars[0].id]: 40, [difars[1].id]: 45 }, { [difars[0].id]: 9999, [difars[1].id]: 9999 }, tac.buoys, 9999)
    })
    await page.waitForTimeout(120)
    const flashBox = await page.locator('[data-testid=fix-flash]').boundingBox().catch(() => null)
    ok(!!flashBox, `${name}: parallel toast missing`)
    if (flashBox) {
      ok(fullyIn(flashBox, vw, vh), `${name}: toast not fully in viewport`)
      ok(!overlaps(flashBox, layersBox), `${name}: toast overlaps layers`)
      ok(!overlaps(flashBox, acBox), `${name}: toast overlaps A/C`)
      ok(!overlaps(flashBox, ringBox), `${name}: toast overlaps ring-scale`)
      ok(!overlaps(flashBox, patternBox), `${name}: toast overlaps pattern row`)
    }

    const dyn = await afterDyn(page)
    console.log(name, 'dyn', JSON.stringify(dyn))
    ok((dyn.closedLegs ?? 0) >= 1, `${name}: expected closed leg`)
    ok((dyn.openLegFixes ?? 0) >= 2, `${name}: expected ≥2 on new leg`)
    ok(dyn.fit && Number.isFinite(dyn.fit.cseDeg), `${name}: post-DYN CSE missing`)

    ok(!errs.length, `${name}: page errors ${errs.join(' | ')}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}
if (fails.length) { console.error('FAILS\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('fix-shot OK')
