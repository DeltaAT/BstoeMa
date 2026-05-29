import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The waiter PWA lives under `/waiter/` in both dev and prod so its client
// routes (`/waiter/tables`, `/waiter/orders`, …) never collide with the API
// route paths (`/tables`, `/orders`, …). Without this, reloading a page like
// `/tables` resolves to the API and shows the JSON response instead of the GUI.
// API calls use root-absolute paths and are proxied to the API on :8787.
export default defineConfig(() => ({
  plugins: [react()],
  base: '/waiter/',
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
