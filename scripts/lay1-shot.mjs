/**
 * LAY1 smoke (WebKit): detached chrome, portrait detents, Duo hinge, split-stable toolbar.
 * Saves to /workspace/lay1-shots/. PORT=4209. Run one view at a time via LAY1_ONLY=slug.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { webkit, devices } from 'playwright'
import { dismissSplash } from './splash-dismiss.mjs'

const port = Number(process.env.PORT) || 4209
const outDir = process.env.SHOT_DIR || '/workspace/lay1-shots'
const only = process.env.LAY1_ONLY || ''
mkdirSync(outDir, { recursive: true })
const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

let srv = null
const startSrv = async () => {
  if (srv) { try { process.kill(-srv.pid, 'SIGTERM') } catch {}; srv = null; await new Promise((r) => setTimeout(r, 400)) }
  srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url).pathname,
  })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/datum/`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview on ${port} not ready`)
}

async function tapGram(page) {
  const gram = page.locator('[data-testid=lofar], [data-testid=gram], .gram-panel .panel-body, canvas').first()
  if (await gram.count()) {
    try { await gram.tap({ timeout: 2000 }) } catch { try { await gram.click({ timeout: 2000 }) } catch {} }
    await page.waitForTimeout(350)
  }
}

async function forceDetent(page, detent) {
  const grab = page.locator('[data-testid=plot-grabber]')
  await grab.focus()
  if (detent === 'gram') await page.keyboard.press('Home')
  else if (detent === 'plot') await page.keyboard.press('End')
  else {
    await page.keyboard.press('Home')
    await page.waitForTimeout(60)
    await page.keyboard.press('ArrowUp') // gram → half
  }
  await page.waitForTimeout(240)
}

async function measure(page) {
  return page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right } }
    const chrome = document.querySelector('[data-testid=chrome-bar]')
    const tools = document.querySelector('[data-testid=gram-tools]')
    const ws = document.querySelector('[data-testid=workspace]')
    const grab = document.querySelector('[data-testid=plot-grabber]')
    const split = document.querySelector('[data-testid=split-handle]')
    const gram = document.querySelector('.gram-panel')
    const plot = document.querySelector('[data-testid=tac-panel]')
    const wheelSlot = document.querySelector('[data-testid=wheel-slot]')
    const wheelBtn = document.querySelector('[data-testid=difar-wheel-btn]')
    const tabPlot = document.querySelector('[data-testid=tab-plot]')
    const fold = document.querySelector('[data-testid=hinge-fold]')
    const app = document.querySelector('.app')
    let wheelCenter = null
    if (wheelSlot && wheelBtn) {
      const s = wheelSlot.getBoundingClientRect(), b = wheelBtn.getBoundingClientRect()
      wheelCenter = {
        slotCx: s.left + s.width / 2, slotCy: s.top + s.height / 2,
        btnCx: b.left + b.width / 2, btnCy: b.top + b.height / 2,
        dx: (b.left + b.width / 2) - (s.left + s.width / 2),
        dy: (b.top + b.height / 2) - (s.top + s.height / 2),
      }
    }
    const toolBtns = tools
      ? [...tools.querySelectorAll(':scope > button.tool, .tool-scroll button.tool, .tool-scroll-full button.tool, .tool-contrast > .contrast-label')].map((el) => {
          const lab = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ')
          return lab
        }).filter(Boolean)
      : []
    const more = tools?.querySelector('[data-testid=gram-tools-scroll-more], .tool-more')
    const toolsFull = tools?.getAttribute('data-full') === '1'
    const patternRow = document.querySelector('[data-testid=pattern-row], .drop-palette')
    const patternBox = patternRow ? r(patternRow) : null
    const patternClipped = patternBox && plot
      ? patternBox.right > plot.right + 1 || patternBox.right > innerWidth + 1
      : false
    return {
      vw: innerWidth, vh: innerHeight,
      layout: app?.getAttribute('data-layout'),
      detent: app?.getAttribute('data-detent') || ws?.getAttribute('data-detent'),
      segments: app?.getAttribute('data-segments'),
      chromeInGram: !!document.querySelector('.gram-panel .gram-head, .gram-panel .panel-head.gram-head'),
      chrome: r(chrome), tools: r(tools), ws: r(ws), grab: r(grab), split: r(split),
      gram: r(gram), plot: r(plot), fold: r(fold),
      hasPlotTab: !!(tabPlot && getComputedStyle(tabPlot).display !== 'none' && tabPlot.getAttribute('aria-hidden') !== 'true' && tabPlot.offsetParent !== null),
      wheelCenter,
      chromeParent: chrome?.parentElement?.className || null,
      gramParentHasChrome: chrome ? chrome.parentElement === document.querySelector('.gram-panel') : null,
      toolLabels: toolBtns,
      toolsFull,
      hasOverflowChevron: !!(more && getComputedStyle(more).display !== 'none'),
      patternBox,
      patternClipped,
    }
  })
}

const SE = {
  viewport: { width: 375, height: 667 },
  userAgent: devices['iPhone SE'].userAgent,
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  defaultBrowserType: 'webkit',
}
const SE_LAND = {
  viewport: { width: 667, height: 375 },
  userAgent: devices['iPhone SE'].userAgent,
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
}
const IPAD = { ...devices['iPad Pro 11'] }
const IPAD_LAND = { ...devices['iPad Pro 11 landscape'] }

async function shot(browser, name, opts, prep) {
  if (only && only !== name) { console.log('skip', name); return }
  const context = await browser.newContext({ ...opts, hasTouch: opts.hasTouch ?? true })
  const page = await context.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.addInitScript(() => { try { localStorage.clear() } catch {} })
  if (prep?.init) await context.addInitScript(prep.init)
  await page.goto(`http://127.0.0.1:${port}/datum/?band=LF`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await dismissSplash(page)
  await page.waitForTimeout(600)
  // Switch to DIFAR so the wheel slot is occupied for centering checks.
  try {
    await page.getByRole('button', { name: 'DIFAR', exact: true }).first().click({ timeout: 2000 })
    await page.waitForTimeout(200)
  } catch {}
  await tapGram(page)
  if (prep?.after) await prep.after(page)
  await page.waitForTimeout(300)
  const m = await measure(page)
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false })
  writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ m, errs }, null, 2))
  console.log('shot', name, { layout: m.layout, detent: m.detent, segments: m.segments, chromeInGram: m.chromeInGram, hasPlotTab: m.hasPlotTab })
  // Spec assertions
  ok(!m.chromeInGram, `${name}: chrome still inside gram panel`)
  ok(m.chromeParent && String(m.chromeParent).includes('app'), `${name}: chrome-bar not app sibling (parent=${m.chromeParent})`)
  if (name.startsWith('iphone-se-portrait')) {
    ok(!m.hasPlotTab, `${name}: Plot tab should be hidden in phone portrait`)
    ok(!!m.grab, `${name}: missing plot grabber`)
  }
  if (name === 'duo-unfolded') {
    ok(m.vw === 1120, `${name}: viewport width ${m.vw} !== stubbed 1120`)
    ok(m.segments === 'hinge', `${name}: expected data-segments=hinge`)
    ok(!!m.fold, `${name}: missing hinge fold gutter`)
    ok(m.plot && m.plot.right <= m.vw + 0.5, `${name}: plot overflows viewport (right=${m.plot?.right} vw=${m.vw})`)
    ok(m.gram && m.gram.right <= m.vw + 0.5, `${name}: gram overflows viewport`)
    ok(m.toolsFull, `${name}: toolbar should be data-full=1`)
    ok(!m.hasOverflowChevron, `${name}: overflow chevron must be absent on Duo full toolbar`)
    const expected = ['FIX', 'BRG', 'DOP', 'HARM', 'LM', 'HORZ']
    for (const label of expected) {
      ok(m.toolLabels.some((t) => t === label || t.startsWith(label) || t.includes(label)),
        `${name}: missing tool ${label} in ${JSON.stringify(m.toolLabels)}`)
    }
    ok(m.toolLabels.some((t) => /CON|contrast/i.test(t)), `${name}: missing contrast control`)
    console.log('duo tools:', m.toolLabels)
  }
  if (name === 'iphone-se-landscape') {
    console.log('landscape patternClipped=', m.patternClipped, 'patternBox=', m.patternBox, 'plot=', m.plot)
  }
  if (m.wheelCenter && name.includes('portrait-gram')) {
    ok(Math.abs(m.wheelCenter.dx) <= 1 && Math.abs(m.wheelCenter.dy) <= 1, `${name}: wheel not centered in slot dx=${m.wheelCenter.dx} dy=${m.wheelCenter.dy}`)
  }
  await context.close()
  return m
}

try {
  await startSrv()
  const browser = await webkit.launch()

  // Portrait detents
  await shot(browser, 'iphone-se-portrait-gram', SE, {
    after: async (page) => { await forceDetent(page, 'gram') },
  })
  await shot(browser, 'iphone-se-portrait-half', SE, {
    after: async (page) => { await forceDetent(page, 'half') },
  })
  await shot(browser, 'iphone-se-portrait-plot', SE, {
    after: async (page) => { await forceDetent(page, 'plot') },
  })

  await shot(browser, 'iphone-se-landscape', SE_LAND, {})
  await shot(browser, 'ipad-portrait', IPAD, {})
  await shot(browser, 'ipad-landscape', IPAD_LAND, {})

  // Duo unfolded: viewport MUST equal stubbed segment span (2×540 + 40 hinge = 1120).
  // A narrower viewport (e.g. 1024) must fall back to normal via computeSegmentSplit clamp.
  const DUO_W = 1120, DUO_H = 720
  await shot(browser, 'duo-unfolded', {
    viewport: { width: DUO_W, height: DUO_H },
    userAgent: devices['Desktop Safari'].userAgent,
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  }, {
    init: () => {
      const W = 1120, H = 720, S = 540, F = 40
      const segs = [
        { x: 0, y: 0, width: S, height: H, left: 0, top: 0, right: S, bottom: H },
        { x: S + F, y: 0, width: S, height: H, left: S + F, top: 0, right: W, bottom: H },
      ]
      Object.defineProperty(window, 'viewport', {
        configurable: true,
        value: {
          get segments() { return segs },
          addEventListener() {}, removeEventListener() {},
        },
      })
    },
  })

  // Toolbar unchanged while split moves (iPad landscape)
  if (!only || only === 'split-stable-toolbar') {
    const context = await browser.newContext({ ...IPAD_LAND, hasTouch: true })
    const page = await context.newPage()
    await page.addInitScript(() => { try { localStorage.clear() } catch {} })
    await page.goto(`http://127.0.0.1:${port}/datum/?band=LF`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await dismissSplash(page)
    await page.waitForTimeout(600)
    await tapGram(page)
    const before = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=chrome-bar]')?.getBoundingClientRect()
      const t = document.querySelector('[data-testid=gram-tools]')?.getBoundingClientRect()
      return { cy: c?.y, ch: c?.height, cw: c?.width, ty: t?.y, th: t?.height, tw: t?.width }
    })
    // Drag split handle
    const handle = page.locator('[data-testid=split-handle]')
    const box = await handle.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 })
      await page.waitForTimeout(100)
      const during = await page.evaluate(() => {
        const c = document.querySelector('[data-testid=chrome-bar]')?.getBoundingClientRect()
        const t = document.querySelector('[data-testid=gram-tools]')?.getBoundingClientRect()
        return { cy: c?.y, ch: c?.height, cw: c?.width, ty: t?.y, th: t?.height, tw: t?.width }
      })
      await page.screenshot({ path: `${outDir}/split-stable-toolbar.png`, fullPage: false })
      await page.mouse.up()
      writeFileSync(`${outDir}/split-stable-toolbar.json`, JSON.stringify({ before, during }, null, 2))
      ok(before.cy === during.cy && before.ch === during.ch, `chrome y/h changed while splitting: ${JSON.stringify({ before, during })}`)
      ok(before.ty === during.ty && before.th === during.th, `tools y/h changed while splitting`)
      console.log('shot split-stable-toolbar', { before, during })
    } else {
      fails.push('split-stable-toolbar: no split handle')
    }
    await context.close()
  }

  await browser.close()
} finally {
  if (srv) try { process.kill(-srv.pid, 'SIGTERM') } catch {}
}

if (fails.length) {
  console.error('FAILS:\\n' + fails.map((f) => ' - ' + f).join('\\n'))
  process.exit(1)
}
console.log('LAY1 shots OK →', outDir)
