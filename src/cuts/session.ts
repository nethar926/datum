import { openCutHandle } from './api'
import { applyScore, emptySessionScore, scoreCut, type SessionScore } from './scoring'
import type { Confidence, CutGuess, CutSession, OperatorMarks, ScoreResult } from './types'

/**
 * CUT mode controller: one live cut handle at a time, deck/reveal UI state, session score.
 * Not on the gram hot path — no per-frame work. Grams are driven by renderCut in the worker.
 */
export class CutController {
  private listeners = new Set<() => void>()
  private _session: CutSession | null = null
  private _cutId: string | null = null
  private _deckOpen = false
  private _reveal: ScoreResult | null = null
  private _score: SessionScore = emptySessionScore()
  private _seekToS: number | null = null
  private _guessClassId: string | null = null
  private _confidence: Confidence = 'med'
  /** Bumps on every state change so useSyncExternalStore re-renders. */
  private _rev = 0

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getSnapshot = (): number => this._rev
  private emit(): void { this._rev += 1; for (const fn of this.listeners) fn() }

  get session(): CutSession | null { return this._session }
  get cutId(): string | null { return this._cutId }
  get deckOpen(): boolean { return this._deckOpen }
  get reveal(): ScoreResult | null { return this._reveal }
  get score(): SessionScore { return this._score }
  get seekToS(): number | null { return this._seekToS }
  get guessClassId(): string | null { return this._guessClassId }
  get confidence(): Confidence { return this._confidence }

  /** Open a cut; disposes any previous handle. Returns the new handle (caller starts SimClient). */
  open(cutId: string): CutSession {
    this.disposeSession()
    this._session = openCutHandle(cutId)
    this._cutId = cutId
    this._reveal = null
    this._guessClassId = null
    this._confidence = 'med'
    this._seekToS = null
    this._deckOpen = false
    this.emit()
    return this._session
  }

  disposeSession(): void {
    if (this._session && !this._session.disposed) this._session.dispose()
    this._session = null
    this._cutId = null
    this._reveal = null
    this._seekToS = null
    this.emit()
  }

  /** Leave CUT mode entirely. */
  reset(): void {
    this.disposeSession()
    this._deckOpen = false
    this._score = emptySessionScore()
    this._guessClassId = null
    this.emit()
  }

  setDeckOpen(open: boolean): void { this._deckOpen = open; this.emit() }
  setGuessClassId(id: string | null): void { this._guessClassId = id; this.emit() }
  setConfidence(c: Confidence): void { this._confidence = c; this.emit() }
  clearReveal(): void { this._reveal = null; this.emit() }

  /** Request a scrub to simT (seconds). App seeks via client.seekCut then clears. */
  seek(toS: number | null): void { this._seekToS = toS; this.emit() }
  clearSeek(): void { if (this._seekToS != null) { this._seekToS = null; this.emit() } }

  submit(marks: OperatorMarks, tolHz?: number): ScoreResult {
    const cut = this._session?.cut
    if (!cut || !this._guessClassId) throw new Error('Pick a class before submit')
    const guess: CutGuess = { classId: this._guessClassId, confidence: this._confidence }
    const result = scoreCut(cut, guess, marks, tolHz)
    this._reveal = result
    this._score = applyScore(this._score, cut.id, result)
    this._deckOpen = false
    this.emit()
    return result
  }
}
