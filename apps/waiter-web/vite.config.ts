import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In production the waiter PWA is served by the Fastify API at `/waiter/`.
// Vite needs the matching `base` so emitted asset URLs resolve correctly.
// Dev keeps `base = '/'` and proxies API calls to the API on :8787.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/waiter/' : '/',
  server: {
    proxy: {
      '/auth': 'http://localhost:8787',
      '/tables': 'http://localhost:8787',
      '/menu': 'http://localhost:8787',
      '/orders': 'http://localhost:8787',
      '/users': 'http://localhost:8787',
      '/printers': 'http://localhost:8787',
      '/stock': 'http://localhost:8787',
      '/config': 'http://localhost:8787',
      '/admin': 'http://localhost:8787',
      '/host-info': 'http://localhost:8787',
    },
  },
}))
