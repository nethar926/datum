// HIG micro-push 2: taller phone-landscape gram + Hz axis labels never overlap/clip.
// Also: shoot the normal working dock (tab bar minimized after gram interaction) so the
// tool strip shows at least as many tools as on base 4fc4deb, and assert no toolbar /
// segmented label is mid-clipped by its container. Port 4200.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4200
mkdirSync('docs', { recursive: true })
const fails = []; const ok = (c, m) => { if (!c) fails.push(m) }

const overlaps = (a, b, pad = 0) => !(!a || !b
  || a.x + a.width + pad <= b.x || b.x + b.width + pad <= a.x
  || a.y + a.height + pad <= b.y || b.y + b.height + pad <= a.y)

let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore', detached: true,
  })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview on ${port} not ready`)
}

const URL = `http://127.0.0.1:${port}/datum/?autoplay&rate=16&tab=live`

/** Fully inside clip parent (1 px slop). */
const fullyIn = (r, pr) => !!r && !!pr && r.x >= pr.x - 1 && r.right <= pr.right + 1

// Tool counts in the minimized (working) dock on base 4fc4deb / HIG1 shots.
const VIEWS = [
  ['iphone-landscape', {
    ...devices['iPhone 15 landscape'],
  }, { gramMin: 145, toolsMin: 5 }],
  ['iphone-se-landscape', {
    ...devices['iPhone SE'],
    viewport: { width: 667, height: 375 },
    isMobile: true,
    hasTouch: true,
  }, { gramMin: 170, toolsMin: 4 }],
  ['iphone-portrait', {
    ...devices['iPhone 15'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }, { gramMin: 150, toolsMin: 3 }],
  ['desktop', {
    viewport: { width: 1440, height: 900 },
    userAgent: devices['Desktop Safari'].userAgent,
    deviceScaleFactor: 1, isMobile: false, hasTouch: false,
  }, { gramMin: 400, toolsMin: 5 }],
]

await startSrv()
const browser = await webkit.launch()
try {
  for (const [name, device, floors] of VIEWS) {
    const touch = !!device.isMobile || !!device.hasTouch
    const vw = device.viewport.width, vh = device.viewport.height
    const ctx = await browser.newContext({ ...device })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    await page.addInitScript(() => {
      try {
        localStorage.setItem('datum.gram', JSON.stringify({ res: 5, filter: 'NB' }))
        localStorage.removeItem('datum.band')
        localStorage.setItem('datum.a2hs.hide', '1')
      } catch {}
    })
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await dismissSplash(page)
    await page.waitForSelector('[data-testid=lofar]', { timeout: 30000 })
    await page.waitForTimeout(2500)

    const F = (m) => `${name}: ${m}`
    const press = async (x, y) => {
      if (touch) await page.touchscreen.tap(x, y)
      else await page.mouse.click(x, y)
    }

    // Working state: interact with the gram so the tab bar collapses to the single-icon capsule
    // (same as HIG1). Without this the expanded tabs crush the tool strip on 390 px.
    const g0 = await page.locator('[data-testid=lofar]').boundingBox()
    ok(!!g0, F('gram missing before interact'))
    if (g0) await press(g0.x + g0.width * 0.45, g0.y + g0.height * 0.4)
    await page.waitForTimeout(450)

    if (touch || name.includes('iphone')) {
      // Wait until the dock reports minimized (data-min=1).
      for (let i = 0; i < 20; i++) {
        const min = await page.locator('[data-testid=tabbar]').getAttribute('data-min')
        if (min === '1') break
        await page.waitForTimeout(100)
      }
      ok(await page.locator('[data-testid=tabbar]').getAttribute('data-min') === '1', F('tab bar not minimized after gram tap (working state)'))
      ok(await page.locator('.app.ios').getAttribute('data-tabbar') === 'min', F('app data-tabbar not min'))
    }

    const m = await page.evaluate(() => {
      const R = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
      }
      const gram = document.querySelector('[data-testid=lofar]')
      const axis = document.querySelector('[data-testid=lofar-freq-axis]')
      const labels = axis
        ? [...axis.querySelectorAll(':scope > span')].map((s) => {
          const r = R(s)
          return { t: (s.textContent || '').trim(), ...r }
        }).filter((l) => l && l.width > 0 && l.height > 0)
        : []
      const unit = document.querySelector('.axis-x-unit')
      const unitBox = unit && getComputedStyle(unit).display !== 'none' ? R(unit) : null
      const head = document.querySelector('.panel.gram-panel .panel-head')
      const res = document.querySelector('[data-testid=res-readout]')
      const drop = document.querySelector('[data-testid=drop-bar]')
      const modes = [...document.querySelectorAll('[data-testid=field-mode] button')].map((el) => {
        const r = R(el), pr = R(el.closest('.drop-bar'))
        return { t: (el.innerText || '').trim(), r, pr, full: !!(r && pr && r.x >= pr.x - 1 && r.right <= pr.right + 1) }
      })
      const toolbar = document.querySelector('[data-testid=gram-tools]')
      const tb = R(toolbar)
      const wrap = document.querySelector('[data-testid=gram-tools] .tool-scroll-wrap')
      const wr = R(wrap)
      const moreR = wrap?.getAttribute('data-more-r') === '1'
      const moreL = wrap?.getAttribute('data-more-l') === '1'
      // Fully visible = inside the toolbar, and not under the scroll fade/chevron bands.
      const fadeR = moreR ? 52 : 0, fadeL = moreL ? 40 : 0
      const tools = [...document.querySelectorAll('[data-testid=gram-tools] .tool')].map((el) => {
        const r = R(el)
        if (!r || !tb || r.width < 8) return { t: '', full: false, r }
        const inTb = r.x >= tb.x - 1 && r.right <= tb.right + 1
        // Pinned FIX sits outside the scroll wrap — treat toolbar bounds only.
        const inScroll = el.closest('.tool-scroll')
        const solid = !inScroll || !wr ? inTb
          : (r.x >= wr.x + fadeL - 1 && r.right <= wr.right - fadeR + 1)
        return { t: ((el.innerText || '').trim().split('\n')[0] || el.getAttribute('aria-label') || '').slice(0, 16), full: !!(inTb && solid), r, inScroll: !!inScroll }
      })
      // Hard clip = a scroll-strip tool is mid-cut with NO fade/chevron affordance.
      // When data-more-r/l is set, ToolScroll is intentionally fading the edge — that is not a regression.
      const hardClip = tools.filter((t) => {
        if (!t.r || !t.inScroll || !wr || t.full) return false
        if (moreR || moreL) return false
        const intersects = t.r.x < wr.right && t.r.right > wr.x
        const fully = t.r.x >= wr.x - 1 && t.r.right <= wr.right + 1
        return intersects && !fully
      })
      return {
        vw: innerWidth, vh: innerHeight,
        layout: document.querySelector('.app.ios')?.getAttribute('data-layout'),
        tabMin: document.querySelector('[data-testid=tabbar]')?.getAttribute('data-min'),
        canvas: R(gram),
        axis: R(axis),
        labels,
        unitBox,
        resText: res?.textContent?.trim() || '',
        resFull: !!(() => {
          const step = document.querySelector('[data-testid=res-step]')
          const a = R(step), b = R(head)
          return a && b && a.x >= b.x - 1 && a.right <= b.right + 1
        })(),
        modes,
        tools,
        toolFull: tools.filter((t) => t.full).map((t) => t.t),
        hardClip: hardClip.map((t) => t.t),
        headH: head?.getBoundingClientRect().height || 0,
        navH: document.querySelector('.navbar')?.getBoundingClientRect().height || 0,
        dockH: document.querySelector('.dock')?.getBoundingClientRect().height || 0,
        drop: !!drop,
      }
    })

    ok(!!m.canvas, F('gram canvas missing'))
    const gh = m.canvas ? m.canvas.height : 0
    ok(gh >= floors.gramMin, F(`gram canvas height ${Math.round(gh)} < floor ${floors.gramMin}`))

    ok(!!m.axis && m.axis.height >= 44, F(`freq axis height ${m.axis && m.axis.height}`))
    ok(m.labels.length >= 2, F(`too few freq labels ${JSON.stringify(m.labels.map((l) => l.t))}`))
    ok(m.labels.some((l) => /Hz/i.test(l.t)), F(`no Hz on any tick ${JSON.stringify(m.labels.map((l) => l.t))}`))
    ok(/Hz/i.test(m.labels.at(-1)?.t || ''), F(`last tick missing unit (${m.labels.at(-1)?.t})`))
    ok(!m.unitBox || m.unitBox.width < 1, F(`corner .axis-x-unit still visible ${JSON.stringify(m.unitBox)}`))

    for (const l of m.labels) {
      ok(l.x >= m.axis.x - 1, F(`label "${l.t}" clipped left`))
      ok(l.right <= m.axis.right + 1, F(`label "${l.t}" clipped right`))
    }
    for (let i = 0; i < m.labels.length; i++) {
      for (let j = i + 1; j < m.labels.length; j++) {
        ok(!overlaps(m.labels[i], m.labels[j], 1), F(`labels overlap "${m.labels[i].t}" × "${m.labels[j].t}"`))
      }
    }

    // RES chip + field-mode segs must not be mid-clipped.
    if (name !== 'desktop') {
      ok(m.resFull, F(`RES step mid-clipped (${m.resText})`))
      ok(!/·\s*$/.test(m.resText), F(`RES text looks truncated: ${JSON.stringify(m.resText)}`))
      for (const mode of m.modes) {
        ok(mode.full, F(`field-mode "${mode.t}" mid-clipped by drop-bar`))
        ok(['PRE', 'AUTO', 'MAN'].includes(mode.t) || /PREPLAN|MANUAL|AUTO/.test(mode.t), F(`unexpected mode label ${mode.t}`))
      }
      ok(m.modes.length >= 3, F(`field-mode missing buttons (${m.modes.length})`))
    }

    // Working dock: at least as many fully-visible tools as on base 4fc4deb.
    ok(m.toolFull.length >= floors.toolsMin, F(`fully-visible tools ${m.toolFull.length} < min ${floors.toolsMin} (${m.toolFull.join(',')})`))
    ok(!m.hardClip.length, F(`toolbar hard-clipped mid-tool: ${m.hardClip.join(',')}`))

    // 44 pt targets for visible buttons.
    {
      const small = await page.evaluate(() => {
        const out = []
        for (const el of document.querySelectorAll('button, [role=button]')) {
          const st = getComputedStyle(el)
          if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) continue
          const r = el.getBoundingClientRect()
          if (r.width < 2 || r.height < 2) continue
          if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue
          if (r.width < 44 || r.height < 44) out.push({ t: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) })
        }
        return out
      })
      ok(!small.length, F(`targets < 44: ${JSON.stringify(small.slice(0, 8))}`))
    }

    const realErrs = errs.filter((e) => !/favicon|ResizeObserver|AudioContext/.test(e))
    ok(realErrs.length === 0, F(`page errors ${realErrs.slice(0, 3).join(' | ')}`))

    await page.screenshot({ path: `docs/m3-hig2-${name}.png`, fullPage: false })
    console.log(name, `vw=${vw}x${vh}`, `layout=${m.layout}`, `tabMin=${m.tabMin}`, `gramH=${Math.round(gh)}`,
      `tools=${m.toolFull.join('|')}`, `res=${JSON.stringify(m.resText)}`, `modes=${m.modes.map((x) => x.t).join('|')}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}

if (fails.length) {
  console.error('FAIL', fails.length)
  for (const f of fails) console.error(' -', f)
  process.exit(1)
}
console.log('ok', VIEWS.length, 'views')
