/**
 * Cuts tab: spoiler-free picker → player with dark gram + glass transport + CUTTOOLS overlays.
 * Leaving the tab (caller) must dispose the cut session; this component only renders UI.
 */
import type { MutableRefObject, ReactNode } from 'react'
import { Gram } from '../gram/Gram'
import type { SimClient } from '../engine/client'
import { clampView, freqToX, type FreqView } from '../gram/axis'
import type { PaletteId, DifarWheelSettings } from '../gl/colormap'
import type { GramMode } from '../gram/difarBearing'
import type { GramDir } from '../gram/timeAxis'
import { fullView, minSpanOf } from '../gram/res'
import { LargeTitleScreen, NavBar } from '../ui/chrome'
import { IcBack, IcCuts, IcLock } from '../ui/icons'
import { CutPicker } from './CutPicker'
import { CutBar } from './CutBar'
import { IdDeck } from './IdDeck'
import { CutReveal } from './CutReveal'
import { cutPickerTitle } from './cutLabel'
import type { CutController } from './session'
import type { Band, GramConfig, Tactical } from '../engine/contract'
import { DemonPane } from '../gram/DemonPane'
import { cutsDemonHintForCut } from './demonExpectationUi'
import { LloydsOverlay, lloydText, type CpaGeom, type LloydState } from '../gram/LloydsOverlay'
import { DopplerOverlay, DopplerReadout } from '../gram/DopplerOverlay'
import type { RulerStore } from '../gram/dopplerRuler'
import { harmonicSeries, harmText, ratioText } from '../gram/harmonics'
import { combLabelStride, combLabelVisible, combText, evaluateComb } from '../gram/comb'
import { DifarApplet } from '../gram/DifarApplet'
import type { CursorLocks } from '../gram/cursorLock'

const BAND_MAX: Record<Band, number> = { lofar1k: 1000, lofar2k: 2000 }

export interface CutsGramTools {
  tool: 'select' | 'dop' | 'lm' | 'harm' | 'comb'
  locks: CursorLocks
  harmF0: number | null
  harmK: number | null
  harmFam: string | null
  harmProbe: number | null
  harmProbeOn: boolean
  combCentreHz: number | null
  combSpacingHz: number | null
  combSidebands: number
  combMatched: number | null
  lm: LloydState
  cpaGeom: CpaGeom | null
  ruler: RulerStore
  dopMode: boolean
  horzOn: boolean
  dragLocked: boolean
  dragLockable: boolean
  onDragLockTap: () => void
  onPickPoint?: (hz: number, agoS: number) => void
  onDragPoint?: (phase: 'start' | 'move' | 'end', hz: number, agoS: number, shift: boolean) => void
  onCursorHz?: (hz: number | null) => void
  cursorSuffix?: string | null
  flipLock: (kind: 'harm' | 'dop' | 'lm' | 'comb') => void
  setLm: (lm: LloydState) => void
  buoyDepthM: number | null
  wheelOpen: boolean
  setWheel: (w: DifarWheelSettings) => void
  setWheelOpen: (open: boolean) => void
  probeName?: string | null
}

export function CutsTab({
  cuts, client, cutId, session, deckOpen, reveal, score, playing, simT, band,
  configs, demonConfigs = [], view, onView, palette, contrast, wheel, gramMode, gramDir, zuluOriginMs,
  harmF0, harmProbe, onPick, onPlay, onPause, onRestart, onSeek, onBackToList, onDeckOpen, onDeckClose,
  onGuess, onConfidence, onSubmit, onClearReveal, onNext,
  tactical, tools, listenBtn, gramModeSeg, rowSamplerRef,
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
  /** Optional DEMON streams for this cut (?demon=1). */
  demonConfigs?: GramConfig[]
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
  /** Cut scenario tactical (buoy + aircraft) for DIFAR / LM depth. */
  tactical?: Tactical | null
  /** CUTTOOLS: overlays + cursor locks wired against cut time/geometry. */
  tools?: CutsGramTools | null
  /** Optional listen control for the player nav. */
  listenBtn?: ReactNode
  /** Optional LOFAR/DIFAR mode segment for the player nav. */
  gramModeSeg?: ReactNode
  /** LevelHistory row sampler from the cut Gram (COMB MATCHED). */
  rowSamplerRef?: MutableRefObject<((agoS: number, dest: Float32Array) => boolean) | null>
}): ReactNode {
  const cut = session?.cut ?? null
  const cfg = configs[0]
  const title = cutPickerTitle(cutId)
  const t = tools

  if (!cut) {
    return (
      <LargeTitleScreen title="Cuts" testId="cuts-screen"
        trailing={<span className="readout" data-testid="cut-score">SCORE {score.correct}/{score.total}</span>}>
        <CutPicker activeId={cutId} onPick={onPick} />
      </LargeTitleScreen>
    )
  }

  const overlay = t && (t.ruler.placed || t.dopMode || t.tool === 'lm' || t.harmF0 !== null || t.combCentreHz !== null)
    ? (ctx: Parameters<NonNullable<Parameters<typeof Gram>[0]['overlay']>>[0]) => (
      <>
        {t.harmF0 !== null && harmonicSeries(t.harmF0, ctx.view.hi).map((f, i) => f >= ctx.view.lo && (
          <div key={`h${i}`} className="harm-marker lofar" style={{ left: freqToX(f, ctx.view, ctx.width) }}><span>{i === 0 ? 'F' : i + 1}</span></div>))}
        {t.harmF0 !== null && t.harmProbe !== null && t.harmProbe >= ctx.view.lo && t.harmProbe <= ctx.view.hi && (
          <div className="harm-marker lofar probe" data-testid="harm-probe" style={{ left: freqToX(t.harmProbe, ctx.view, ctx.width) }}><span>×{(t.harmProbe / t.harmF0).toFixed(2)}</span></div>)}
        {t.combCentreHz !== null && (() => {
          let row: Float32Array | null = null
          if (rowSamplerRef?.current && cfg?.bins) {
            const buf = new Float32Array(cfg.bins)
            if (rowSamplerRef.current(0, buf)) row = buf
          }
          const marks = t.combSpacingHz !== null && t.combSpacingHz > 0
            ? evaluateComb(t.combCentreHz, t.combSpacingHz, t.combSidebands, row, cfg?.f0 ?? 0, cfg?.fBin ?? 1, ctx.view.lo, ctx.view.hi)
            : [{ n: 0, hz: t.combCentreHz, peakHz: null as number | null, matched: false }]
          const span = Math.max(1e-6, ctx.view.hi - ctx.view.lo)
          const stride = t.combSpacingHz && t.combSpacingHz > 0
            ? combLabelStride(ctx.width / span, t.combSpacingHz)
            : 1
          return marks.filter((m) => m.hz >= ctx.view.lo && m.hz <= ctx.view.hi).flatMap((m) => {
            const nodes = [
              <div key={`c${m.n}`} className={`harm-marker lofar comb-marker${m.n === 0 ? ' comb-centre' : ''}`} data-testid={m.n === 0 ? 'comb-mark-centre' : `comb-mark-${m.n}`}
                data-n={m.n} data-side={m.n < 0 ? 'left' : 'right'} data-matched={m.matched ? '1' : '0'}
                style={{ left: freqToX(m.hz, ctx.view, ctx.width) }}>
                {combLabelVisible(m.n, stride) && <span>{m.n === 0 ? 'C' : (m.n > 0 ? `+${m.n}` : `${m.n}`)}</span>}
              </div>,
            ]
            if (m.peakHz !== null && m.matched && m.peakHz >= ctx.view.lo && m.peakHz <= ctx.view.hi) {
              nodes.push(
                <div key={`p${m.n}`} className="comb-peak-tick" data-testid={m.n === 0 ? 'comb-peak-centre' : `comb-peak-${m.n}`}
                  style={{ left: freqToX(m.peakHz, ctx.view, ctx.width) }} aria-hidden />,
              )
            }
            return nodes
          })
        })()}
        {t.tool === 'lm' && <LloydsOverlay ctx={ctx} st={t.lm} cpa={t.cpaGeom} nowS={simT} />}
        {(t.ruler.placed || t.dopMode) && <DopplerOverlay ctx={ctx} store={t.ruler} nowS={simT} active={t.dopMode} locked={t.locks.dop} onLockTap={() => t.flipLock('dop')} />}
      </>
    )
    : undefined

  return (
    <section className="cut-player" data-testid="cuts-screen" data-cut-id={cut.id} data-cut-tools={t ? '1' : '0'}>
      <NavBar title={title}
        leading={
          <button type="button" className="glass-btn" data-testid="cut-back" aria-label="Back to cuts list" onClick={onBackToList}>
            <IcBack />
          </button>
        }
        trailing={
          <>
            {listenBtn}
            <span className="readout cut-score" data-testid="cut-score" title={`SCORE ${score.correct}/${score.total}`}>
              <span className="cut-score-label">SCORE </span>{score.correct}/{score.total}
            </span>
            <button type="button" className="glass-btn cut-deck-btn" data-testid="cut-deck-open"
              onClick={onDeckOpen} disabled={!session} aria-label="ID Deck" title="ID Deck">
              <IcCuts size={20} /><span className="cut-deck-label">ID Deck</span>
            </button>
          </>
        }
        testId="cuts-screen-nav" />
      {gramModeSeg && (
        <div className="cut-chrome-row" data-testid="cut-chrome-row" role="toolbar" aria-label="Cut gram mode">
          {gramModeSeg}
        </div>
      )}
      <div className="cut-gram panel gram-panel" data-testid="cut-gram" hidden={gramMode === 'demon'} style={gramMode === 'demon' ? { display: 'none' } : undefined}>
        <div className="panel-body">
          {configs.length > 0 ? (
            <Gram client={client} configs={configs} streamIndex={0} view={view}
              onView={(v) => onView(cfg ? clampView(v, fullView(cfg).hi, minSpanOf(cfg), cfg.f0) : clampView(v, BAND_MAX[band]))}
              normalized={cfg?.filter !== 'BB'} palette={palette} contrast={contrast} wheel={wheel}
              mode={gramMode === 'demon' ? 'lofar' : gramMode} tactical={tactical ?? undefined} handoff={undefined}
              onCursorHz={t?.onCursorHz} cursorSuffix={t?.cursorSuffix ?? undefined}
              onPickPoint={t?.onPickPoint} onDragPoint={t?.onDragPoint}
              dragLocked={t?.dragLocked} dragLockable={t?.dragLockable} onDragLockTap={t?.onDragLockTap}
              horz={t?.horzOn ?? false} nowS={simT} dir={gramDir} zuluOriginMs={zuluOriginMs}
              overlay={overlay} rowSamplerRef={rowSamplerRef}
              testId="cut-lofar" />
          ) : (
            <div className="empty-state">
              <div className="empty-icon"><IcCuts size={44} /></div>
              <h2>Loading cut…</h2>
            </div>
          )}
          {t && (t.tool === 'harm' || t.harmF0 !== null) && (
            <div className={`gram-note readout harm-note${t.locks.harm ? ' locked' : ''}`} data-testid="harm-readout" data-locked={t.locks.harm ? '1' : '0'}>
              {t.locks.harm && <IcLock size={11} className="cursor-lock-ic" />}
              {harmText(t.harmF0, t.harmK, cfg ? fullView(cfg).hi : BAND_MAX[band], t.harmFam ?? undefined)}
              {t.harmF0 !== null && t.harmProbe !== null && `   ${ratioText(t.harmF0, t.harmProbe)}${t.probeName ? '  ' + t.probeName : ''}`}
            </div>
          )}
          {t && (t.tool === 'comb' || t.combCentreHz !== null) && (
            <div className={`gram-note readout comb-note${t.locks.comb ? ' locked' : ''}`} data-testid="comb-readout" data-locked={t.locks.comb ? '1' : '0'}>
              {t.locks.comb && <IcLock size={11} className="cursor-lock-ic" />}
              {combText(t.combCentreHz, t.combSpacingHz, t.combSidebands, t.combMatched)}
            </div>
          )}
          {t && (t.dopMode || t.ruler.placed) && <DopplerReadout store={t.ruler} fBin={cfg?.fBin ?? 1} locked={t.locks.dop} />}
          {t && t.tool === 'lm' && (
            <div className="lm-panel" data-testid="lm-panel">
              <div className="seg" role="group" aria-label="Lloyd's mirror basis">
                {(['cpaFit', 'manual', 'none'] as const).map((b) => (
                  <button key={b} aria-pressed={t.lm.basis === b ? !(b === 'cpaFit' && !t.cpaGeom) : b === 'none' && t.lm.basis === 'cpaFit' && !t.cpaGeom} disabled={b === 'cpaFit' && !t.cpaGeom} onClick={() => t.setLm({ ...t.lm, basis: b })}
                    title={b === 'cpaFit' && !t.cpaGeom ? 'Needs a CPA fit first' : undefined}>{b === 'cpaFit' ? 'CPA fit' : b === 'manual' ? 'Manual' : 'None'}</button>))}
              </div>
              {t.lm.basis === 'manual' && <>
                <label>Range km <input type="number" step={0.1} min={0.1} value={(t.lm.manRangeM / 1000).toFixed(1)} onChange={(e) => t.setLm({ ...t.lm, manRangeM: Math.max(100, Number(e.target.value) * 1000) })} /></label>
                <label>Speed kt <input type="number" step={0.5} min={0.5} value={(t.lm.manSpeedMps * 1.943844).toFixed(1)} onChange={(e) => t.setLm({ ...t.lm, manSpeedMps: Math.max(0.25, Number(e.target.value) / 1.943844) })} /></label>
              </>}
              {(t.lm.basis === 'none' || (t.lm.basis === 'cpaFit' && !t.cpaGeom)) &&
                <label>Width s <input type="number" step={10} min={10} value={t.lm.tauS.toFixed(0)} onChange={(e) => t.setLm({ ...t.lm, tauS: Math.max(10, Number(e.target.value)) })} /></label>}
              {t.lm.basis !== 'cpaFit' && (
                <div className="seg" role="group" aria-label="Lloyd CPA time" data-testid="lm-cpa-nudge">
                  <button type="button" onClick={() => t.setLm({ ...t.lm, tCpaS: t.lm.tCpaS - 10 })} title="CPA time −10 s">CPA −</button>
                  <button type="button" onClick={() => t.setLm({ ...t.lm, tCpaS: t.lm.tCpaS + 10 })} title="CPA time +10 s">CPA +</button>
                </div>
              )}
              <span className={`lm-read${t.locks.lm ? ' locked' : ''}`} data-testid="lm-readout" data-locked={t.locks.lm ? '1' : '0'}>
                {t.locks.lm && <IcLock size={11} className="cursor-lock-ic" />}
                {lloydText(t.lm, t.cpaGeom, t.buoyDepthM, { t0: Math.max(0, simT - 300), t1: simT })}
              </span>
            </div>
          )}
          {t && gramMode === 'difar' && t.wheelOpen && (
            <DifarApplet wheel={wheel} onChange={t.setWheel} onClose={() => t.setWheelOpen(false)} />
          )}
        </div>
      </div>
      {demonConfigs.length > 0 && (
        <DemonPane client={client} configs={demonConfigs} palette={palette} streamIndex={0}
          context="cuts"
          cutsHint={cutsDemonHintForCut(cut)}
          visible={gramMode === 'demon'} />
      )}
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
          <CutReveal result={reveal} cut={cut} onClose={onClearReveal} onNext={onNext} />
        </div>
      )}
    </section>
  )
}
