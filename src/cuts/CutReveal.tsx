import { catalog } from '@acoustics'
import { behaviourWording, identifyingLineText } from './api'
import type { ScoreResult } from './types'

function className(id: string): string {
  const c = catalog.classes.find((x) => x.id === id)
  return c ? String(c.name).replace(/^Fictional /, '') : id
}

/** Post-submit reveal: correct/wrong, identifying line (incl. harmonics as `CFR ×3`), giveaways, lookalike. */
export function CutReveal({ result, onClose, onNext }: { result: ScoreResult; onClose: () => void; onNext?: () => void }) {
  return (
    <div className="cut-reveal" data-testid="cut-reveal" role="dialog" aria-label="Cut score reveal">
      <div className={`cut-reveal-banner ${result.correct ? 'ok' : 'bad'}`} data-testid="cut-reveal-banner">
        {result.correct ? 'CORRECT' : 'WRONG'}
        {result.confidence ? ` · ${result.confidence.toUpperCase()} CONF` : ''}
      </div>
      <dl className="cut-reveal-dl">
        <dt>Truth</dt><dd data-testid="cut-truth">{className(result.truthClassId)}</dd>
        <dt>Your pick</dt><dd data-testid="cut-guess">{className(result.guessClassId)}</dd>
      </dl>
      {result.identifiedBy && (
        <p className="cut-identified" data-testid="cut-identified">
          Identified by: <b>{result.identifiedBy.lineFamily}</b> — {identifyingLineText(result.identifiedBy)}
          {result.identifiedBy.wasHarmonic ? ' · harmonic (fundamental may be missing)' : ''}
        </p>
      )}
      {result.lookalike && (
        <p className="cut-lookalike" data-testid="cut-lookalike">
          Lookalike · differs from {className(result.lookalike.otherClassId)} on: <b>{result.lookalike.differOn}</b>
        </p>
      )}
      <h4>Classifying lines</h4>
      <ul className="cut-reveal-lines" data-testid="cut-reveal-lines">
        {result.lines.map((l, i) => (
          <li key={i} className={`${l.line.giveaway ? 'giveaway' : ''}${l.hit ? ' hit' : ''}`} data-giveaway={l.line.giveaway || undefined} data-hit={l.hit || undefined}>
            <span className="fam">{l.line.lineFamily}</span>
            <span className="lab">
              {l.line.n != null && l.line.n > 1
                ? identifyingLineText({ ...l.line, wasHarmonic: true, label: l.line.label })
                : `${l.line.label}${l.line.nominalHz != null ? ` · ${l.line.nominalHz.toFixed(1)} Hz` : ''}`}
            </span>
            {l.line.giveaway && <span className="tag">GIVEAWAY</span>}
            {l.line.behaviour && <span className="tag">{behaviourWording(l.line.behaviour)}</span>}
            {l.hit ? <span className="tag hit">MARKED Δ{l.deltaHz!.toFixed(2)} Hz</span> : l.line.nominalHz != null ? <span className="tag miss">NOT MARKED</span> : null}
          </li>
        ))}
      </ul>
      <p className="readout">Giveaways marked {result.giveawaysHit}/{result.giveawaysTotal}</p>
      <div className="cut-reveal-actions">
        {onNext && <button className="btn primary" data-testid="cut-reveal-next" onClick={onNext}>Next cut</button>}
        <button className="btn" data-testid="cut-reveal-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
