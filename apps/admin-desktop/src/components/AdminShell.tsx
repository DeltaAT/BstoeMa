import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@bstoema/auth-context";
import { useApiClient } from "../contexts/ApiClientContext";
import { WindowControls } from "./WindowControls";

const NAV_ITEMS = [
  { segment: "overview",       label: "Übersicht" },
  { segment: "menu",           label: "Speisekarte" },
  { segment: "tables",         label: "Tische" },
  { segment: "printers",       label: "Drucker" },
  { segment: "order-displays", label: "Bestellanzeigen" },
  { segment: "users",          label: "Benutzer" },
  { segment: "stock",          label: "Lager" },
  { segment: "orders",         label: "Bestellungen" },
  { segment: "statistics",     label: "Statistik" },
  { segment: "logs",           label: "Logs" },
  { segment: "config",         label: "Einstellungen" },
] as const;

export function AdminShell() {
  const { eventId } = useParams<{ eventId: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const api = useApiClient();
  const [eventName, setEventName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.adminEvents
      .getActive()
      .then((event) => {
        if (!cancelled) setEventName(event.eventName);
      })
      .catch(() => {
        if (!cancelled) setEventName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const base = `/events/${eventId}`;

  return (
    <div className="shell">
      {/* Windows-style title bar - full width, draggable */}
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title">
          {eventName ? `${eventName} · BstöMa Admin` : "BstöMa Admin"}
        </span>
        <WindowControls />
      </div>

      {/* Shell body: sidebar + main content */}
      <div className="shell-body">
        <nav className="sidebar">
          <div className="sidebar-header">
            <span className="app-name">BstöMa</span>
            <span className="sidebar-subtitle">Admin</span>
          </div>

          <ul className="nav-list">
            {NAV_ITEMS.map(({ segment, label }) => (
              <li key={segment}>
                <NavLink
                  to={`${base}/${segment}`}
                  className={({ isActive }) =>
                    `nav-link${isActive ? " nav-link--active" : ""}`
                  }
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>

          <button className="logout-btn" onClick={handleLogout}>
            Abmelden
          </button>
        </nav>

        <div className="main-area">
          <main className="page-content">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
