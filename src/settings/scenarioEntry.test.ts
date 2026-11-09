// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewScenario } from './NewScenario'
import { SCENARIOS } from '../scenarios/training'

let root: Root, node: HTMLDivElement
const onStart = vi.fn(), onStartTraining = vi.fn(), onClose = vi.fn()
const el = <T extends Element>(selector: string) => node.querySelector<T>(selector)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks(); localStorage.clear()
  node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  act(() => root.render(createElement(NewScenario, { onStart, onStartTraining, onClose, activeRun: true })))
})
afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals() })

describe('Scenario start menu', () => {
  it('opens with a top-level traffic toggle and warns before replacing a run', () => {
    expect(el<HTMLInputElement>('[data-testid="ns-traffic-toggle"]').checked).toBe(true)
    expect(node.textContent).toContain('Starting replaces the current run.')
    expect(el('[data-testid="ns-start"]').textContent).toBe('Start new run')
    expect(onStart).not.toHaveBeenCalled(); expect(onStartTraining).not.toHaveBeenCalled()
  })
  it('does not restart while editing; starts generated parameters with traffic off only on Start', () => {
    act(() => el<HTMLInputElement>('[data-testid="ns-traffic-toggle"]').click())
    expect(onStart).not.toHaveBeenCalled(); expect(onStartTraining).not.toHaveBeenCalled()
    act(() => el<HTMLButtonElement>('[data-testid="ns-start"]').click())
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart.mock.calls[0][0].surfaceTraffic).toBe(0)
  })
  it('restores nonzero traffic after an off/on toggle without starting anything', () => {
    const toggle = el<HTMLInputElement>('[data-testid="ns-traffic-toggle"]')
    act(() => toggle.click()); act(() => toggle.click())
    expect(onStart).not.toHaveBeenCalled()
    act(() => el<HTMLButtonElement>('[data-testid="ns-start"]').click())
    expect(onStart.mock.calls[0][0].surfaceTraffic).toBeGreaterThan(0)
  })
  it('defers preplanned scenario changes until explicit Start too', () => {
    const select = el<HTMLSelectElement>('[data-testid="scenario-select"]')
    act(() => { select.value = SCENARIOS[0]; select.dispatchEvent(new Event('change', { bubbles: true })) })
    act(() => el<HTMLInputElement>('[data-testid="ns-traffic-toggle"]').click())
    expect(onStartTraining).not.toHaveBeenCalled()
    act(() => el<HTMLButtonElement>('[data-testid="ns-start"]').click())
    expect(onStartTraining).toHaveBeenCalledExactlyOnceWith(SCENARIOS[0], 0)
    expect(onStart).not.toHaveBeenCalled()
  })
  it('cancels without applying any changes to the active run', () => {
    act(() => el<HTMLInputElement>('[data-testid="ns-traffic-toggle"]').click())
    const cancel = [...node.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel')!
    act(() => cancel.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled(); expect(onStartTraining).not.toHaveBeenCalled()
  })
})
