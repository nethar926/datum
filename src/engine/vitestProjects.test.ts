import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('vitest projects (npm test)', () => {
  it('declares unit, seek-latency (maxWorkers 1), and cut-visibility', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const src = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    for (const name of ['unit', 'seek-latency', 'cut-visibility']) {
      expect(src, name).toMatch(new RegExp(`name:\\s*'${name}'`))
    }
    expect(src).toMatch(/seek-latency[\s\S]*?maxWorkers:\s*1/)
    expect(src).toMatch(/include:\s*\[\s*'src\/cuts\/seek\.test\.ts'\s*,\s*'src\/engine\/hostCutSeek\.test\.ts'\s*\]/)
  })
})
