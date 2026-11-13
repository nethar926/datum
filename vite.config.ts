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
    // Warm-seek first-paint budget is measured in main-thread CPU time
    // (process.threadCpuUsage), not wall clock, so sibling-worker contention
    // and shared-box preemption cannot inflate the sample. Run seek-latency
    // first (groupOrder 0), alone, with maxWorkers 1, so unit/visibility work
    // cannot contend with the fill. Failures still fail the suite.
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'seek-latency',
          include: ['src/cuts/seek.test.ts', 'src/engine/hostCutSeek.test.ts'],
          environment: 'node',
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 0 },
        },
      },
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
