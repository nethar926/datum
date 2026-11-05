/**
 * iOS Safari starts every AudioContext suspended until a user gesture. The first tap anywhere resumes the
 * shared context and plays one silent sample, after which audio started later works without a gesture.
 */
type Ctor = typeof AudioContext
let ctx: AudioContext | null = null
let unlocked = false

export function sharedAudio(): AudioContext | null {
  if (ctx) return ctx
  const C: Ctor | undefined = (globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor }).AudioContext
    ?? (globalThis as { webkitAudioContext?: Ctor }).webkitAudioContext
  if (!C) return null
  try { ctx = new C() } catch { ctx = null }
  return ctx
}
export const audioUnlocked = (): boolean => unlocked

export function unlockAudioNow(): void {
  const a = sharedAudio(); if (!a) return
  try {
    const b = a.createBuffer(1, 1, a.sampleRate), s = a.createBufferSource()
    s.buffer = b; s.connect(a.destination); s.start(0)
  } catch { /* ignore */ }
  void a.resume?.().then(() => { unlocked = a.state === 'running' }).catch(() => {})
}

/** Install once; removes itself after the first successful unlock. Returns an uninstall function. */
export function installAudioUnlock(target: EventTarget = globalThis): () => void {
  const evs = ['pointerdown', 'touchend', 'keydown'] as const
  const on = () => { unlockAudioNow(); if (unlocked) off() }
  const off = () => evs.forEach((e) => target.removeEventListener(e, on, true))
  evs.forEach((e) => target.addEventListener(e, on, { capture: true, passive: true }))
  return off
}
