// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewScenario } from './NewScenario'
import { SCENARIOS } from '../scenarios/training'
import { SimClient } from '../engine/client'
import { SimHost } from '../engine/host'
import type { ToWorker, FromWorker } from '../engine/contract'
import type { ScenarioParams } from '../scenarios/acousticsApi'

let root: Root, node: HTMLDivElement
const onStart = vi.fn(), onStartTraining = vi.fn(), onClose = vi.fn()
const el = <T extends Element>(selector: string) => node.querySelector<T>(selector)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks(); localStorage.clear()
  vi.spyOn(Math, 'random').mockReturnValue(42 / 2 ** 31)
  node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  act(() => root.render(createElement(NewScenario, { onStart, onStartTraining, onClose, activeRun: true })))
})
afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

// jsdom UI -> real client init message -> real worker host/generator, not a menu-state mock.
for (const difficulty of ['Easy', 'Regular', 'Difficult']) {
  it(`${difficulty}: traffic toggle changes generated surface contacts only on explicit Start`, () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const out: FromWorker[] = [], sent: ToWorker[] = []
    const host = new SimHost((m) => out.push(m))
    const client = new SimClient(() => ({ postMessage: (m: ToWorker) => { sent.push(m); host.handle(m) }, terminate() {} }) as unknown as Worker)
    const start = (p: ScenarioParams) => client.start(p.seed, 'generated', 'lofar1k', p)
    act(() => root.render(createElement(NewScenario, { onStart: start, onStartTraining, onClose, activeRun: true })))
    const button = [...node.querySelectorAll<HTMLButtonElement>('[data-testid="ns-diff"] button')].find((b) => b.textContent === difficulty)!
    act(() => button.click())
    const scenario = () => (host as unknown as { engine: { scenario: { contacts: { id: string; category?: string }[]; environment: { shippingDensity: number } } } }).engine.scenario
    act(() => el<HTMLButtonElement>('[data-testid="ns-start"]').click())
    expect(scenario().contacts.filter((c) => c.category === 'surface').length).toBeGreaterThan(0)
    const subs = scenario().contacts.filter((c) => c.category === 'subsurface').map((c) => c.id)
    const initialMessages = sent.length
    act(() => el<HTMLInputElement>('[data-testid="ns-traffic-toggle"]').click())
    expect(sent).toHaveLength(initialMessages)
    expect(scenario().contacts.some((c) => c.category === 'surface')).toBe(true)
    act(() => el<HTMLButtonElement>('[data-testid="ns-start"]').click())
    expect(scenario().contacts.filter((c) => c.category === 'surface')).toHaveLength(0)
    expect(scenario().environment.shippingDensity).toBe(0)
    expect(scenario().contacts.filter((c) => c.category === 'subsurface').map((c) => c.id)).toEqual(subs)
    act(() => el<HTMLInputElement>('[data-testid="ns-traffic-toggle"]').click())
    act(() => el<HTMLButtonElement>('[data-testid="ns-start"]').click())
    expect(scenario().contacts.some((c) => c.category === 'surface')).toBe(true)
    expect(scenario().environment.shippingDensity).toBeGreaterThan(0)
    expect(out.filter((m) => m.type === 'error')).toEqual([])
    expect(sent.filter((m) => m.type === 'init').map((m) => m.seed)).toEqual([42, 42, 42])
  })
}
