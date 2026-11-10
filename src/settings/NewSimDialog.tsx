import { useEffect, useRef, useState } from 'react'
import { parseSeed } from './simStart'
import type { NewSimChoice } from './newSim'

/** Play long press: "Start a new sim?" with the running seed, an editable fresh seed, Start new sim /
 * Restart this seed / Cancel. The sim keeps running underneath until a choice is made. */
export function NewSimDialog({ currentSeed, proposedSeed, onChoose }: { currentSeed: number; proposedSeed: number; onChoose: (c: NewSimChoice) => void }) {
  const [text, setText] = useState(() => String(proposedSeed))
  const seed = parseSeed(text)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus(); first.current?.select() }, [])
  return (
    <div className="modal-scrim" role="alertdialog" aria-modal aria-labelledby="nsim-title" aria-describedby="nsim-desc" data-testid="new-sim"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onChoose({ kind: 'cancel' }) } }}>
      <div className="modal">
        <div className="modal-head"><h2 id="nsim-title">Start a new sim?</h2><button onClick={() => onChoose({ kind: 'cancel' })} aria-label="Close">✕</button></div>
        <p id="nsim-desc" className="ns-seed-note">Running seed <b data-testid="new-sim-current">{currentSeed}</b>. The sim keeps running until you choose.</p>
        <label className="seg-label" htmlFor="nsim-seed">NEW SEED</label>
        <div className="ns-seed">
          <input id="nsim-seed" ref={first} data-testid="new-sim-seed" className={seed === null ? 'bad' : ''} inputMode="numeric" autoComplete="off" spellCheck={false}
            value={text} aria-invalid={seed === null} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && seed !== null) onChoose({ kind: 'new', seed }) }} />
        </div>
        <p className={`ns-seed-note${seed === null ? ' bad' : ''}`}>{seed === null ? 'Seed is a whole number, 0 to 4294967295' : 'Both restart from T+00:00'}</p>
        <div className="modal-foot">
          <button data-testid="new-sim-cancel" onClick={() => onChoose({ kind: 'cancel' })}>Cancel</button>
          <button data-testid="new-sim-restart" onClick={() => onChoose({ kind: 'restart' })}>Restart this seed</button>
          <button className="primary" data-testid="new-sim-start" disabled={seed === null} onClick={() => seed !== null && onChoose({ kind: 'new', seed })}>Start new sim</button>
        </div>
      </div>
    </div>
  )
}
