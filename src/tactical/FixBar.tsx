import { useSyncExternalStore } from 'react'
import type { FixStore } from './fixStore'
import { IcFix, IcTrash, IcUndo } from '../ui/icons'

interface Props {
  store: FixStore
  onLay: () => void
  freshCount: number
  onDone: () => void
}

/**
 * FIX edit-mode toolbar: takes the full dock width while armed (tab bar hides).
 * Compact 44pt controls so LAY / DYN / Undo / Clear / tracks / Done all fit on phone.
 * Toast capsule sits centered above the bar; CSE/SPD lives under the plot A/C readout.
 */
export function FixBar({ store, onLay, freshCount, onDone }: Props) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  void snap
  const warn = !!store.flash && /too shallow|Need ≥2|behind|Nothing|no fixes/i.test(store.flash)
  return (
    <div className="fix-edit" data-testid="fix-bar" data-armed={store.armed ? '1' : '0'}>
      {store.flash && (
        <div className={`fix-flash${warn ? ' warn' : ''}`} data-testid="fix-flash" role="status">{store.flash}</div>
      )}
      <div className="toolbar-glass glass fix-toolbar" role="toolbar" aria-label="FIX cross-fix">
        <button type="button" className="tool primary fix-btn" data-testid="fix-lay" onClick={onLay}
          title="Lay a fix from ≥2 fresh DIFAR bearings" disabled={freshCount < 2} aria-label="LAY">
          <IcFix /><span>LAY</span>
        </button>
        <button type="button" className="tool fix-btn" data-testid="fix-dyn" onClick={() => store.dynEvent()}
          title="DYN EVENT: end the current leg and start a new one"
          disabled={store.fixes.length === 0} aria-label="DYN EVENT"><span>DYN</span></button>
        <button type="button" className="tool fix-btn icon" data-testid="fix-undo" onClick={() => store.undo()}
          title="Undo last fix" disabled={!store.fixes.length} aria-label="Undo"><IcUndo /></button>
        <button type="button" className="tool fix-btn icon" data-testid="fix-clear" aria-label="Clear fixes"
          onClick={() => store.clear()} disabled={!store.fixes.length}><IcTrash /></button>
        <div className="seg ios-seg fix-tracks" role="group" aria-label="FIX tracks" data-testid="fix-tracks">
          {store.tracks.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === store.activeTrackId}
              onClick={() => store.selectTrack(t.id)}>{t.tag}</button>
          ))}
          <button type="button" data-testid="fix-new-track" onClick={() => store.newTrack()}
            title="Start a new track" aria-label="New track">+T</button>
        </div>
        <button type="button" className="tool fix-done" data-testid="fix-done" onClick={onDone}
          title="Done — leave FIX mode"><span>Done</span></button>
      </div>
    </div>
  )
}
