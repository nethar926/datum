// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canPromptNewSim, freshSeed, newSimStartArgs } from './newSim'
import { NewSimDialog } from './NewSimDialog'
import { createLongPress, LONG_PRESS_MS, type LongPressTimers } from '../ui/longPress'
import type { ScenarioParams } from '../scenarios/acousticsApi'

function fakeTimers() {
  let next: (() => void) | null = null
  const t: LongPressTimers & { elapse: () => void } = {
    set: (fn) => { next = fn; return 1 },
    clear: () => { next = null },
    elapse: () => { const f = next; next = null; f?.() },
  }
  return t
}

describe('Play long press', () => {
  it('a tap toggles; a 0.5 s hold opens the prompt and swallows its own click', () => {
    const t = fakeTimers(), onLong = vi.fn(), onTap = vi.fn()
    const lp = createLongPress(onLong, onTap, LONG_PRESS_MS, t)
    lp.pointerDown(); lp.pointerCancel(); lp.click()
    expect(onTap).toHaveBeenCalledTimes(1); expect(onLong).not.toHaveBeenCalled()
    lp.pointerDown(); t.elapse()
    lp.contextMenu() // touch browsers raise contextmenu during the same hold: no second prompt
    lp.pointerCancel(); lp.click()
    expect(onLong).toHaveBeenCalledTimes(1); expect(onTap).toHaveBeenCalledTimes(1)
    lp.otherPointerDown(); lp.contextMenu() // right click
    expect(onLong).toHaveBeenCalledTimes(2)
    lp.pointerDown(); lp.pointerCancel(); lp.click()
    expect(onTap).toHaveBeenCalledTimes(2)
    expect(LONG_PRESS_MS).toBe(500)
  })
  it('keyboard: held Space or Shift+Enter opens it; Enter and a short Space still toggle', () => {
    const t = fakeTimers(), onLong = vi.fn(), onTap = vi.fn()
    const lp = createLongPress(onLong, onTap, LONG_PRESS_MS, t)
    expect(lp.keyDown('Enter', true, false)).toBe(true) // caller prevents default → no click
    expect(onLong).toHaveBeenCalledTimes(1)
    lp.keyDown('Enter', false, false); lp.click()
    expect(onTap).toHaveBeenCalledTimes(1)
    lp.keyDown(' ', false, false); lp.keyDown(' ', false, true); t.elapse(); lp.keyUp(' '); lp.click()
    expect(onLong).toHaveBeenCalledTimes(2); expect(onTap).toHaveBeenCalledTimes(1)
    lp.keyDown(' ', false, false); lp.keyUp(' '); lp.click()
    expect(onTap).toHaveBeenCalledTimes(2)
    lp.keyDown('ContextMenu', false, false); lp.contextMenu() // Menu key
    expect(onLong).toHaveBeenCalledTimes(3)
  })
})

describe('new sim start args', () => {
  const params = { seed: 11, subCount: 2 } as unknown as ScenarioParams
  it('new keeps scenario and settings with the new seed; restart replays the running seed; cancel is null', () => {
    expect(newSimStartArgs({ scenarioId: 'ridgeline-field', seed: 7 }, { kind: 'new', seed: 42 })).toEqual({ seed: 42, scenarioId: 'ridgeline-field', params: undefined })
    expect(newSimStartArgs({ scenarioId: 'generated', seed: 11, params }, { kind: 'new', seed: 99 })).toEqual({ seed: 99, scenarioId: 'generated', params: { ...params, seed: 99 } })
    expect(newSimStartArgs({ scenarioId: 'generated', seed: 11, params }, { kind: 'restart' })).toEqual({ seed: 11, scenarioId: 'generated', params })
    expect(newSimStartArgs({ scenarioId: 'ridgeline-field', seed: 7 }, { kind: 'cancel' })).toBeNull()
  })
  it('fresh seed never repeats the running one; cuts never prompt', () => {
    const r = [7, 7, 31337]
    expect(freshSeed(7, () => r.shift()!)).toBe(31337)
    expect(freshSeed(7, () => 7)).toBe(8)
    expect(canPromptNewSim({ scenarioId: 'cut:brindleflux-1', seed: 1 })).toBe(false)
    expect(canPromptNewSim({ scenarioId: 'ridgeline-field', seed: 7 })).toBe(true)
  })
})

describe('NewSimDialog', () => {
  let root: Root, node: HTMLDivElement
  afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals() })
  const render = (onChoose: (c: unknown) => void) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    node = document.createElement('div'); document.body.append(node); root = createRoot(node)
    act(() => root.render(createElement(NewSimDialog, { currentSeed: 7, proposedSeed: 31337, onChoose })))
  }
  const q = <T extends Element>(id: string) => node.querySelector<T>(`[data-testid="${id}"]`)!
  it('shows the running seed and an editable fresh seed; Start / Restart / Cancel / Escape', () => {
    const onChoose = vi.fn()
    render(onChoose)
    expect(q('new-sim').getAttribute('role')).toBe('alertdialog')
    expect(q('new-sim-current').textContent).toBe('7')
    const input = q<HTMLInputElement>('new-sim-seed')
    expect(input.value).toBe('31337'); expect(document.activeElement).toBe(input)
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { set.call(input, '4242'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => q<HTMLButtonElement>('new-sim-start').click())
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'new', seed: 4242 })
    act(() => { set.call(input, 'abc'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(q<HTMLButtonElement>('new-sim-start').disabled).toBe(true)
    act(() => q<HTMLButtonElement>('new-sim-restart').click())
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'restart' })
    act(() => q<HTMLButtonElement>('new-sim-cancel').click())
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'cancel' })
    act(() => { q('new-sim').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'cancel' })
    expect(onChoose).toHaveBeenCalledTimes(4)
  })
})
