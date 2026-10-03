import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${loadEnv(mode, process.cwd(), '').BACKEND_PORT || '8000'}`,
        ws: true,
      },
    },
  },
  plugins: [react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { include: ['avr8js', 'rp2040js', '@wokwi/elements', 'littlefs'] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@pro': fileURLToPath(new URL('./vendor/velxio/frontend/src/__pro_stub__', import.meta.url)),
      '@velxio': fileURLToPath(new URL('./vendor/velxio/frontend/src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', 'zustand'],
  },
}))
