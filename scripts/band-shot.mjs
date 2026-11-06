// LOFAR band preset smoke (WebKit): ELF / VLF / LF / MF picker. From RES 5, picks each preset (LF, MF, VLF, ELF),
// checks the readout and the frequency axis follow the new fMax, that the gram never blanks during the handoff
// (data-row coverage as in gram-handoff-shot, over the low-frequency columns every band shares), that harmonic markers re-span the new band, that the
// choice persists across a reload, and that RES + hands back to RES (with the preset kept "armed").
// Run after `npm run build`. Saves docs/m3-bands-*.png.
import { spawn } from 'node:child_process'
import { webkit, devices } from 'playwright'
const port = 4185
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }
const FMAX = { ELF: 50, VLF: 200, LF: 500, MF: 2000 }
const SAMPLES_MS = [0, 60, 120, 250, 500, 900, 1500, 2200, 3000]
const LIT = 6
try {
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await webkit.launch()
  for (const [slug, dev] of [['ipad', 'iPad Pro 11 landscape'], ['iphone', 'iPhone 15 landscape']]) {
    const ctx = await browser.newContext({ ...devices[dev] }), page = await ctx.newPage(), errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    // Fresh storage on the first load only (reloads must see what the app saved).
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('bandSmoke')) { sessionStorage.setItem('bandSmoke', '1'); localStorage.removeItem('datum.band'); localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' })) } } catch {} })
    const url = `http://localhost:${port}/datum/?autoplay&rate=16`
    await page.goto(url)
    const cv = page.locator('[data-testid=lofar]')
    await cv.waitFor(); await page.waitForTimeout(9000)
    const lit = async () => {
      const png = (await cv.screenshot()).toString('base64')
      return page.evaluate(async ([b64, LIT]) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
        const g = c.getContext('2d'); g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        // Only the lowest ~9% of the frequency axis counts: a widening band (LF → MF, ELF → RES 6) is black above the
        // old fMax by design, and 0.09 × the new fMax stays under the old one for every change exercised here.
        const x0 = Math.floor(c.width * 0.01), x1 = Math.ceil(c.width * 0.09), w = x1 - x0
        let rows = 0
        for (let y = 0; y < c.height; y++) {
          let n = 0; for (let x = x0, i = (y * c.width + x0) * 4; x < x1; x++, i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > LIT) n++
          if (n >= w * 0.05) rows++
        }
        return rows / c.height
      }, [png, LIT])
    }
    const read = () => page.locator('[data-testid=res-readout]').innerText()
    const badge = page.locator('[data-testid=lofar-handoff]')
    const seg = page.locator('[data-testid=band-seg]')
    const segMode = () => seg.getAttribute('data-mode')
    const pressed = () => seg.locator('button[aria-pressed=true]').allInnerTexts()
    const armed = () => seg.locator('button.armed').allInnerTexts()
    // Max label on the LOFAR frequency axis (the gram whose canvas is [data-testid=lofar]).
    const axisMax = () => page.evaluate(() => {
      const g = document.querySelector('[data-testid=lofar]').closest('.gram') ?? document.querySelector('[data-testid=lofar]').parentElement.parentElement
      const v = [...g.querySelectorAll('.axis-x span')].map((s) => parseFloat(s.textContent)).filter(Number.isFinite)
      return v.length ? Math.max(...v) : NaN
    })
    const isBand = (id) => async () => (await read()) === `RES OFF · ${id} 0–${FMAX[id]} Hz`
    const run = async (name, act, swapped, rateRatio = 1) => {
      const base = await lit()
      ok(base > 0.05, `${slug}/${name}: gram too empty before the change (${base.toFixed(3)})`)
      const t0 = Date.now(); await act()
      const samples = []; let sawFilling = '', swappedAt = -1
      for (const at of SAMPLES_MS) {
        const wait = t0 + at - Date.now(); if (wait > 0) await page.waitForTimeout(wait)
        samples.push([Date.now() - t0, await lit()])
        if ((await badge.count()) && (await badge.getAttribute('data-active')) === '1') sawFilling = await badge.innerText()
        if (swappedAt < 0 && await swapped()) swappedAt = Date.now() - t0
      }
      const min = Math.min(...samples.map((s) => s[1]))
      console.log(`${slug}/${name}: base ${base.toFixed(3)} min ${min.toFixed(3)} swap@${swappedAt}ms badge "${sawFilling}"`, samples.map(([t, f]) => `${t}:${f.toFixed(3)}`).join(' '))
      ok(min >= Math.max(0.03, base * Math.min(1, rateRatio) * 0.7), `${slug}/${name}: gram blanked (min ${min.toFixed(3)} vs base ${base.toFixed(3)})`)
      ok(swappedAt >= 0, `${slug}/${name}: no swap (readout ${await read()})`)
      ok((await badge.getAttribute('data-active')) === '0', `${slug}/${name}: badge still active after swap`)
    }
    const checkBand = async (id) => {
      const mx = await axisMax()
      console.log(`${slug}/${id}: readout "${await read()}", axis max ${mx}`)
      ok(mx <= FMAX[id] && mx >= FMAX[id] * 0.6, `${slug}/${id}: axis max ${mx} for fMax ${FMAX[id]}`)
      ok((await segMode()) === 'band' && (await pressed()).join() === id, `${slug}/${id}: seg state ${await segMode()} pressed ${await pressed()}`)
    }
    // Initial: RES 5, LF armed (default), nothing pressed.
    ok(/^RES 5 /.test(await read()), `${slug}: initial readout ${await read()}`)
    ok((await segMode()) === 'res' && (await armed()).join() === 'LF' && !(await pressed()).length, `${slug}: initial seg ${await segMode()} armed ${await armed()} pressed ${await pressed()}`)
    const resAxis = await axisMax()
    await page.screenshot({ path: `docs/m3-bands-${slug}-res5.png` })
    const harmCount = () => page.locator('.harm-marker.lofar').count()
    const harmN = async () => parseInt((/(\d+) MARKERS/.exec(await page.locator('[data-testid=harm-readout]').innerText()) ?? [])[1] ?? 'NaN')
    // On the phone the picker in the Controls sheet is used for one change (the inline seg for the others).
    const viaSheet = async (id) => {
      await page.locator('[data-testid=menu-open]').tap(); await page.waitForTimeout(350)
      const sheetSeg = page.locator('[data-testid=band-seg-sheet]')
      ok(await sheetSeg.isVisible(), `${slug}: sheet band seg not visible`)
      const small = await sheetSeg.locator('button').evaluateAll((bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44 }).length)
      ok(!small, `${slug}: ${small} sheet band targets < 44`)
      await sheetSeg.locator('button', { hasText: new RegExp(`^${id}$`) }).tap()
      ok((await sheetSeg.locator('button[aria-pressed=true]').allInnerTexts()).join() === id, `${slug}: sheet seg not pressed on ${id}`)
      await page.screenshot({ path: `docs/m3-bands-${slug}-sheet.png` })
      await page.getByRole('button', { name: 'Close Controls' }).tap(); await page.waitForTimeout(400)
    }
    let harmLF = NaN
    const tapBand = (id) => seg.locator('button', { hasText: new RegExp(`^${id}$`) }).tap()
    for (const [i, id] of ['LF', 'MF', 'VLF', 'ELF'].entries()) {
      await run(`to-${id}`, () => (slug === 'iphone' && id === 'VLF' ? viaSheet(id) : tapBand(id)), isBand(id), i === 0 ? 4 : 1)
      await checkBand(id)
      await page.screenshot({ path: `docs/m3-bands-${slug}-${id}.png` })
      if (id === 'LF' && slug === 'ipad') {
        // Harmonic markers: set F0 ≈ 50 Hz on LF, then MF must spread them to 2000 Hz.
        await page.getByRole('button', { name: 'HARM', exact: true }).tap()
        const bb = await cv.boundingBox()
        await page.mouse.click(bb.x + bb.width * 0.1, bb.y + bb.height * 0.4)
        await page.waitForTimeout(300)
        harmLF = await harmN()
        console.log(`${slug}: HARM on LF: ${harmLF} markers`)
        ok(harmLF >= 1, `${slug}: HARM F0 not set on LF (${await page.locator('[data-testid=harm-readout]').innerText()})`)
      }
      if (id === 'MF' && slug === 'ipad') {
        const n = await harmN(), shown = await harmCount()
        console.log(`${slug}: HARM on MF: ${n} markers (${shown} drawn)`)
        // Same F0: four times the band → about four times the markers (the series caps at 24), all drawn.
        ok(Math.abs(n - Math.min(24, 4 * harmLF)) <= 4 && n > harmLF && shown === n, `${slug}: harmonic markers did not follow MF fMax (LF ${harmLF}, MF ${n} / ${shown} drawn)`)
      }
      if (id === 'VLF' && slug === 'ipad') {
        const n = await harmN(), shown = await harmCount()
        console.log(`${slug}: HARM on VLF: ${n} markers (${shown} drawn)`)
        ok(Math.abs(n - (2 / 5) * harmLF) <= 2 && shown === n, `${slug}: harmonic markers on VLF ${n} / ${shown} (LF ${harmLF})`)
        await page.getByRole('button', { name: 'HARM', exact: true }).tap()
      }
      await page.waitForTimeout(1500)
    }
    ok(resAxis < 200 || resAxis !== FMAX.ELF, `${slug}: axis did not change from RES`)
    const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=band-seg] button, [data-testid=res-step] button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length)
    ok(!small, `${slug}: ${small} band/RES targets < 44`)
    // Persistence: reload lands on ELF (RES off).
    const saved = await page.evaluate(() => localStorage.getItem('datum.band'))
    ok(saved === JSON.stringify({ preset: 'ELF', on: true }), `${slug}: saved ${saved}`)
    await page.reload(); await cv.waitFor(); await page.waitForTimeout(4000)
    ok(await isBand('ELF')(), `${slug}: after reload readout ${await read()}`)
    await checkBand('ELF')
    await page.screenshot({ path: `docs/m3-bands-${slug}-reload-ELF.png` })
    // RES + leaves the band: RES 6 (saved RES 5 + 1), ELF stays armed; persists too.
    await page.waitForTimeout(3000)
    await run('ELF-to-RES6', () => page.locator('[data-testid=res-step] button[aria-label^="Coarser"]').tap(), async () => /^RES 6 /.test(await read()), 0.25)
    ok((await segMode()) === 'res' && (await armed()).join() === 'ELF' && !(await pressed()).length, `${slug}: after RES+ seg ${await segMode()} armed ${await armed()} pressed ${await pressed()}`)
    await page.screenshot({ path: `docs/m3-bands-${slug}-res6-armed.png` })
    await page.reload(); await cv.waitFor(); await page.waitForTimeout(3000)
    ok(/^RES 6 /.test(await read()) && (await armed()).join() === 'ELF', `${slug}: after 2nd reload ${await read()} armed ${await armed()}`)
    ok(!errs.length, `${slug}: page errors ${errs.join(' | ')}`)
    await ctx.close(); console.log(slug, 'done')
  }
  await browser.close()
} finally { try { process.kill(-srv.pid) } catch {} }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1) } else console.log('band smoke OK')
