import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const acoustics = fileURLToPath(new URL('./acoustics/src/index.ts', import.meta.url))

// GitHub Pages serves the app under /sonar-sim/. Override with SONAR_BASE=/ for root hosting.
export default defineConfig({
  base: process.env.SONAR_BASE ?? '/sonar-sim/',
  plugins: [react()],
  resolve: { alias: { '@acoustics': acoustics } },
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
