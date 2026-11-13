import { btProfile, dropBtBuoy, type BtDrop as EngineBtDrop, type BtProfile as EngineBtProfile, type BtProfileOpts, type BtProfileSource } from '@acoustics'
import { formatDepth, type DepthUnit } from '../displayUnits'

export type BtSample = { depthM: number; tempC: number; salPsu: number; cMps: number }
export type BtProfile = {
  profile: BtSample[]
  layerDepthM: number
  sonicLayerDepthM: number
  thermoclineBaseM: number
  deepChannelAxisM?: number
  salinityPsu: number
  outOfRange?: boolean
}
export type BtDrop = { id: number; x: number; y: number; profile: BtProfile }
export type BtMarker = { key: string; depthM: number; label: string }

export const BT_GLYPH = { r: 255, g: 191, b: 102 }
export const BT_HIT_RADIUS_PT = 24
export const BT_GLYPH_RADIUS_PT = 6

export function fromEngineProfile(p: EngineBtProfile): BtProfile {
  const out: BtProfile = {
    profile: p.profile.map((s) => ({ depthM: s.depthM, tempC: s.tempC, salPsu: s.salPsu, cMps: s.cMps })),
    layerDepthM: p.layerDepthM,
    sonicLayerDepthM: p.sonicLayerDepthM,
    thermoclineBaseM: p.thermoclineBaseM,
    salinityPsu: p.salinityPsu,
    outOfRange: p.outOfRange?.any,
  }
  if (p.deepChannelAxisM !== undefined) out.deepChannelAxisM = p.deepChannelAxisM
  return out
}

export function fromEngineDrop(d: EngineBtDrop): BtDrop {
  return { id: d.id, x: d.x, y: d.y, profile: fromEngineProfile(d.profile) }
}

/** Layer, sonic layer, thermocline; channel axis only when Sonya returned a depth. */
export function btMarkers(p: BtProfile): BtMarker[] {
  const out: BtMarker[] = [
    { key: 'layer', depthM: p.layerDepthM, label: 'Layer' },
    { key: 'sonic', depthM: p.sonicLayerDepthM, label: 'Sonic layer' },
    { key: 'thermocline', depthM: p.thermoclineBaseM, label: 'Thermocline' },
  ]
  if (p.deepChannelAxisM !== undefined) out.push({ key: 'channel', depthM: p.deepChannelAxisM, label: 'Channel axis' })
  return out
}

export function formatBtDepth(m: number, unit: DepthUnit): string {
  return formatDepth(m, unit)
}

export function btGlyphLabel(id: number): string { return `BT${id}` }

export function engineBtProfile(src: BtProfileSource, opts?: BtProfileOpts): BtProfile {
  return fromEngineProfile(btProfile(src, opts))
}

export function engineBtDrop(src: BtProfileSource, spec: { x: number; y: number; id?: number; maxDepthM?: number; samples?: number }): BtDrop {
  return fromEngineDrop(dropBtBuoy(src, spec))
}

export function hitBtDrop(drops: BtDrop[], x: number, y: number,
  screenX: (wx: number) => number, screenY: (wy: number) => number, radiusPt = BT_HIT_RADIUS_PT): number | null {
  let best: { id: number; d: number } | null = null
  for (const d of drops) {
    const dx = screenX(d.x) - x, dy = screenY(d.y) - y
    const dist = Math.hypot(dx, dy)
    if (dist <= radiusPt && (!best || dist < best.d)) best = { id: d.id, d: dist }
  }
  return best?.id ?? null
}
