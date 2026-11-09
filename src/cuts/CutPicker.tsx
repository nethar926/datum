import { listCutsForPicker } from './api'
import type { CutRichness } from './types'
import { IcChevron } from '../ui/icons'
import { COMING_SOON_LABEL, isNuclearCut } from './comingSoon'

const RICH_LABEL: Record<CutRichness, string> = { sparse: 'Sparse', moderate: 'Moderate', rich: 'Rich' }

/** Spoiler-free cut list: number + richness only, as an iOS grouped list.
 * Nuclear plant cuts stay listed as disabled "Coming soon" entries (Wilson). */
export function CutPicker({ activeId, onPick }: { activeId: string | null; onPick: (id: string) => void }) {
  const cuts = listCutsForPicker()
  return (
    <div className="ios-section" data-testid="cut-picker">
      <h3>Practice cuts</h3>
      <div className="ios-group" role="listbox" aria-label="Practice cuts">
        {cuts.map((c, i) => {
          const comingSoon = isNuclearCut(c)
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={!comingSoon && activeId === c.id}
              aria-disabled={comingSoon || undefined}
              disabled={comingSoon}
              className={`ios-row cut-row${activeId === c.id && !comingSoon ? ' on' : ''}${comingSoon ? ' coming-soon' : ''}`}
              data-testid={`cut-pick-${i + 1}`}
              data-cut-id={c.id}
              data-richness={c.richness}
              data-coming-soon={comingSoon ? '1' : undefined}
              onClick={comingSoon ? undefined : () => onPick(c.id)}
            >
              <span className="row-label">
                Cut {i + 1}
                <small>
                  {comingSoon
                    ? COMING_SOON_LABEL
                    : `${RICH_LABEL[c.richness]} · ${Math.round(c.durationS)} s`}
                </small>
              </span>
              {comingSoon
                ? <span className="cut-coming-soon" data-testid="cut-coming-soon">{COMING_SOON_LABEL}</span>
                : <span className={`cut-rich-pill cut-rich-${c.richness}`}>{RICH_LABEL[c.richness].toUpperCase()}</span>}
              {!comingSoon && <IcChevron className="chev" size={16} />}
            </button>
          )
        })}
      </div>
      <p className="ios-foot">
        Short recorded grams of fictional classes. Pick a cut, call the lines, then open the ID deck to score.
        Nuclear cuts show as Coming soon until those grams ship. Scrubber seeks directly to the target time. DEMON lesson pack (cinderlilt first) plus starter cuts.
      </p>
    </div>
  )
}
