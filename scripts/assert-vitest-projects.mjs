#!/usr/bin/env node
/** Cheap CI check: `npm test` → vitest run must load unit + seek-latency + cut-visibility. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'vite.config.ts'), 'utf8')
const required = ['unit', 'seek-latency', 'cut-visibility']
const missing = required.filter((name) => !new RegExp(`name:\\s*'${name}'`).test(src))
if (missing.length) {
  console.error(`[assert-vitest-projects] vite.config.ts missing projects: ${missing.join(', ')}`)
  process.exit(1)
}
if (!/include:\s*\[\s*'src\/cuts\/seek\.test\.ts'/.test(src) || !/hostCutSeek\.test\.ts/.test(src)) {
  console.error('[assert-vitest-projects] seek-latency project must include seek.test.ts and hostCutSeek.test.ts')
  process.exit(1)
}
if (!/maxWorkers:\s*1/.test(src)) {
  console.error('[assert-vitest-projects] seek-latency must pin maxWorkers: 1')
  process.exit(1)
}
console.log('[assert-vitest-projects] ok:', required.join(', '))
