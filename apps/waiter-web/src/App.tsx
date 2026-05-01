import { useMemo } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  AuthProvider,
  LocalStorageTokenStorage,
  useAuth,
} from '@serva/auth-context'
import { ApiClientProvider } from './contexts/ApiClientContext'
import { CartProvider, useCart } from './contexts/CartContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { TablesPage } from './pages/TablesPage'
import { MenuPage } from './pages/MenuPage'
import { OrderPage } from './pages/OrderPage'
import { OrdersPage } from './pages/OrdersPage'

// In production the API is served from the same origin as the SPA.
// During Vite dev the proxy in vite.config.ts forwards /api → Fastify.
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

// ---------------------------------------------------------------------------
// Auth guard — used as a layout-route element so protected pages share it
// ---------------------------------------------------------------------------

function ProtectedLayout() {
  const { token } = useAuth()
  const location = useLocation()

  if (!token) {
    // Preserve the attempted URL so LoginPage can redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Layout />
}

// ---------------------------------------------------------------------------
// Route tree
// ---------------------------------------------------------------------------

function AppRoutes() {
  const { token, isLoading } = useAuth()

  if (isLoading) {
    return <div className="app-loading">Lädt…</div>
  }

  return (
    <Routes>
      {/* Public: redirect to /tables once authenticated */}
      <Route
        path="/login"
        element={token ? <Navigate to="/tables" replace /> : <LoginPage />}
      />

      {/* Protected: all render inside the shared Layout shell */}
      <Route element={<ProtectedLayout />}>
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/tables/:tableId/menu" element={<MenuPage />} />
        <Route path="/tables/:tableId/order" element={<OrderPage />} />
        <Route path="/orders" element={<OrdersPage />} />
      </Route>

      {/* Catch-all */}
      <Route
        path="*"
        element={<Navigate to={token ? '/tables' : '/login'} replace />}
      />
    </Routes>
  )
}

// ---------------------------------------------------------------------------
// Provider shell — needs useNavigate, so must live inside <BrowserRouter>
// ---------------------------------------------------------------------------

// AppInner lives inside CartProvider so it can call useCart().
function AppInner() {
  const navigate = useNavigate()
  const { clearCart } = useCart()

  // Stable tokenStorage — created once per mount
  const tokenStorage = useMemo(() => new LocalStorageTokenStorage(), [])

  return (
    <AuthProvider
      baseUrl={API_BASE_URL}
      tokenStorage={tokenStorage}
      onLogout={() => {
        clearCart()
        navigate('/login', { replace: true })
      }}
    >
      <ApiClientProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </ApiClientProvider>
    </AuthProvider>
  )
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <BrowserRouter>
      {/* CartProvider wraps AppInner so clearCart is available before AuthProvider mounts */}
      <CartProvider>
        <AppInner />
      </CartProvider>
    </BrowserRouter>
  )
}
