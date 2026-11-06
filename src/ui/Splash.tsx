/**
 * Per-load launch splash: DATUM logo + fictional-training disclaimer, with an optional Add to Home Screen
 * card on iOS/Android when not already standalone. Engine boots underneath; Continue fades the card out.
 * Thick near-opaque material + a single full-screen scrim — never glass over the instruments.
 */
import { useEffect, useState } from 'react'
import { IcMore, IcPlusBox, IcShare } from './icons'
import {
  installPlatform, saveHideA2hs, showHomeScreenCard, type InstallPlatform,
} from './splashPlatform'

/** Short HIG-secondary copy; kept tight so 390×844 fits without scroll when A2HS is shown. */
const DISCLAIMER =
  'Training simulator. All vessels, nations and signatures are fictional — public, unclassified physics. Not for operational use.'

const FADE_MS = 180

export function Splash({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const [a2hs, setA2hs] = useState(() => showHomeScreenCard())
  const [plat] = useState<InstallPlatform>(() => installPlatform())
  const [scheme, setScheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark')

  useEffect(() => {
    const sync = () => setScheme(document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark')
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(() => { setOpen(false); onDone?.() }, FADE_MS)
    return () => window.clearTimeout(t)
  }, [leaving, onDone])

  if (!open) return null

  const dismiss = () => setLeaving(true)
  const hideA2hsSession = () => setA2hs(false)
  const hideA2hsForever = () => { saveHideA2hs(true); setA2hs(false) }

  const base = (import.meta.env.BASE_URL as string) || '/'
  const logoSrc = `${base}${scheme === 'light' ? 'logo-lockup-light.svg' : 'logo-lockup-dark.svg'}`

  return (
    <div
      className={`splash-root${leaving ? ' leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-title"
      data-testid="splash"
      data-leaving={leaving ? '1' : '0'}
    >
      {/* One cheap full-screen layer: dim + blur. Card itself is thick/opaque. */}
      <div className="splash-scrim" aria-hidden data-testid="splash-scrim" />
      <div className="splash-card" data-testid="splash-card">
        <img className="splash-logo" src={logoSrc} alt="DATUM" width={252} height={72} data-testid="splash-logo" />
        <h1 id="splash-title" className="splash-title visually-hidden">DATUM</h1>
        <p className="splash-disclaimer" data-testid="splash-disclaimer">{DISCLAIMER}</p>

        {a2hs && (plat === 'ios' || plat === 'android') && (
          <div className="splash-a2hs" data-testid="splash-a2hs" data-platform={plat}>
            <h2 className="splash-a2hs-title">Add to Home Screen</h2>
            <p className="splash-a2hs-lead">Add DATUM for a full-screen web app. Keep <b>Open as Web App</b> on.</p>
            <ol className="splash-a2hs-steps" data-testid="splash-a2hs-steps">
              {plat === 'ios' ? (
                <>
                  <li><span className="step-ic" aria-hidden><IcShare size={16} /></span><span>Tap <b>Share</b></span></li>
                  <li><span className="step-ic" aria-hidden><IcPlusBox size={16} /></span><span>Tap <b>Add to Home Screen</b></span></li>
                  <li><span className="step-ic" aria-hidden><IcPlusBox size={16} /></span><span>Turn on <b>Open as Web App</b>, then <b>Add</b></span></li>
                </>
              ) : (
                <>
                  <li><span className="step-ic" aria-hidden><IcMore size={16} /></span><span>Open the browser <b>menu</b></span></li>
                  <li><span className="step-ic" aria-hidden><IcPlusBox size={16} /></span><span>Tap <b>Install app</b> or <b>Add to Home screen</b></span></li>
                </>
              )}
            </ol>
            <div className="splash-a2hs-actions" role="group" aria-label="Home Screen prompt">
              <button type="button" className="btn splash-a2hs-btn" data-testid="splash-a2hs-notnow" onClick={hideA2hsSession}>Not now</button>
              <button type="button" className="btn splash-a2hs-btn" data-testid="splash-a2hs-dont" onClick={hideA2hsForever}>Don&apos;t show again</button>
            </div>
          </div>
        )}

        <button type="button" className="btn primary splash-continue" data-testid="splash-continue" onClick={dismiss}>
          Continue
        </button>
      </div>
    </div>
  )
}
