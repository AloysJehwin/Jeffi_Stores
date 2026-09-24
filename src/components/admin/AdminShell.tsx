'use client'

import { useState, useEffect } from 'react'
import AdminSidebarNav from './AdminSidebarNav'
import AdminMobileNav from './AdminMobileNav'
import AdminAgentTrigger from './AdminAgentTrigger'
import NotificationBell from './NotificationBell'
import ScanActionPopup from './ScanActionPopup'
import ThemeToggle from '@/components/ThemeToggle'
import AdminSessionController from './AdminSessionController'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'

const COOKIE_NAME = 'sidebar_collapsed'

interface NavLink {
  href: string
  label: string
  group?: string
  exactMatch?: boolean
}

interface Props {
  children: React.ReactNode
  brandName: string
  desktopNavLinks: NavLink[]
  allNavLinks: NavLink[]
  displayName: string
  usernameInitial: string
  role: string
  scopes: string[]
  host: string
  canUseAgent: boolean
  logoutForm: React.ReactNode
  initialCollapsed: boolean
}

export default function AdminShell({
  children,
  brandName,
  desktopNavLinks,
  allNavLinks,
  displayName,
  usernameInitial,
  role,
  scopes,
  host,
  canUseAgent,
  logoutForm,
  initialCollapsed,
}: Props) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )sidebar_collapsed=([^;]*)/)
    if (m) setCollapsed(m[1] === 'true')
  }, [])

  function toggle() {
    setCollapsed(c => {
      const next = !c
      document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=31536000; SameSite=Lax`
      return next
    })
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-secondary">

      {/* Top bar — full width, spans above sidebar + content */}
      <div className="flex items-center px-4 h-12 bg-secondary-500 dark:bg-secondary-700 shrink-0 gap-3">

        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center gap-2">
          <AdminMobileNav
            navLinks={allNavLinks}
            username={displayName}
            role={role}
          />
          <span className="font-bold text-white text-sm truncate max-w-[9rem]">{brandName}</span>
        </div>

        {/* Brand title + collapse toggle — desktop; pinned to the far left */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {/* Sidebar-panel icon: outer frame + left panel divider, with a
                  chevron pointing the way the sidebar will move. */}
              <rect x="3" y="4" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16" />
              {collapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 9l3 3-3 3" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 9l-3 3 3 3" />
              )}
            </svg>
          </button>
          <span className="font-bold text-white text-sm select-none truncate max-w-[14rem]">{brandName}</span>
        </div>

        {/* Right side: avatar + name + role + theme + logout */}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {usernameInitial}
            </div>
            <div className="hidden sm:block leading-tight">
              <p className="text-xs font-semibold text-white leading-none">{displayName}</p>
              <p className="text-[10px] text-white/60 capitalize">{role}</p>
            </div>
          </div>
          <NotificationBell />
          <ThemeToggle variant="admin" />
          <AdminAgentTrigger canUse={canUseAgent} />
          {logoutForm}
        </div>
      </div>

      {/* Below top bar: sidebar + scrollable content */}
      <div className="flex flex-row flex-1 min-h-0">
        {/* Left sidebar — desktop only */}
        <AdminSidebarNav
          navLinks={desktopNavLinks}
          collapsed={collapsed}
        />

        <main className="flex-1 min-w-0 bg-surface-secondary overflow-y-auto relative z-0">
          <AdminScopesProvider role={role} scopes={scopes}>
            {children}
          </AdminScopesProvider>
        </main>
      </div>

      <AdminSessionController />
      <ScanActionPopup role={role} scopes={scopes} host={host} />
      <div id="dropdown-portal" style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999, pointerEvents: 'none' }} />
    </div>
  )
}

