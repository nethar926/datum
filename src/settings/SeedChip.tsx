import { useEffect, useState } from 'react'

/** Active scenario seed after Start. Tap copies it so a trainee can replay or share the same scenario. */
export function SeedChip({ seed }: { seed: number }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(t) }, [copied])
  useEffect(() => setCopied(false), [seed])
  const copy = async () => {
    const s = String(seed)
    try { await navigator.clipboard.writeText(s); setCopied(true); return } catch { /* no clipboard permission */ }
    try { const ta = document.createElement('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); setCopied(true) } catch { /* show it anyway */ }
  }
  return <button className={`btn seed-chip${copied ? ' copied' : ''}`} data-testid="seed-chip" onClick={copy} aria-label={`Scenario seed ${seed}, tap to copy`} title="Copy seed">
    <span className="seg-label">SEED</span> <b>{seed}</b>{copied && <span className="seed-ok" aria-live="polite"> COPIED</span>}
  </button>
}
