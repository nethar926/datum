#!/usr/bin/env node
/** FE build: tsc -b must be clean (no ignored acoustics errors). */
import { spawnSync } from 'node:child_process'

const tsc = spawnSync('npx', ['tsc', '-b', '--pretty', 'false'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const out = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
if (tsc.status) {
  console.error(out)
  process.exit(tsc.status ?? 1)
}
const vite = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit' })
process.exit(vite.status ?? 1)
