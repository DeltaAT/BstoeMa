import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker — only in production. In dev, base is `/` and a SW at root
// scope would intercept Vite's HMR and the API proxy. In prod, base is
// `/waiter/`, so `${BASE_URL}sw.js` is `/waiter/sw.js` with scope `/waiter/`
// — API requests under `/orders`, `/auth`, etc. are outside that scope and
// the SW never sees them, which is exactly what we want.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err)
      })
  })
}
