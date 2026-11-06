// Manual sonobuoy drop smoke (WebKit): PREPLAN / AUTO / MANUAL field modes and the drop palette on the tactical plot.
// Desktop (mouse), iPad and iPhone (touch pointers): places every pattern (line, circle, wedge by drag; field and
// single by tap; field with the count stepper), checks the ghost readout before confirming, that the buoys land on
// the plot and get gram streams (channel buttons + rows on a dropped buoy, older history kept), a manual drop while
// AUTO is active, Escape / MANUAL-sticky behaviour, 44 px targets, frame pacing during a drag and no console errors.
// Run after `npm run build`. Saves docs/m3-drop-*.png.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
const port = Number(process.env.PORT) || 4186
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
const SPAN_M = 18000, MAX = 32
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()
  for (const [slug, opts, touch] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }, false],
    ['ipad', devices['iPad Pro 11 landscape'], true],
    ['iphone', devices['iPhone 15'], true],
    ['iphone-land', devices['iPhone 15 landscape'], true],
  ]) {
    const ctx = await browser.newContext(opts), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16`)
    const plot = page.locator('[data-testid=tactical]'), bar = page.locator('[data-testid=drop-bar]')
    await plot.waitFor(); await page.waitForTimeout(5000)
    // Phone landscape: the tactical plot is a slide-over behind the TAC button.
    if (slug === 'iphone-land') { await page.locator('[data-testid=tac-open]').tap(); await page.waitForTimeout(400) }
    // Let the 160–180 ms appear transitions finish so the shot shows the settled UI.
    const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: `docs/m3-drop-${slug}-${name}.png` }) }
    const count = async () => parseInt((await page.locator('[data-testid=buoy-count]').textContent()) ?? 'NaN')
    const phase = () => bar.getAttribute('data-phase')
    const hint = () => page.locator('[data-testid=drop-hint]').innerText().catch(() => '')
    const readout = () => page.locator('[data-testid=drop-readout]').innerText().catch(() => '')
    const btn = (sel) => page.locator(`[data-testid=drop-bar] ${sel}`)
    const press = (loc) => (touch ? loc.tap() : loc.click())
    const waitCount = (pred, what) => page.waitForFunction(([n, op]) => { const v = parseInt(document.querySelector('[data-testid=buoy-count]')?.textContent ?? 'NaN'); return op === 'eq' ? v === n : v > n }, pred, { timeout: 6000 }).then(() => true, () => { fails.push(`${slug}: ${what} (count ${pred[1] === 'eq' ? '≠' : '≤'} ${pred[0]})`); return false })
    // World metres → client px (the plot fits SPAN_M across its short side, centred on 0,0; y north).
    const at = async (x, y) => { const b = await plot.boundingBox(), mpp = SPAN_M / Math.min(b.width, b.height); return [b.x + b.width / 2 + x / mpp, b.y + b.height / 2 - y / mpp] }
    const pointer = (type, [x, y]) => page.evaluate(([type, x, y]) => {
      document.querySelector('[data-testid=tactical]').dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }))
    }, [type, x, y])
    /** Press at a (world m), optionally drag to b, screenshot mid-drag, release. */
    const gesture = async (a, b, midShot) => {
      const p0 = await at(...a), p1 = b ? await at(...b) : p0
      if (!touch) {
        await page.mouse.move(...p0); await page.mouse.down()
        if (b) await page.mouse.move(...p1, { steps: 12 })
        if (midShot) await shot(midShot)
        await page.mouse.up(); return
      }
      await pointer('pointerdown', p0)
      if (b) for (let k = 1; k <= 12; k++) { await pointer('pointermove', [p0[0] + (p1[0] - p0[0]) * k / 12, p0[1] + (p1[1] - p0[1]) * k / 12]); await page.waitForTimeout(16) }
      if (midShot) { await page.waitForTimeout(50); await shot(midShot) }
      await pointer('pointerup', p1)
    }
    const targets = async (where) => {
      const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=drop-bar] button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.getAttribute('aria-label') ?? b.textContent, Math.round(r.width), Math.round(r.height)] }).filter(([, w, h]) => w < 44 || h < 44))
      ok(!small.length, `${slug}/${where}: drop targets < 44 px ${JSON.stringify(small)}`)
    }
    const arm = async (p) => { await press(btn(`[data-pattern=${p}]`)); await page.waitForTimeout(350); ok((await phase()) === 'armed' && (await bar.getAttribute('data-pattern')) === p, `${slug}: ${p} not armed (${await phase()})`) }
    /** Arm, place, check the ghost readout, optional count steps, confirm, check the buoys landed. */
    const place = async (p, a, b, re, n, opt = {}) => {
      const before = await count()
      await arm(p)
      await gesture(a, b, opt.mid)
      ok((await phase()) === 'preview', `${slug}/${p}: no preview after gesture (${await phase()})`)
      for (let k = 0; k < (opt.minus ?? 0); k++) await press(page.getByRole('button', { name: 'Fewer buoys' }))
      const r = await readout()
      console.log(`${slug}/${p}: ghost "${r}"`)
      ok(re.test(r), `${slug}/${p}: readout "${r}" !~ ${re}`)
      if (opt.minus) ok((await page.locator('[data-testid=drop-n]').innerText()) === String(n), `${slug}/${p}: stepper shows ${await page.locator('[data-testid=drop-n]').innerText()} not ${n}`)
      ok(await count() === before, `${slug}/${p}: buoys laid before confirm`)
      await targets(`${p} preview`)
      if (opt.shot) await shot(opt.shot)
      await press(page.locator('[data-testid=drop-go]'))
      await waitCount([before + n, 'eq'], `${p}: ${n} buoys not laid`)
      const h = await hint()
      ok(new RegExp(`${p.toUpperCase()} laid · ${n}`).test(h), `${slug}/${p}: toast "${h}"`)
      return before + n
    }

    // Initial state: PREPLAN, nothing armed, the preplanned field of 6.
    ok((await page.locator('[data-testid=field-mode] button[aria-pressed=true]').getAttribute('data-mode')) === 'preplan', `${slug}: field mode not PREPLAN at start`)
    ok((await phase()) === 'idle', `${slug}: drop tool not idle at start`)
    ok(await count() === 6, `${slug}: field count ${await count()} at start`)
    await targets('idle')
    const chans = () => page.locator('[aria-label="Buoy channel"] button').count()

    if (slug === 'desktop') {
      // History survives a drop: the selected buoy's gram stays lit across the stream-set growth.
      const lofarLit = async () => { const png = (await page.locator('[data-testid=lofar]').screenshot()).toString('base64'); return page.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
        const k = document.createElement('canvas'); k.width = img.width; k.height = img.height; const g = k.getContext('2d'); g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, k.width, k.height).data; let rows = 0
        for (let y = 0; y < k.height; y++) { let n = 0; for (let x = 0; x < k.width; x++) { const i = (y * k.width + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 6) n++ } if (n >= k.width * 0.02) rows++ }
        return rows / k.height }, png) }
      const litBefore = await lofarLit()
      // Frame pacing while dragging a ghost, against the same page idle (headless WebKit paces rAF loosely).
      const frames = async (act) => {
        await page.evaluate(() => { window.__fr = []; window.__on = true; let last = performance.now(); const f = (t) => { window.__fr.push(t - last); last = t; if (window.__on) requestAnimationFrame(f) }; requestAnimationFrame(f) })
        await act()
        const fr = await page.evaluate(() => { window.__on = false; return window.__fr.slice(2).sort((a, b) => a - b) })
        return { med: fr[Math.floor(fr.length / 2)] ?? NaN, p90: fr[Math.floor(fr.length * 0.9)] ?? NaN, n: fr.length }
      }
      const idle = await frames(() => page.waitForTimeout(1000))
      await arm('circle')
      const c0 = await at(0, 0), c1 = await at(3000, 3000)
      const drag = await frames(async () => { await page.mouse.move(...c0); await page.mouse.down(); for (let k = 1; k <= 60; k++) { await page.mouse.move(c0[0] + (c1[0] - c0[0]) * k / 60, c0[1] + (c1[1] - c0[1]) * Math.sin(k / 6) * k / 60); await page.waitForTimeout(16) } await page.mouse.up() })
      // Main-thread cost of one drag step (pointer → reducer → planner → ghost), timed in page.
      const per = await page.evaluate(([x, y]) => { const el = document.querySelector('[data-testid=tactical]'); const ev = (t, k) => el.dispatchEvent(new PointerEvent(t, { clientX: x + k, clientY: y + (k % 7), pointerId: 9, pointerType: 'mouse', bubbles: true, buttons: 1 })); ev('pointerdown', 0); const t0 = performance.now(); for (let k = 12; k < 212; k++) ev('pointermove', k); const dt = (performance.now() - t0) / 200; ev('pointerup', 212); return dt }, c0)
      console.log(`${slug}: ${per.toFixed(3)} ms per drag step (main thread)`)
      ok(per < 4, `${slug}: drag step costs ${per} ms`)
      console.log(`${slug}: frame interval idle median ${idle.med.toFixed(1)} / p90 ${idle.p90.toFixed(1)} ms (${idle.n}); ghost drag median ${drag.med.toFixed(1)} / p90 ${drag.p90.toFixed(1)} ms (${drag.n})`)
      ok(drag.med <= Math.max(20, idle.med * 1.5), `${slug}: frame pacing during a ghost drag (median ${drag.med} ms vs idle ${idle.med} ms)`)
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
      let n = await place('line', [-6000, 5000], [1500, 6000], /^LINE · 5 DIFAR · 7\.\d km · 08\d°$/, 5, { mid: 'line-drag', shot: 'line-ghost' })
      n = await place('circle', [4500, -1500], [4500, 1000], /^CIRCLE · 6 OMNI · r 2\.5 km$/, 6, { shot: 'circle-ghost' })
      n = await place('wedge', [-5000, -1000], [-5000, -4000], /^WEDGE · 5 DIFAR · 3\.0 km · opens 180°$/, 5, { shot: 'wedge-ghost' })
      n = await place('field', [5500, 5500], [7000, 7000], /^FIELD · 4 OMNI · 3\.0 km grid · 045°$/, 4, { minus: 5 })
      n = await place('single', [-7000, 1000], null, /^SINGLE · 1 DIFAR · -7\.0E 1\.0N$/, 1)
      ok(n === 27, `${slug}: ${n} buoys after five patterns`)
      ok(await chans() === n, `${slug}: ${await chans()} gram channel buttons for ${n} buoys`)
      // Escape steps back: preview → armed → idle; nothing laid.
      await arm('line'); await gesture([0, 3000], null)
      await page.keyboard.press('Escape'); ok((await phase()) === 'armed', `${slug}: Escape from preview → ${await phase()}`)
      await page.keyboard.press('Escape'); ok((await phase()) === 'idle', `${slug}: Escape from armed → ${await phase()}`)
      ok(await count() === n, `${slug}: Escape laid buoys`)
      // MANUAL keeps the pattern armed after a drop (Enter confirms from the keyboard).
      await press(btn('[data-mode=manual]'))
      await arm('single'); await gesture([-1000, -5000], null)
      await page.keyboard.press('Enter')
      await waitCount([n + 1, 'eq'], 'MANUAL single via Enter'); n++
      ok((await phase()) === 'armed' && (await bar.getAttribute('data-pattern')) === 'single', `${slug}: MANUAL did not stay armed (${await phase()})`)
      await page.keyboard.press('Escape')
      // Gram streams: the newest buoy streams rows; the first buoy kept its history through the drops.
      await page.locator('[aria-label="Buoy channel"] button').last().click()
      await page.waitForTimeout(6000)
      const litNew = await lofarLit()
      await page.locator('[aria-label="Buoy channel"] button').first().click(); await page.waitForTimeout(500)
      const litOld = await lofarLit()
      console.log(`${slug}: LOFAR lit rows: first buoy before ${litBefore.toFixed(3)}, after ${litOld.toFixed(3)}; newest dropped buoy ${litNew.toFixed(3)}`)
      ok(litNew > 0.02, `${slug}: no gram rows on the dropped buoy (${litNew.toFixed(3)})`)
      ok(litOld >= litBefore * 0.9, `${slug}: first buoy's gram history lost on drop (${litBefore.toFixed(3)} → ${litOld.toFixed(3)})`)
      await shot('final')
    } else {
      let n = 6
      if (slug === 'ipad') {
        n = await place('field', [0, 5000], null, /^FIELD · 9 OMNI · 2\.0 km grid · 045°$/, 9, { shot: 'field-ghost' })
        n = await place('wedge', [-4000, -2000], [-1000, -2000], /^WEDGE · 5 DIFAR · 3\.0 km · opens 090°$/, 5, { mid: 'wedge-drag' })
      } else if (slug === 'iphone-land') {
        n = await place('wedge', [0, 1000], null, /^WEDGE · 5 DIFAR · 4\.0 km · opens 000°$/, 5, { shot: 'wedge-ghost' })
      } else {
        n = await place('line', [0, 2500], null, /^LINE · 5 DIFAR · 8\.0 km · 090°$/, 5, { shot: 'line-ghost' })
        n = await place('circle', [0, -500], [2000, -500], /^CIRCLE · 6 OMNI · r 2\.0 km$/, 6, { mid: 'circle-drag' })
      }
      ok(await chans() === n, `${slug}: ${await chans()} gram channel buttons for ${n} buoys`)
      // AUTO lays the planner's AUTO pattern at once; a manual drop still works while AUTO is on.
      await press(btn('[data-mode=auto]'))
      if (await waitCount([n, 'gt'], 'AUTO laid nothing')) {
        await page.waitForTimeout(200)
        const h = await hint(); console.log(`${slug}: AUTO → "${h}", field ${await count()}`)
        ok(/AUTO (LINE|CIRCLE) laid · [56]/.test(h), `${slug}: AUTO toast "${h}"`)
        await shot('auto')
      }
      n = await count()
      await place('single', [-6000, -6000 * (slug === 'iphone' ? 0.5 : 1)], null, /^SINGLE · 1 DIFAR/, 1, { shot: 'manual-in-auto' })
      ok((await page.locator('[data-testid=field-mode] button[aria-pressed=true]').getAttribute('data-mode')) === 'auto', `${slug}: AUTO not kept after a manual drop`)
      ok((await phase()) === 'idle', `${slug}: drop tool not put away after the drop in AUTO (${await phase()})`)
      await page.waitForTimeout(1500)
      ok(await count() === n + 1, `${slug}: AUTO laid again without a new fix (${await count()} vs ${n + 1})`)
      await shot('final')
    }
    ok(!errs.length, `${slug}: page errors ${errs.join(' | ')}`)
    await ctx.close(); console.log(slug, 'done')
  }
  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('drop smoke OK')
