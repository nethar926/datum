import { listCutSeeds } from './api'
import type { CutRichness } from './types'
import { IcChevron } from '../ui/icons'

const RICH_LABEL: Record<CutRichness, string> = { sparse: 'Sparse', moderate: 'Moderate', rich: 'Rich' }

/** Spoiler-free cut list: number + richness only, as an iOS grouped list. */
export function CutPicker({ activeId, onPick }: { activeId: string | null; onPick: (id: string) => void }) {
  const cuts = listCutSeeds()
  return (
    <div className="ios-section" data-testid="cut-picker">
      <h3>Practice cuts</h3>
      <div className="ios-group" role="listbox" aria-label="Practice cuts">
        {cuts.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={activeId === c.id}
            className={`ios-row cut-row${activeId === c.id ? ' on' : ''}`}
            data-testid={`cut-pick-${i + 1}`}
            data-cut-id={c.id}
            data-richness={c.richness}
            onClick={() => onPick(c.id)}
          >
            <span className="row-label">
              Cut {i + 1}
              <small>{RICH_LABEL[c.richness]} · {Math.round(c.durationS)} s</small>
            </span>
            <span className={`cut-rich-pill cut-rich-${c.richness}`}>{RICH_LABEL[c.richness].toUpperCase()}</span>
            <IcChevron className="chev" size={16} />
          </button>
        ))}
      </div>
      <p className="ios-foot">
        Short recorded grams of fictional classes. Pick a cut, call the lines, then open the ID deck to score.
        Scrubber restarts and fast-forwards (no engine seek). No DEMON pane in CUT.
      </p>
    </div>
  )
}
