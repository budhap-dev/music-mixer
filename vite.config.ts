import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // already a single ESM file; letting the dev optimizer discover it inside
    // the worker triggers a mid-session full page reload
    exclude: ['@echogarden/rubberband-wasm'],
  },
})
