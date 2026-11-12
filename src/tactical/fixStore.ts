/**
 * Operator FIX tool state: tracks (T1…), timestamped fixes with error ellipses,
 * constant-velocity legs, DYN EVENT to start a new leg. External store for the plot + FixBar.
 */
import {
  FRESH_WINDOW_S, MIN_CROSS_DEG, covarianceEllipse, fitLeg, freshRays, leastSquaresFix,
  parallelRejectMessage, type ErrorEllipse, type LegFit, type BearingRay,
} from './crossFix'
import { DEFAULT_FIX_COLOR, DEFAULT_FIX_SHAPE, type FixColor, type FixShape } from './fixStyle'

export interface LaidFix {
  id: number
  trackId: number
  legId: number
  x: number
  y: number
  tS: number
  ellipse: ErrorEllipse
  buoyIds: number[]
  residualM: number
  tag: string // short serial on the mark: "1", "2"…
  /** Snapshot of the manual rays at lay time; cyan lines fade over the fix fade window. */
  rays: BearingRay[]
  color: FixColor
  shape: FixShape
}

export interface FixLeg {
  id: number
  trackId: number
  fixIds: number[]
  fit: LegFit | null
  /** Closed by DYN EVENT — drawn dimmer; a new open leg follows. */
  closed: boolean
}

export interface FixTrack {
  id: number
  tag: string // T1, T2…
  legIds: number[]
  activeLegId: number
}

export type LayResult =
  | { ok: true; fix: LaidFix }
  | { ok: false; reason: string }

export class FixStore {
  armed = false
  tracks: FixTrack[] = []
  legs: FixLeg[] = []
  fixes: LaidFix[] = []
  activeTrackId = 0
  flash: string | null = null
  version = 0
  private nextTrack = 1
  private nextLeg = 1
  private nextFix = 1
  private listeners = new Set<() => void>()
  private flashTimer = 0

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = (): number => this.version

  private emit(flash?: string | null): void {
    this.version++
    if (flash !== undefined) {
      this.flash = flash
      if (typeof window !== 'undefined') {
        window.clearTimeout(this.flashTimer)
        if (flash) this.flashTimer = window.setTimeout(() => {
          this.flash = null; this.version++; for (const l of this.listeners) l()
        }, 2200)
      }
    }
    for (const l of this.listeners) l()
  }

  reset(): void {
    this.armed = false
    this.tracks = []
    this.legs = []
    this.fixes = []
    this.activeTrackId = 0
    this.flash = null
    this.nextTrack = 1
    this.nextLeg = 1
    this.nextFix = 1
    this.emit(null)
  }

  toggleArm(): void {
    this.armed = !this.armed
    this.emit(this.armed ? 'FIX · set ≥2 DIFAR bearings, tap FIX' : null)
  }

  setArmed(on: boolean): void {
    if (this.armed === on) return
    this.armed = on
    this.emit(on ? 'FIX · set ≥2 DIFAR bearings, tap FIX' : null)
  }

  clearFlash(): void {
    if (this.flash === null) return
    this.flash = null
    this.emit()
  }

  ensureTrack(): FixTrack {
    if (this.tracks.length === 0) return this.newTrack()
    return this.tracks.find((t) => t.id === this.activeTrackId) ?? this.tracks[0]!
  }

  newTrack(): FixTrack {
    const id = this.nextTrack++
    const legId = this.nextLeg++
    const tag = `T${id}`
    const leg: FixLeg = { id: legId, trackId: id, fixIds: [], fit: null, closed: false }
    const track: FixTrack = { id, tag, legIds: [legId], activeLegId: legId }
    this.legs.push(leg)
    this.tracks.push(track)
    this.activeTrackId = id
    this.emit()
    return track
  }

  selectTrack(id: number): void {
    if (!this.tracks.some((t) => t.id === id)) return
    this.activeTrackId = id
    this.emit()
  }

  /** Lay a fix from fresh manual bearings on live DIFAR buoys. */
  layFix(
    manual: Readonly<Record<number, number>>,
    ages: Readonly<Record<number, number>>,
    buoys: readonly { id: number; x: number; y: number; kind: string; state: string }[],
    simT: number,
    windowS = FRESH_WINDOW_S,
  ): LayResult {
    const rays = freshRays(manual, ages, buoys, simT, windowS)
    if (rays.length < 2) {
      const msg = `Need ≥2 fresh DIFAR bearings (${rays.length} ready)`
      this.emit(msg)
      return { ok: false, reason: msg }
    }
    const lsq = leastSquaresFix(rays, MIN_CROSS_DEG)
    if (!lsq.ok) {
      const msg = lsq.reason === 'parallel'
        ? parallelRejectMessage(lsq.crossDegMin)
        : lsq.reason === 'behind'
          ? 'Fix behind a buoy — check bearings'
          : 'Need ≥2 bearings'
      this.emit(msg)
      return { ok: false, reason: msg }
    }
    const ellipse = covarianceEllipse(rays, lsq.fix)
    if (!ellipse) {
      const msg = 'Could not form error ellipse'
      this.emit(msg)
      return { ok: false, reason: msg }
    }
    const track = this.ensureTrack()
    let leg = this.legs.find((l) => l.id === track.activeLegId)
    if (!leg || leg.closed) {
      const legId = this.nextLeg++
      leg = { id: legId, trackId: track.id, fixIds: [], fit: null, closed: false }
      this.legs.push(leg)
      track.legIds.push(legId)
      track.activeLegId = legId
    }
    const id = this.nextFix++
    // Short mark tag (1, 2, 3…) — track name (T1) is drawn on the leg, not on every mark.
    const nOnTrack = this.fixes.filter((f) => f.trackId === track.id).length
    const tag = String(nOnTrack + 1)
    const fix: LaidFix = {
      id, trackId: track.id, legId: leg.id,
      x: lsq.fix.x, y: lsq.fix.y, tS: simT,
      ellipse, buoyIds: rays.map((r) => r.buoyId),
      residualM: lsq.fix.residualM, tag,
      rays: rays.map((r) => ({ ...r })),
      color: DEFAULT_FIX_COLOR,
      shape: DEFAULT_FIX_SHAPE,
    }
    this.fixes.push(fix)
    leg.fixIds.push(id)
    leg.fit = fitLeg(leg.fixIds.map((fid) => this.fixes.find((f) => f.id === fid)!))
    this.emit(`FIX ${tag}`)
    return { ok: true, fix }
  }

  /** End the current leg (maneuver) and open a fresh one on the same track. */
  dynEvent(): void {
    const track = this.tracks.find((t) => t.id === this.activeTrackId)
    if (!track) { this.emit('No track for DYN EVENT'); return }
    const leg = this.legs.find((l) => l.id === track.activeLegId)
    if (!leg || leg.fixIds.length === 0) { this.emit('DYN EVENT · no fixes on leg'); return }
    leg.closed = true
    const legId = this.nextLeg++
    const next: FixLeg = { id: legId, trackId: track.id, fixIds: [], fit: null, closed: false }
    this.legs.push(next)
    track.legIds.push(legId)
    track.activeLegId = legId
    this.emit('DYN EVENT · new leg')
  }

  undo(): void {
    const last = this.fixes[this.fixes.length - 1]
    if (!last) { this.emit('Nothing to undo'); return }
    this.fixes.pop()
    const leg = this.legs.find((l) => l.id === last.legId)
    if (leg) {
      leg.fixIds = leg.fixIds.filter((id) => id !== last.id)
      leg.fit = fitLeg(leg.fixIds.map((fid) => this.fixes.find((f) => f.id === fid)!).filter(Boolean))
      // If we undid the only fix on a freshly opened post-DYN leg and a prior closed leg exists, leave the empty leg.
    }
    this.emit(`Undo ${last.tag}`)
  }

  deleteFix(id: number): void {
    const i = this.fixes.findIndex((f) => f.id === id)
    if (i < 0) return
    const gone = this.fixes[i]!
    this.fixes.splice(i, 1)
    const leg = this.legs.find((l) => l.id === gone.legId)
    if (leg) {
      leg.fixIds = leg.fixIds.filter((fid) => fid !== id)
      leg.fit = fitLeg(leg.fixIds.map((fid) => this.fixes.find((f) => f.id === fid)!).filter(Boolean))
    }
    this.emit(`Deleted ${gone.tag}`)
  }

  setFixColor(id: number, color: FixColor): void {
    const f = this.fixes.find((x) => x.id === id)
    if (!f) return
    f.color = color
    this.emit()
  }

  setFixShape(id: number, shape: FixShape): void {
    const f = this.fixes.find((x) => x.id === id)
    if (!f) return
    f.shape = shape
    this.emit()
  }

  clear(): void {
    this.fixes = []
    this.legs = []
    this.tracks = []
    this.activeTrackId = 0
    this.nextTrack = 1
    this.nextLeg = 1
    this.nextFix = 1
    this.emit('Cleared fixes')
  }

  /** Active open leg fit (≥2 fixes), else null. */
  activeFit(): LegFit | null {
    const track = this.tracks.find((t) => t.id === this.activeTrackId)
    if (!track) return null
    const leg = this.legs.find((l) => l.id === track.activeLegId)
    return leg && !leg.closed ? leg.fit : null
  }

  all(): { tracks: FixTrack[]; legs: FixLeg[]; fixes: LaidFix[]; armed: boolean; flash: string | null; activeTrackId: number } {
    return {
      tracks: this.tracks, legs: this.legs, fixes: this.fixes,
      armed: this.armed, flash: this.flash, activeTrackId: this.activeTrackId,
    }
  }
}
