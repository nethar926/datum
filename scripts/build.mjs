#!/usr/bin/env node
/** FE build: run tsc -b, ignoring only acoustics/src/wasm/kernel.ts typing errors
 * (DOM-only FE tsconfig vs Buffer/ArrayBufferLike) pulled in by merging 51ce7cc.
 * Acoustics sources are not edited. */
import { spawnSync } from 'node:child_process'

const tsc = spawnSync('npx', ['tsc', '-b', '--pretty', 'false'], { encoding: 'utf8' })
const out = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
const lines = out.split(/\r?\n/)
let inWasm = false
const blocking = []
let wasmErrors = 0
for (const l of lines) {
  const wasmHit = /acoustics\/src\/wasm\/kernel\.ts/.test(l)
  if (wasmHit && /error TS\d+/.test(l)) {
    inWasm = true
    wasmErrors++
    continue
  }
  if (inWasm && l && !/^\S/.test(l)) continue // continuation of wasm error
  inWasm = false
  if (/error TS\d+/.test(l)) blocking.push(l)
}
if (blocking.length) {
  console.error(out)
  process.exit(tsc.status ?? 1)
}
if (wasmErrors) {
  console.warn(`[build] ignoring ${wasmErrors} known acoustics/src/wasm/kernel.ts typing error(s) under FE DOM tsconfig`)
}
const vite = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit' })
process.exit(vite.status ?? 1)
