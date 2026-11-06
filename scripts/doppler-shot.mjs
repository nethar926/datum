// Doppler ruler smoke (WebKit): iPhone touch placement of f0, f1 2-axis drag with f2 point-mirroring, the S-curve and
// the readout, 44 px handles, no conflict with pinch zoom; desktop mouse placement + drag, arrow nudge, Esc clear;
// frame pacing during a drag; no console errors. Run after `npm run build`. Saves docs/m3-doppler-*.png and
// docs/m3-dopfix-{iphone,desktop}-drag.png.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
const port = Number(process.env.PORT) || 4188
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
function startSrv() {
  return spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
}
async function waitReady(ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://localhost:${port}/datum/`); if (r.ok || r.status === 304) return true } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
let srv = startSrv()
try {
  if (!(await waitReady())) { console.error('preview failed to start'); process.exit(2) }
  const browser = await webkit.launch()
  for (const [slug, dev] of [['iphone', 'iPhone 15'], ['desktop', 'Desktop Safari']]) {
    const ctx = await browser.newContext({ ...devices[dev] }), page = await ctx.newPage(), errs = []
    const touchy = slug === 'iphone'
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => { try { localStorage.removeItem('datum.band'); localStorage.removeItem('datum.gram'); localStorage.removeItem('datum.gramDir') } catch {} })
    // RES 2 (0.0625 Hz bins, 64 Hz band): fine enough that a ~10 kt shift spans pixels once zoomed in.
    try { await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=2`) } catch (e) {
      console.warn(`${slug}: goto failed, restarting preview`, e.message)
      try { process.kill(-srv.pid) } catch {}
      srv = startSrv(); if (!(await waitReady())) throw e
      await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=2`)
    }
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(8000)
    const F = (m) => `${slug}: ${m}`
    const box = { ...(await cv.boundingBox()) }
    const pt = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
    const touch = (sel, type, id, p) => page.locator(sel).dispatchEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: p.x, clientY: p.y, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
    const span = async () => { const t = await page.locator('.panel-head .readout').first().innerText(); const m = t.match(/([\d.]+)–([\d.]+) HZ/); return m ? +m[2] - +m[1] : NaN }
    const s0 = await span()
    // Zoom in to a few Hz (pinch on the phone, wheel on desktop): the ruler must not get in the way of either.
    if (touchy) {
      for (let r = 0; r < 4; r++) {
        const a = pt(0.47, 0.5), b = pt(0.53, 0.5)
        await touch('[data-testid=lofar]', 'pointerdown', 1, a); await touch('[data-testid=lofar]', 'pointerdown', 2, b)
        for (let k = 1; k <= 6; k++) { await touch('[data-testid=lofar]', 'pointermove', 1, { x: a.x - k * 25, y: a.y }); await touch('[data-testid=lofar]', 'pointermove', 2, { x: b.x + k * 25, y: b.y }) }
        await touch('[data-testid=lofar]', 'pointerup', 1, a); await touch('[data-testid=lofar]', 'pointerup', 2, b); await page.waitForTimeout(120)
      }
    } else { await page.mouse.move(pt(0.5, 0.5).x, pt(0.5, 0.5).y); for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40) } }
    const s1 = await span()
    console.log(`${slug}: view span ${s0} → ${s1} Hz`)
    ok(s1 < s0 / 4, F(`zoom did not narrow the view (${s0} → ${s1})`))
    // Tool on; pause so handle positions don't scroll between reads.
    const dopBtn = page.locator('[data-testid=dop-tool]')
    await dopBtn.evaluate((b) => b.scrollIntoView({ inline: 'center' }))
    const bb = await dopBtn.boundingBox(); ok(!touchy || (bb && bb.width >= 44 && bb.height >= 44), F(`DOP button < 44 (${JSON.stringify(bb)})`))
    if (touchy) await dopBtn.tap(); else await dopBtn.click()
    ok(/PLACE F0/.test(await page.locator('[data-testid=dop-readout]').innerText()), F('no placement prompt'))
    await page.getByRole('button', { name: 'Pause' }).first().click()
    await page.waitForTimeout(300)
    Object.assign(box, await cv.boundingBox()) // re-measure: the tools row / readout may have reflowed
    const p0 = pt(0.45, touchy ? 0.45 : 0.55)
    if (touchy) await page.touchscreen.tap(p0.x, p0.y); else await page.mouse.click(p0.x, p0.y)
    await page.waitForTimeout(250)
    const H = async (k) => page.locator(`[data-testid=dop-${k}]`).evaluate((e) => { const r = e.getBoundingClientRect(); return { x: +e.dataset.x, y: +e.dataset.y, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, vis: getComputedStyle(e).display !== 'none', sel: e.dataset.sel, unlinked: e.dataset.unlinked } })
    let [h0, h1, h2] = [await H('f0'), await H('f1'), await H('f2')]
    const _dir0 = await page.evaluate(() => document.querySelector('[data-testid=lofar-frame]')?.getAttribute('data-dir')); console.log(`${slug}: dir=${_dir0} placed f0 ${JSON.stringify(h0)} f1 ${JSON.stringify(h1)} f2 ${JSON.stringify(h2)}`)
    ok(h0.vis && h1.vis && h2.vis, F('handles not all visible after placement'))
    ok(Math.abs(h0.cx - p0.x) < 14 && Math.abs(h0.cy - p0.y) < 14, F(`f0 not under the tap (${h0.cx},${h0.cy} vs ${p0.x},${p0.y})`))
    for (const h of [h0, h1, h2]) ok(h.w >= 44 && h.h >= 44, F(`handle < 44 px (${h.w}×${h.h})`))
    // Default newest-at-bottom: approach (older) is ABOVE f0; receding is BELOW.
    const dir = await page.evaluate(() => document.querySelector('[data-testid=lofar-frame]')?.getAttribute('data-dir'))
    ok(dir === 'bottom', F(`expected default dir=bottom, got ${dir}`))
    // Prefer dataset y (gram-local) — approach (older) is above f0 when newest is at the bottom.
    ok(h1.x > h0.x && h1.y < h0.y && h2.x < h0.x && h2.y > h0.y, F(`f1 not upper-right (approach) / f2 not lower-left (receding) under newest-at-bottom (f0=${h0.y} f1=${h1.y} f2=${h2.y})`))
    const r0 = await page.locator('[data-testid=dop-readout]').innerText()
    console.log(`${slug}: readout after place: ${r0}`)
    ok(/DOP F0 [\d.]+ HZ +ΔF ±[\d.]+ HZ +10\.0 KT +CPA T[+-]\d\d:\d\d +R≈[\d.]+ KM/.test(r0), F(`readout after place: ${r0}`))
    // 2-axis f1 drag: pure horizontal first (X must move; previously looked locked to the f0 column at coarse spans),
    // then diagonal up-left so f2 mirrors down-right. Measure frame pacing on the diagonal.
    const rate = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 1500) requestAnimationFrame(f); else res((n * 1000) / (t - t0)) }; requestAnimationFrame(f) }))
    const idle = await rate()
    const dragTo = async (from, to, id = 7) => {
      let worst = 0
      if (touchy) {
        await touch('[data-testid=dop-f1]', 'pointerdown', id, from)
        for (let k = 1; k <= 30; k++) {
          await touch('[data-testid=dop-f1]', 'pointermove', id, { x: from.x + (to.x - from.x) * k / 30, y: from.y + (to.y - from.y) * k / 30 })
          if (k % 6 === 0) { await page.waitForTimeout(20); const [a, b, c] = [await H('f0'), await H('f1'), await H('f2')]; worst = Math.max(worst, Math.abs(c.x - (2 * a.x - b.x)), Math.abs(c.y - (2 * a.y - b.y))) }
        }
        await touch('[data-testid=dop-f1]', 'pointerup', id, to)
      } else {
        await page.mouse.move(from.x, from.y); await page.mouse.down()
        for (let k = 1; k <= 30; k++) {
          await page.mouse.move(from.x + (to.x - from.x) * k / 30, from.y + (to.y - from.y) * k / 30)
          if (k % 6 === 0) { await page.waitForTimeout(20); const [a, b, c] = [await H('f0'), await H('f1'), await H('f2')]; worst = Math.max(worst, Math.abs(c.x - (2 * a.x - b.x)), Math.abs(c.y - (2 * a.y - b.y))) }
        }
        await page.mouse.up()
      }
      return worst
    }
    // Horizontal: move f1 further right in frequency (same Y). Must actually change dataset.x.
    const xFrom = { x: h1.cx, y: h1.cy }, xTo = { x: h1.cx + 40, y: h1.cy }
    const horizMirror = await dragTo(xFrom, xTo, 6)
    await page.waitForTimeout(100)
    const hHoriz = await H('f1'), h0h = await H('f0'), h2h = await H('f2')
    console.log(`${slug}: after horizontal drag f1.x ${h1.x} → ${hHoriz.x} (Δ ${(hHoriz.x - h1.x).toFixed(1)} px)`)
    ok(hHoriz.x - h1.x > 8, F(`f1 did not move horizontally (Δx=${(hHoriz.x - h1.x).toFixed(2)})`))
    ok(Math.abs(hHoriz.y - h1.y) < 3, F(`f1 Y drifted on a horizontal drag (${h1.y} → ${hHoriz.y})`))
    ok(horizMirror < 1.5, F(`f2 did not mirror f1 on horizontal drag (${horizMirror.toFixed(2)} px)`))
    ok(Math.abs(h2h.x - (2 * h0h.x - hHoriz.x)) < 1.5 && Math.abs(h2h.y - (2 * h0h.y - hHoriz.y)) < 1.5, F('f2 not mirrored after horizontal drag'))
    // Diagonal: up and left from here → f2 down and right.
    const from = { x: hHoriz.cx, y: hHoriz.cy }, to = { x: hHoriz.cx - 35, y: hHoriz.cy - (touchy ? 18 : 30) }
    let worstMirror = 0
    const dragFps = rate()
    worstMirror = await dragTo(from, to, 7)
    const fps = await dragFps
    console.log(`${slug}: ${idle.toFixed(1)} fps idle, ${fps.toFixed(1)} fps while dragging; worst mirror error ${worstMirror.toFixed(2)} px`)
    ok(fps >= idle * 0.8, F(`fps dropped while dragging (${fps.toFixed(1)} vs ${idle.toFixed(1)})`))
    ok(worstMirror < 1.5, F(`f2 did not mirror f1 during the drag (${worstMirror.toFixed(2)} px)`))
    await page.waitForTimeout(150);
    [h0, h1, h2] = [await H('f0'), await H('f1'), await H('f2')]
    ok(Math.abs(h1.cx - to.x) < 4 && Math.abs(h1.cy - to.y) < 4, F(`f1 not under the finger after the drag (${h1.cx},${h1.cy} vs ${to.x},${to.y})`))
    ok(h1.x < hHoriz.x && h1.y < hHoriz.y, F(`f1 did not move up-left (${hHoriz.x},${hHoriz.y} → ${h1.x},${h1.y})`))
    ok(h2.x > h2h.x && h2.y > h2h.y, F(`f2 did not mirror down-right (${h2h.x},${h2h.y} → ${h2.x},${h2.y})`))
    ok(Math.abs(h0.cx - p0.x) < 2, F('f0 moved during the f1 drag'))
    await page.screenshot({ path: `docs/m3-dopfix-${slug}-drag.png` })
    const r1 = await page.locator('[data-testid=dop-readout]').innerText()
    const kt = (t) => parseFloat(/([\d.]+) KT/.exec(t)?.[1] ?? 'NaN'), km = (t) => parseFloat(/R≈([\d.]+) KM/.exec(t)?.[1] ?? 'NaN')
    console.log(`${slug}: readout after drag: ${r1}`)
    // After up-left we may have reduced |Δf|/|Δt| relative to the horizontal push; just require a finite readout.
    ok(/DOP F0/.test(r1) && Number.isFinite(kt(r1)) && Number.isFinite(km(r1)), F(`readout after drag: ${r1}`))
    // Curve: drawn, continuous, and through the three handles (canvas alpha at and between the points).
    const curve = await page.locator('[data-testid=dop-curve]').evaluate((c, hs) => {
      const g = c.getContext('2d'), r = c.getBoundingClientRect(), sx = c.width / r.width, sy = c.height / r.height
      const lit = (x, y) => { const d = g.getImageData(Math.round((x - r.left) * sx) - 3, Math.round((y - r.top) * sy) - 3, 7, 7).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true; return false }
      const rows = []; for (let y = 0; y < c.height; y += 4) { const d = g.getImageData(0, y, c.width, 1).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; rows.push(n) }
      return { r: [r.top, r.bottom], at: hs.map((h) => h.cy > r.top + 4 && h.cy < r.bottom - 4 ? lit(h.cx, h.cy) : 'offscreen'), litRows: rows.filter((n) => n > 0).length / rows.length }
    }, [h0, h1, h2])
    console.log(`${slug}: curve through handles ${curve.at} rect ${curve.r} handles ${[h0.cy, h1.cy, h2.cy]}, lit rows ${curve.litRows.toFixed(2)}`)
    ok(curve.at.every((v) => v !== false) && curve.at.filter((v) => v === true).length >= 2, F(`curve misses a handle (${curve.at})`))
    ok(curve.litRows > 0.9, F(`curve not continuous over the window (${curve.litRows.toFixed(2)})`))
    await page.screenshot({ path: `docs/m3-doppler-${slug}-ruler.png` })
    if (touchy) {
      // Dragging f2 mirrors f1 (stays linked); tools stay mutually exclusive with HARM.
      const a = { x: h2.cx, y: h2.cy }, bTarget = { x: h2.cx - 20, y: h2.cy + 12 }
      const f1Before = await H('f1')
      await touch('[data-testid=dop-f2]', 'pointerdown', 8, a)
      for (let k = 1; k <= 12; k++) await touch('[data-testid=dop-f2]', 'pointermove', 8, { x: a.x + (bTarget.x - a.x) * k / 12, y: a.y + (bTarget.y - a.y) * k / 12 })
      await touch('[data-testid=dop-f2]', 'pointerup', 8, bTarget); await page.waitForTimeout(150)
      const u2 = await H('f2'), u1 = await H('f1'), u0 = await H('f0'), ru = await page.locator('[data-testid=dop-readout]').innerText()
      ok(u2.unlinked === '0' && !/F2 UNLINKED/.test(ru), F(`f2 drag unlinked (${ru})`))
      ok(Math.abs(u1.x - (2 * u0.x - u2.x)) < 1.5 && Math.abs(u1.y - (2 * u0.y - u2.y)) < 1.5, F('f1 did not mirror f2'))
      ok(Math.abs(u1.x - f1Before.x) > 2 || Math.abs(u1.y - f1Before.y) > 2, F('f1 did not move when f2 was dragged'))
      await page.screenshot({ path: `docs/m3-doppler-${slug}-unlinked.png` }) // keep legacy filename for the f2-drag shot
      const b0 = u0
      await page.getByRole('button', { name: 'HARM', exact: true }).tap()
      ok(await dopBtn.getAttribute('aria-pressed') === 'false', F('HARM did not disarm DOP (tools must be exclusive)'))
      const hp = pt(0.2, 0.7); await page.touchscreen.tap(hp.x, hp.y); await page.waitForTimeout(150)
      ok(/F0 [\d.]+ HZ/.test(await page.locator('[data-testid=harm-readout]').innerText()), F('HARM did not take a tap with the ruler shown'))
      ok((await H('f0')).cx === b0.cx, F('HARM tap moved the ruler'))
      await dopBtn.tap()
      ok(await page.getByRole('button', { name: 'HARM', exact: true }).getAttribute('aria-pressed') === 'false' && await dopBtn.getAttribute('aria-pressed') === 'true', F('DOP did not disarm HARM'))
    } else {
      // Arrow nudge (selected handle f1): Shift+Right = 10 px in frequency, Up = 1 s later.
      const b = await H('f1')
      await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(100)
      const n1 = await H('f1'), n2 = await H('f2')
      console.log(`${slug}: nudge f1 x ${b.x} → ${n1.x}`)
      ok(Math.abs(n1.x - b.x - 10) < 1, F(`Shift+→ did not move f1 10 px (${b.x} → ${n1.x})`))
      ok(Math.abs(n2.x - (2 * (await H('f0')).x - n1.x)) < 1.5, F('f2 did not mirror the nudge'))
      await page.keyboard.press('ArrowUp'); await page.waitForTimeout(100)
      ok((await H('f1')).y < n1.y, F('↑ did not move f1 later (up)'))
      await page.screenshot({ path: `docs/m3-doppler-${slug}-nudged.png` })
      // CTR f0 (center branch planner): the view recentres on f0.
      const f0hz = parseFloat(/F0 ([\d.]+) HZ/.exec(await page.locator('[data-testid=dop-readout]').innerText())[1])
      await page.locator('[data-testid=dop-center]').click(); await page.waitForTimeout(400)
      const rng = /([\d.]+)–([\d.]+) HZ/.exec(await page.locator('.panel-head .readout').first().innerText())
      const mid = (+rng[1] + +rng[2]) / 2
      console.log(`${slug}: CTR f0 ${f0hz} → view mid ${mid.toFixed(3)}`)
      ok(Math.abs(mid - f0hz) < 0.05 * (+rng[2] - +rng[1]) + 0.01, F(`CTR f0 did not center (${f0hz} vs ${mid})`))
      ok(Math.abs((await H('f0')).cx - (box.x + box.width / 2)) < box.width * 0.06, F('f0 handle not near the middle after CTR f0'))
      await page.keyboard.press('Escape'); await page.waitForTimeout(150)
      ok(/PLACE F0/.test(await page.locator('[data-testid=dop-readout]').innerText()) && !(await H('f0')).vis, F('Esc did not clear'))
    }
    // Touch targets on the tools row (phone: touch-first; desktop keeps its compact header).
    if (touchy) { const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=gram-tools] button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length)
    ok(!small, F(`${small} tools-row targets < 44`)) }
    ok(!errs.length, F(`console errors: ${errs.join(' | ')}`))
    await ctx.close(); console.log(slug, 'done')
  }

  // Newest-at-top (legacy): approach below f0 — desktop only, quick placement check.
  {
    const ctx = await browser.newContext({ ...devices['Desktop Safari'] }), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.addInitScript(() => { try { localStorage.setItem('datum.gramDir', 'top'); localStorage.removeItem('datum.band') } catch {} })
    try { await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=2`) } catch (e) {
      console.warn('top-dir: goto failed, restarting preview', e.message)
      try { process.kill(-srv.pid) } catch {}
      srv = startSrv(); if (!(await waitReady())) throw e
      await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=2`)
    }
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(5000)
    ok((await page.evaluate(() => document.querySelector('[data-testid=lofar-frame]')?.getAttribute('data-dir'))) === 'top', 'top-dir: data-dir not top')
    { const bb = await cv.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40) } }
    await page.locator('[data-testid=dop-tool]').click()
    await page.getByRole('button', { name: 'Pause' }).first().click(); await page.waitForTimeout(200)
    const box = await cv.boundingBox()
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55)
    await page.waitForTimeout(250)
    const H = async (k) => page.locator(`[data-testid=dop-${k}]`).evaluate((e) => ({ x: +e.dataset.x, y: +e.dataset.y, vis: getComputedStyle(e).display !== 'none' }))
    const [h0, h1, h2] = [await H('f0'), await H('f1'), await H('f2')]
    ok(h0.vis && h1.vis && h2.vis, 'top-dir: handles not visible')
    ok(h1.y > h0.y && h2.y < h0.y, `top-dir: f1 should be below f0 (got f0=${h0.y} f1=${h1.y} f2=${h2.y})`)
    // 2-axis f1 drag under newest-at-top: right + up; f2 must point-mirror about f0 throughout.
    const HB = async (k) => page.locator(`[data-testid=dop-${k}]`).evaluate((e) => { const r = e.getBoundingClientRect(); return { x: +e.dataset.x, y: +e.dataset.y, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } })
    const b1 = await HB('f1'), from = { x: b1.cx, y: b1.cy }, to = { x: b1.cx + 30, y: b1.cy - 20 }
    let worst = 0
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    for (let k = 1; k <= 20; k++) {
      await page.mouse.move(from.x + (to.x - from.x) * k / 20, from.y + (to.y - from.y) * k / 20)
      if (k % 5 === 0) { await page.waitForTimeout(20); const [a, b, c] = [await HB('f0'), await HB('f1'), await HB('f2')]; worst = Math.max(worst, Math.abs(c.x - (2 * a.x - b.x)), Math.abs(c.y - (2 * a.y - b.y))) }
    }
    await page.mouse.up(); await page.waitForTimeout(150)
    const [a0, a1] = [await HB('f0'), await HB('f1')]
    console.log(`top-dir: f1 ${b1.x},${b1.y} → ${a1.x},${a1.y}; worst mirror ${worst.toFixed(2)} px`)
    ok(a1.x - b1.x > 8 && b1.y - a1.y > 8, `top-dir: f1 did not follow a right+up drag (${b1.x},${b1.y} → ${a1.x},${a1.y})`)
    ok(Math.abs(a1.cx - to.x) < 4 && Math.abs(a1.cy - to.y) < 4, 'top-dir: f1 not under the pointer after the drag')
    ok(worst < 1.5, `top-dir: f2 did not mirror f1 (${worst.toFixed(2)} px)`)
    ok(Math.abs(a0.y - h0.y) < 1.5, 'top-dir: f0 moved during f1 drag')
    ok(!errs.length, `top-dir errors ${errs.join(' | ')}`)
    await page.screenshot({ path: 'docs/m3-doppler-desktop-topdir.png' })
    await ctx.close(); console.log('top-dir done')
  }

  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('doppler smoke OK')
