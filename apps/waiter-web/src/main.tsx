import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider, LocalStorageTokenStorage } from '@serva/auth-context'
import './index.css'
import App from './App.tsx'

const tokenStorage = new LocalStorageTokenStorage()

// In production the API runs on the same host that serves the waiter-web SPA.
// During dev Vite proxies /api → the Fastify server, so '' works in both cases.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined ?? ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider
      baseUrl={API_BASE_URL}
      tokenStorage={tokenStorage}
      onLogout={() => {
        // TODO: wire up router navigation to /login once a router is added
        window.location.replace('/login')
      }}
    >
      <App />
    </AuthProvider>
  </StrictMode>,
)
