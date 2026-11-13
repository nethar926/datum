/**
 * AIS surface-contact style: sailboat placeholder glyph, affiliation colours
 * (unknown yellow, suspect red, friendly blue, neutral green), session-only
 * persistence, and a crease-safe card. Class / type come from Sonya's upcoming
 * AIS tracks when present; `SeededAisTrackSource.decorate` fills class and type.
 */
import { SeededAisTrackSource, type DecorateIn } from '@acoustics'
import { fixAvoidsCrease, fixMenuFrame, type FixLayoutRect } from './fixStyle'

export const AIS_AFFILIATIONS = ['unknown', 'suspect', 'friendly', 'neutral'] as const
export type AisAffiliation = (typeof AIS_AFFILIATIONS)[number]
export const DEFAULT_AIS_AFFILIATION: AisAffiliation = 'unknown'
/** SF Symbol `sailboat` placeholder; web draws an equivalent path. */
export const AIS_GLYPH = 'sailboat'
export const AIS_CARD_W = 240
export const AIS_CARD_H = 208

export const AIS_AFFILIATION_RGB: Record<AisAffiliation, string> = {
  unknown: '#ffd60a',
  suspect: '#ff453a',
  friendly: '#0a84ff',
  neutral: '#30d158',
}

export const AIS_AFFILIATION_LABEL: Record<AisAffiliation, string> = {
  unknown: 'Unknown',
  suspect: 'Suspect',
  friendly: 'Friendly',
  neutral: 'Neutral',
}

/** Upcoming engine AIS track (Sonya). Optional fields until that feed lands. */
export type AisEngineTrack = {
  id: string
  name?: string
  callsign?: string
  shipClass?: string
  type?: string
  x: number
  y: number
  crsDeg: number
  spdMps: number
  hdgDeg?: number | null
  hdgAvailable?: boolean
}

export type AisTrackSource = {
  aisTrack(id: string, atSimTime?: number): AisEngineTrack | undefined
  aisTracks?(atSimTime?: number): AisEngineTrack[]
  decorate?(track: DecorateIn, atSimTime?: number): AisEngineTrack
}

export type AisTrackInfo = {
  id: string
  callsign: string
  shipClass?: string
  type?: string
  x: number
  y: number
  crsDeg: number
  spdMps: number
  spdKts: number
}

function blankToUndef(s?: string): string | undefined {
  const t = s?.trim()
  return t ? t : undefined
}

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const v of values) {
    if (v && v.trim()) return v
  }
  return '—'
}

const seededByKey = new Map<number, SeededAisTrackSource>()

/** Seed-keyed `SeededAisTrackSource` so the AIS card can show class and type. */
export function aisSourceForSeed(seed: number): SeededAisTrackSource {
  let s = seededByKey.get(seed)
  if (!s) {
    s = new SeededAisTrackSource({ seed })
    seededByKey.set(seed, s)
  }
  return s
}

export function aisInfoFromTrack(t: AisEngineTrack, source?: AisTrackSource, atSimTime = 0): AisTrackInfo {
  const decorated = source?.decorate?.(
    { id: t.id, name: t.name, x: t.x, y: t.y, crsDeg: t.crsDeg, spdMps: t.spdMps },
    atSimTime,
  )
  const eng = decorated ?? source?.aisTrack(t.id, atSimTime)
  const src = eng ?? t
  const callsign = firstNonEmpty(src.callsign, src.name, t.callsign, t.name, t.id)
  const typ = src.type ?? t.type
  return {
    id: t.id,
    callsign,
    shipClass: blankToUndef(src.shipClass ?? t.shipClass),
    type: blankToUndef(typeof typ === 'string' ? typ : typ != null ? String(typ) : undefined),
    x: src.x, y: src.y, crsDeg: src.crsDeg, spdMps: src.spdMps,
    spdKts: src.spdMps * 1.943844,
  }
}

const affMap = new Map<string, AisAffiliation>()
let affVersion = 0
const affListeners = new Set<() => void>()

function bump(): void {
  affVersion++
  for (const l of affListeners) l()
}

export function aisAffiliation(id: string): AisAffiliation {
  return affMap.get(id) ?? DEFAULT_AIS_AFFILIATION
}

export function setAisAffiliation(id: string, affiliation: AisAffiliation): void {
  affMap.set(id, affiliation)
  bump()
}

export function resetAisAffiliations(): void {
  if (affMap.size === 0 && affVersion === 0) return
  affMap.clear()
  bump()
}

export function subscribeAisAffiliations(onStoreChange: () => void): () => void {
  affListeners.add(onStoreChange)
  return () => { affListeners.delete(onStoreChange) }
}

export function aisAffiliationVersion(): number {
  return affVersion
}

export type AisLayoutRect = FixLayoutRect

export function aisCardFrame(
  contactSX: number, contactSY: number, plot: AisLayoutRect,
  crease?: AisLayoutRect | null,
  width = AIS_CARD_W, height = AIS_CARD_H,
): AisLayoutRect | null {
  return fixMenuFrame(contactSX, contactSY, plot, crease, width, height)
}

export function aisAvoidsCrease(frame: AisLayoutRect, crease?: AisLayoutRect | null): boolean {
  return fixAvoidsCrease(frame, crease)
}

/**
 * Equivalent of SF Symbol `sailboat`: hull + mast + sail, bow up, rotated so
 * course 0° (north) points up the plot.
 */
export function drawSailboat(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  crsDeg: number,
  color: string,
  size: number,
  lineWidth: number,
  picked = false,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((crsDeg * Math.PI) / 180)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const s = size
  // hull (aft is +Y after rotate, bow toward -Y)
  ctx.beginPath()
  ctx.moveTo(-s * 0.5, s * 0.12)
  ctx.lineTo(s * 0.5, s * 0.12)
  ctx.lineTo(s * 0.28, s * 0.48)
  ctx.lineTo(-s * 0.28, s * 0.48)
  ctx.closePath()
  ctx.stroke()
  // mast
  ctx.beginPath()
  ctx.moveTo(0, s * 0.12)
  ctx.lineTo(0, -s * 0.72)
  ctx.stroke()
  // sail
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.72)
  ctx.lineTo(s * 0.48, -s * 0.02)
  ctx.lineTo(0, -s * 0.02)
  ctx.closePath()
  ctx.fill()
  if (picked) {
    ctx.beginPath()
    ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/** Short heading tick in degrees true (0° north / -Y). Omit when hdgAvailable is false. */
export function drawAisHeading(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  hdgDeg: number,
  color: string,
  length: number,
  lineWidth: number,
): void {
  const rad = (hdgDeg * Math.PI) / 180
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + Math.sin(rad) * length, y - Math.cos(rad) * length)
  ctx.stroke()
  ctx.restore()
}
