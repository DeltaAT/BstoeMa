import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { useAuth } from "@serva/auth-context";
import { ApiClientProvider } from "./contexts/ApiClientContext";
import { AdminShell } from "./components/AdminShell";
import { LoginPage } from "./pages/LoginPage";
import { EventsPage } from "./pages/EventsPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { MenuPage } from "./pages/MenuPage";
import { OverviewPage } from "./pages/OverviewPage";
import { TablesPage } from "./pages/TablesPage";
import { PrintersPage } from "./pages/PrintersPage";
import { OrderDisplaysPage } from "./pages/OrderDisplaysPage";
import { UsersPage } from "./pages/UsersPage";
import { StockPage } from "./pages/StockPage";
import { ConfigPage } from "./pages/ConfigPage";
import { OrdersPage } from "./pages/OrdersPage";
import { LogsPage } from "./pages/LogsPage";
import "./App.css";

// ---------------------------------------------------------------------------
// Env config
// ---------------------------------------------------------------------------

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

// ---------------------------------------------------------------------------
// Route guards
// ---------------------------------------------------------------------------

/** Shows a full-screen loading spinner while auth state is being rehydrated. */
function LoadingScreen() {
  return <div className="loading-screen">Laden…</div>;
}

/**
 * Allows access only when role === "master".
 * Redirects to /login while loading or if unauthenticated.
 */
function RequireMaster() {
  const { role, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (role !== "master") return <Navigate to="/login" replace />;
  return <Outlet />;
}

/**
 * Allows access only when role === "admin" AND the token's eventId matches
 * the :eventId URL param. Redirects to /login otherwise.
 */
function RequireAdmin() {
  const { role, eventId: authEventId, isLoading } = useAuth();
  const { eventId: paramEventId } = useParams<{ eventId: string }>();
  if (isLoading) return <LoadingScreen />;
  if (role !== "admin") return <Navigate to="/login" replace />;
  if (String(authEventId) !== paramEventId) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/**
 * Root path redirect: sends authenticated users to their home screen;
 * everyone else to /login.
 */
function RootRedirect() {
  const { role, eventId, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (role === "master") return <Navigate to="/events" replace />;
  if (role === "admin" && eventId != null) {
    return <Navigate to={`/events/${eventId}/overview`} replace />;
  }
  return <Navigate to="/login" replace />;
}

// ---------------------------------------------------------------------------
// Route tree
// ---------------------------------------------------------------------------

function AppRoutes() {
  return (
    <Routes>
      {/* Root: smart redirect based on auth state */}
      <Route path="/" element={<RootRedirect />} />

      {/* Master login */}
      <Route path="/login" element={<LoginPage />} />

      {/* Master-only: event management */}
      <Route element={<RequireMaster />}>
        <Route path="/events" element={<EventsPage />} />
      </Route>

      {/* Admin login for a specific event (no role guard — any visitor can reach this) */}
      <Route path="/events/:eventId/admin-login" element={<AdminLoginPage />} />

      {/* Admin shell: requires admin role scoped to :eventId */}
      <Route path="/events/:eventId" element={<RequireAdmin />}>
        <Route element={<AdminShell />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview"       element={<OverviewPage />} />
          <Route path="menu"           element={<MenuPage />} />
          <Route path="tables"         element={<TablesPage />} />
          <Route path="printers"       element={<PrintersPage />} />
          <Route path="order-displays" element={<OrderDisplaysPage />} />
          <Route path="users"          element={<UsersPage />} />
          <Route path="stock"          element={<StockPage />} />
          <Route path="config"         element={<ConfigPage />} />
          <Route path="orders"         element={<OrdersPage />} />
          <Route path="logs"           element={<LogsPage />} />
        </Route>
      </Route>

      {/* Catch-all: fall back to root redirect */}
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <BrowserRouter>
      <ApiClientProvider baseUrl={API_BASE_URL}>
        <AppRoutes />
      </ApiClientProvider>
    </BrowserRouter>
  );
}
