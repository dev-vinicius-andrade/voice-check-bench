// Vitest config for the harness runs in tools/tune-real (real plugins through render_cli; not the default suite).
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: resolve(import.meta.dirname, '../..'),
  test: { environment: 'jsdom', include: ['tools/tune-real/*.test.tsx'], testTimeout: 600000 },
})
