'use client'

import { useState } from 'react'
import AdminSidebarNav from './AdminSidebarNav'
import AdminMobileNav from './AdminMobileNav'
import AdminAgentTrigger from './AdminAgentTrigger'
import ThemeToggle from '@/components/ThemeToggle'
import SessionGuard from './SessionGuard'

const COOKIE_NAME = 'sidebar_collapsed'

interface NavLink {
  href: string
  label: string
  group?: string
}

interface Props {
  children: React.ReactNode
  desktopNavLinks: NavLink[]
  allNavLinks: NavLink[]
  displayName: string
  usernameInitial: string
  role: string
  canUseAgent: boolean
  logoutForm: React.ReactNode
  initialCollapsed: boolean
}

export default function AdminShell({
  children,
  desktopNavLinks,
  allNavLinks,
  displayName,
  usernameInitial,
  role,
  canUseAgent,
  logoutForm,
  initialCollapsed,
}: Props) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  function toggle() {
    setCollapsed(c => {
      const next = !c
      document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=31536000; SameSite=Lax`
      return next
    })
  }

  return (
    <div className="h-screen flex flex-row bg-surface-secondary">
      {/* Left sidebar — desktop only */}
      <AdminSidebarNav
        navLinks={desktopNavLinks}
        collapsed={collapsed}
        onToggle={toggle}
      />

      {/* Right column: top bar + content */}
      <div className="flex flex-col flex-1 min-w-0 h-full">

        {/* Top bar */}
        <div className="flex items-center px-4 h-12 bg-secondary-500 dark:bg-secondary-700 shrink-0 gap-3">

          {/* Mobile hamburger */}
          <div className="md:hidden flex items-center gap-2">
            <AdminMobileNav
              navLinks={allNavLinks}
              username={displayName}
              role={role}
            />
            <span className="font-bold text-white text-sm">Jeffi Admin</span>
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
            <ThemeToggle variant="admin" />
            <AdminAgentTrigger canUse={canUseAgent} />
            {logoutForm}
          </div>
        </div>

        <main className="flex-1 bg-surface-secondary overflow-y-auto relative z-0">
          {children}
        </main>
        <SessionGuard />
      </div>
      <div id="dropdown-portal" style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999, pointerEvents: 'none' }} />
    </div>
  )
}

