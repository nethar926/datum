// Gram handoff smoke (WebKit): RES / filter changes never blank the gram. Starts a sim, lets rows build up, changes
// RES, samples the LOFAR canvas right away and at intervals, asserts the lit-pixel fraction never collapses, the
// FILLING badge shows and the swap lands; then a rapid double change (cancel mid-handoff) and a NB → BB change.
// Run after `npm run build`. Saves docs/m3-handoff-*.png.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
const port = Number(process.env.PORT) || 4184
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
const SAMPLES_MS = [0, 60, 120, 250, 500, 900, 1500, 2200, 3000, 3600, 4500]
// The waterfall fills from the top (rows arrive in sim time), so "blank" is measured as the fraction of canvas pixel
// rows that hold data: a row counts when ≥ 2% of its pixels have any channel above LIT (no-data rows are pure black;
// the NB noise floor is dark but speckled). A change to a slower row rate legitimately compresses the same seconds
// into fewer rows (time axis stays true), so the floor scales by rateTo/rateFrom.
const LIT = 6
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()
  for (const [slug, dev] of [['ipad', 'iPad Pro 11 landscape'], ['iphone', 'iPhone 15 landscape']]) {
    const ctx = await browser.newContext({ ...devices[dev] }), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => { try { localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' })) } catch {} })
    await page.goto(`http://localhost:${port}/datum/?autoplay&rate=16&res=5&filter=NB`)
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(9000) // ~70 rows per buoy at 16×
    const lit = async () => {
      const png = (await cv.screenshot()).toString('base64')
      return page.evaluate(async ([b64, LIT]) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
        const g = c.getContext('2d'); g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        // Only the right 55% of each row counts: the FILLING badge sits top-left and would read as data.
        const x0 = Math.floor(c.width * 0.45), w = c.width - x0
        let rows = 0
        for (let y = 0; y < c.height; y++) {
          let n = 0; for (let x = x0, i = (y * c.width + x0) * 4; x < c.width; x++, i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > LIT) n++
          if (n >= w * 0.02) rows++
        }
        return rows / c.height
      }, [png, LIT])
    }
    const read = () => page.locator('[data-testid=res-readout]').innerText()
    const badge = page.locator('[data-testid=lofar-handoff]')
    const run = async (name, act, swapped, rateRatio = 1) => {
      const base = await lit()
      ok(base > 0.05, `${slug}/${name}: gram too empty before the change (${base.toFixed(3)})`)
      const t0 = Date.now(); await act()
      const samples = [], reads = new Set(); let sawBadge = false, sawFilling = '', swappedAt = -1
      for (const at of SAMPLES_MS) {
        const wait = t0 + at - Date.now(); if (wait > 0) await page.waitForTimeout(wait)
        const f = await lit(); samples.push([Date.now() - t0, f])
        if ((await badge.count()) && (await badge.getAttribute('data-active')) === '1') { sawBadge = true; sawFilling = await badge.innerText() }
        reads.add((await read()).split(' · ')[0])
        if (swappedAt < 0 && await swapped()) swappedAt = Date.now() - t0
        if (at === 250) await page.screenshot({ path: `docs/m3-handoff-${slug}-${name}-filling.png` })
      }
      await page.screenshot({ path: `docs/m3-handoff-${slug}-${name}-swapped.png` })
      const min = Math.min(...samples.map((s) => s[1]))
      console.log(`${slug}/${name}: base ${base.toFixed(3)} min ${min.toFixed(3)} swap@${swappedAt}ms badge "${sawFilling}"`, samples.map(([t, f]) => `${t}:${f.toFixed(3)}`).join(' '))
      ok(min >= Math.max(0.03, base * rateRatio * 0.7), `${slug}/${name}: gram blanked (min data rows ${min.toFixed(3)} vs ${base.toFixed(3)} × ${rateRatio})`)
      ok(sawBadge && /FILLING \d+%/.test(sawFilling), `${slug}/${name}: no FILLING badge`)
      ok(swappedAt >= 0, `${slug}/${name}: no swap (readout ${await read()})`)
      ok((await badge.getAttribute('data-active')) === '0', `${slug}/${name}: badge still active after swap`)
      return reads
    }
    const finer = page.locator('[data-testid=res-step] button[aria-label^="Finer"]')
    await page.screenshot({ path: `docs/m3-handoff-${slug}-before.png` })
    const resIs = (n) => async () => new RegExp(`^RES ${n} `).test(await read())
    const title = () => page.locator('[data-testid=gram-title]').innerText()
    await run('res5to4', () => finer.tap(), resIs(4))
    // Rapid double change: 4 → 3 → 2 (the first pending set is dropped, the displayed set keeps scrolling).
    await page.waitForTimeout(1500)
    const rapidReads = await run('res4to2-rapid', async () => { await finer.tap(); await page.waitForTimeout(120); await finer.tap() }, resIs(2), 0.5) // RES 4 rows every 2 s → RES 2 every 4 s
    ok(!rapidReads.has('RES 3'), `${slug}: superseded RES 3 was displayed (${[...rapidReads]})`)
    ok(/^RES 2/.test(await read()), `${slug}: ended on ${await read()}`)
    await page.waitForTimeout(1500)
    await run('nb-to-bb', () => page.locator('[data-testid=filter-seg] button', { hasText: 'BB' }).tap(), async () => /· BB$/.test(await title()))
    ok(/· BB$/.test(await title()), `${slug}: filter did not swap to BB`)
    // Frame pacing: rAF rate over ~2 s idle vs while a handoff fills (headless WebKit renders GL in software, so
    // compare against its own idle rate rather than a fixed 60).
    const rate = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 2000) requestAnimationFrame(f); else res((n * 1000) / (t - t0)) }; requestAnimationFrame(f) }))
    await page.waitForTimeout(3500)
    const idle = await rate()
    await page.locator('[data-testid=filter-seg] button', { hasText: 'NB' }).tap()
    const fps = await rate()
    console.log(`${slug}: ${idle.toFixed(1)} fps idle, ${fps.toFixed(1)} fps during handoff`)
    ok(fps >= idle * 0.8, `${slug}: ${fps.toFixed(1)} fps during handoff vs ${idle.toFixed(1)} idle`)
    const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=res-step] button, [data-testid=filter-seg] button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length)
    ok(!small, `${slug}: ${small} RES/filter targets < 44`)
    ok(!errs.length, `${slug}: page errors ${errs.join(' | ')}`)
    await ctx.close(); console.log(slug, 'done')
  }
  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('gram-handoff smoke OK')
