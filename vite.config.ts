/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'node:path'

// Optional: cross-origin isolation (needed only if you later add multithreaded FFmpeg.wasm).
// Mediabunny + WebCodecs do NOT need it, so it is off by default.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}
const useIsolation = process.env.COOP_COEP === '1'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // Mediabunny ships ESM and uses WebCodecs; keep it out of dep pre-bundling surprises.
  optimizeDeps: { exclude: ['mediabunny'] },
  server: { headers: useIsolation ? isolation : {} },
  preview: { headers: useIsolation ? isolation : {} },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
