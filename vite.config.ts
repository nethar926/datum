import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const acoustics = fileURLToPath(new URL('./acoustics/src/index.ts', import.meta.url))
const alias = { '@acoustics': acoustics }

// GitHub Pages serves the app under /sonar-sim/. Override with SONAR_BASE=/ for root hosting.
export default defineConfig({
  base: process.env.SONAR_BASE ?? '/datum/',
  plugins: [react()],
  resolve: { alias },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    // Warm-seek 150 ms budget is wall-clock CPU-sensitive. Keep CutSession-heavy
    // visibility work and the seek latency tests off the shared parallel pool so
    // they cannot starve each other (or be starved by host/cutNorm render work).
    // groupOrder runs projects sequentially; failures still fail the suite.
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [
            'src/cuts/cutVisibility.test.ts',
            'src/cuts/seek.test.ts',
            'src/engine/hostCutSeek.test.ts',
          ],
          environment: 'node',
          sequence: { groupOrder: 0 },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'seek-latency',
          include: ['src/cuts/seek.test.ts', 'src/engine/hostCutSeek.test.ts'],
          environment: 'node',
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'cut-visibility',
          include: ['src/cuts/cutVisibility.test.ts'],
          environment: 'node',
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
})
