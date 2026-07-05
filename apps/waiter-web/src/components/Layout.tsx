import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@bstoema/auth-context'
import { AnnouncementOverlay } from './AnnouncementOverlay'

export function Layout() {
  const { eventId, user, logout } = useAuth()

  const title = user?.username ?? (eventId ? `Event #${eventId}` : 'BstöMa')

  return (
    <div className="layout">
      <header className="layout-header">
        <span className="layout-title">{title}</span>
        <button className="layout-logout" onClick={logout}>
          Abmelden
        </button>
      </header>

      <main className="layout-main">
        <Outlet />
      </main>

      <nav className="layout-nav">
        <NavLink
          to="/tables"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          Tische
        </NavLink>
        <NavLink
          to="/orders"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          Meine Bestellungen
        </NavLink>
      </nav>

      <AnnouncementOverlay />
    </div>
  )
}
