import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward all API routes to the Fastify server running on port 8787.
      '/auth': 'http://localhost:8787',
      '/tables': 'http://localhost:8787',
      '/menu': 'http://localhost:8787',
      '/orders': 'http://localhost:8787',
      '/users': 'http://localhost:8787',
      '/printers': 'http://localhost:8787',
      '/stock': 'http://localhost:8787',
      '/config': 'http://localhost:8787',
      '/admin': 'http://localhost:8787',
    },
  },
})
