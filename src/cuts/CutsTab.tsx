/**
 * Cuts tab: spoiler-free picker (grouped list) → player with dark gram + glass transport.
 * Leaving the tab (caller) must dispose the cut session; this component only renders UI.
 */
import type { ReactNode } from 'react'
import { Gram } from '../gram/Gram'
import type { SimClient } from '../engine/client'
import { clampView, type FreqView } from '../gram/axis'
import type { PaletteId, DifarWheelSettings } from '../gl/colormap'
import type { GramMode } from '../gram/difarBearing'
import type { GramDir } from '../gram/timeAxis'
import { fullView, minSpanOf } from '../gram/res'
import { LargeTitleScreen, NavBar } from '../ui/chrome'
import { IcBack, IcCuts } from '../ui/icons'
import { CutPicker } from './CutPicker'
import { CutBar } from './CutBar'
import { IdDeck } from './IdDeck'
import { CutReveal } from './CutReveal'
import { listCutSeeds } from './api'
import type { CutController } from './session'
import type { Band } from '../engine/contract'

const BAND_MAX: Record<Band, number> = { lofar1k: 1000, lofar2k: 2000 }

export function CutsTab({
  cuts, client, cutId, session, deckOpen, reveal, score, playing, simT, band,
  configs, view, onView, palette, contrast, wheel, gramMode, gramDir, zuluOriginMs,
  harmF0, harmProbe, onPick, onPlay, onPause, onRestart, onSeek, onBackToList, onDeckOpen, onDeckClose,
  onGuess, onConfidence, onSubmit, onClearReveal, onNext,
}: {
  cuts: CutController
  client: SimClient
  cutId: string | null
  session: CutController['session']
  deckOpen: boolean
  reveal: CutController['reveal']
  score: CutController['score']
  playing: boolean
  simT: number
  band: Band
  configs: Parameters<typeof Gram>[0]['configs']
  view: FreqView
  onView: (v: FreqView) => void
  palette: PaletteId
  contrast: number
  wheel: DifarWheelSettings
  gramMode: GramMode
  gramDir: GramDir
  zuluOriginMs: number
  harmF0: number | null
  harmProbe: number | null
  onPick: (id: string) => void
  onPlay: () => void
  onPause: () => void
  onRestart: () => void
  onSeek: (t: number) => void
  onBackToList: () => void
  onDeckOpen: () => void
  onDeckClose: () => void
  onGuess: (id: string) => void
  onConfidence: (c: Parameters<CutController['setConfidence']>[0]) => void
  onSubmit: () => void
  onClearReveal: () => void
  onNext: () => void
}): ReactNode {
  const cut = session?.cut ?? null
  const cfg = configs[0]
  const cutIndex = cutId ? listCutSeeds().findIndex((c) => c.id === cutId) : -1
  const title = cutIndex >= 0 ? `Cut ${cutIndex + 1}` : 'Cuts'

  if (!cut) {
    return (
      <LargeTitleScreen title="Cuts" testId="cuts-screen"
        trailing={<span className="readout" data-testid="cut-score">SCORE {score.correct}/{score.total}</span>}>
        <CutPicker activeId={cutId} onPick={onPick} />
      </LargeTitleScreen>
    )
  }

  return (
    <section className="cut-player" data-testid="cuts-screen" data-cut-id={cut.id}>
      <NavBar title={title}
        leading={
          <button type="button" className="glass-btn" data-testid="cut-back" aria-label="Back to cuts list" onClick={onBackToList}>
            <IcBack />
          </button>
        }
        trailing={
          <>
            <span className="readout" data-testid="cut-score">SCORE {score.correct}/{score.total}</span>
            <button type="button" className="glass-btn cut-deck-btn" data-testid="cut-deck-open" onClick={onDeckOpen} disabled={!session}>ID Deck</button>
          </>
        }
        testId="cuts-screen-nav" />
      <div className="cut-gram panel gram-panel" data-testid="cut-gram">
        <div className="panel-body">
          {configs.length > 0 ? (
            <Gram client={client} configs={configs} streamIndex={0} view={view}
              onView={(v) => onView(cfg ? clampView(v, fullView(cfg).hi, minSpanOf(cfg), cfg.f0) : clampView(v, BAND_MAX[band]))}
              normalized={cfg?.filter !== 'BB'} palette={palette} contrast={contrast} wheel={wheel}
              mode={gramMode} tactical={undefined} handoff={undefined}
              nowS={simT} dir={gramDir} zuluOriginMs={zuluOriginMs} />
          ) : (
            <div className="empty-state">
              <div className="empty-icon"><IcCuts size={44} /></div>
              <h2>Loading cut…</h2>
            </div>
          )}
        </div>
      </div>
      <CutBar cut={cut} simT={simT} playing={playing}
        onPlay={onPlay} onPause={onPause} onRestart={onRestart} onSeek={onSeek} />

      {deckOpen && (
        <div className="cut-deck-sheet">
          <IdDeck
            selectedId={cuts.guessClassId}
            confidence={cuts.confidence}
            onSelect={onGuess}
            onConfidence={onConfidence}
            onSubmit={onSubmit}
            onClose={onDeckClose}
            canSubmit={!!cuts.guessClassId}
            markHz={harmProbe ?? harmF0}
          />
        </div>
      )}
      {reveal && (
        <div className="cut-reveal-overlay">
          <CutReveal result={reveal} onClose={onClearReveal} onNext={onNext} />
        </div>
      )}
    </section>
  )
}
