import { describe, expect, it } from 'vitest'
import { CutController } from './session'
import { listCutSeeds } from './api'

describe('CutController lifecycle', () => {
  it('open disposes the previous session', () => {
    const ctl = new CutController()
    const a = ctl.open(listCutSeeds()[0].id)
    const b = ctl.open(listCutSeeds()[1].id)
    expect(a.disposed).toBe(true)
    expect(b.disposed).toBe(false)
    expect(ctl.cutId).toBe(listCutSeeds()[1].id)
    ctl.disposeSession()
    expect(b.disposed).toBe(true)
    expect(ctl.session).toBeNull()
  })
  it('reset clears score and session', () => {
    const ctl = new CutController()
    ctl.open(listCutSeeds()[0].id)
    ctl.setGuessClassId(listCutSeeds()[0].classId)
    ctl.submit({ harmF0Hz: null, probeHz: null })
    expect(ctl.score.total).toBe(1)
    ctl.reset()
    expect(ctl.session).toBeNull()
    expect(ctl.score.total).toBe(0)
    expect(ctl.reveal).toBeNull()
  })
  it('submit requires a class pick', () => {
    const ctl = new CutController()
    ctl.open(listCutSeeds()[0].id)
    expect(() => ctl.submit({ harmF0Hz: null, probeHz: null })).toThrow(/Pick a class/)
  })
  it('seek / clearSeek', () => {
    const ctl = new CutController()
    ctl.open(listCutSeeds()[0].id)
    ctl.seek(120)
    expect(ctl.seekToS).toBe(120)
    ctl.clearSeek()
    expect(ctl.seekToS).toBeNull()
  })
})
