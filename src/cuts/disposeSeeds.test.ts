import { describe, expect, it } from 'vitest'
import { cloneCutSeed, getCutSeed, listCutSeeds, openCutHandle, renderCut } from './api'
import { CutController } from './session'
import { disposeCutSession } from './seek'

describe('CUT seeds stay frozen through UI flows', () => {
  it('starter-pack seeds are deep-frozen', () => {
    const cut = getCutSeed(listCutSeeds()[0]!.id)!
    expect(Object.isFrozen(cut)).toBe(true)
    expect(Object.isFrozen(cut.classifyingLines)).toBe(true)
    expect(() => { (cut as { classId: string }).classId = 'mutated' }).toThrow()
  })

  it('UI draft edits use a clone — catalog seed unchanged', () => {
    const id = listCutSeeds()[0]!.id
    const before = structuredClone(getCutSeed(id)!)
    const draft = cloneCutSeed(getCutSeed(id)!)
    draft.classId = 'ui-draft-only'
    const lines = draft.classifyingLines.map((l, i) => i === 0 ? { ...l, label: 'draft' } : l)
    const edited = { ...draft, classifyingLines: lines }
    expect(edited.classId).toBe('ui-draft-only')
    expect(edited.classifyingLines[0]?.label).toBe('draft')
    expect(getCutSeed(id)).toEqual(before)
    expect(getCutSeed(id)!.classId).not.toBe('ui-draft-only')
  })

  it('CutController open/submit/reset does not mutate seeds', () => {
    const cut = listCutSeeds()[0]!
    const snap = structuredClone(cut)
    const ctl = new CutController()
    const h = ctl.open(cut.id)
    expect(Object.isFrozen(h.cut)).toBe(true)
    ctl.setGuessClassId(cut.classId)
    ctl.setConfidence('high')
    ctl.submit({ harmF0Hz: cut.classifyingLines[0]?.nominalHz ?? 50, probeHz: null })
    ctl.clearReveal()
    ctl.disposeSession()
    ctl.reset()
    expect(getCutSeed(cut.id)).toEqual(snap)
    expect(Object.isFrozen(getCutSeed(cut.id)!)).toBe(true)
  })

  it('openCutHandle dispose is idempotent; renderCut writers return -1 after dispose', () => {
    const h = openCutHandle(listCutSeeds()[0]!.id)
    h.dispose()
    h.dispose()
    expect(h.disposed).toBe(true)

    const s = renderCut(listCutSeeds()[0]!.id)
    const row = new Float32Array(s.lofar.bins)
    expect(s.writeLofarRow(row)).toBeGreaterThanOrEqual(0)
    disposeCutSession(s)
    disposeCutSession(s)
    expect(s.isDisposed).toBe(true)
    expect(s.writeLofarRow(row)).toBe(-1)
  })
})
