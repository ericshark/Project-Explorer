import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { loadPrivateEnv } from './server/env.ts'

loadPrivateEnv()

const hubPort = process.env.HUB_PORT ?? '4600'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: Number(process.env.WEB_PORT ?? 4610),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${hubPort}` },
  },
})
