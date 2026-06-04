'use client'

import { useState, useEffect } from 'react'
import AdminSidebarNav from './AdminSidebarNav'
import AdminMobileNav from './AdminMobileNav'
import AdminAgentTrigger from './AdminAgentTrigger'
import ThemeToggle from '@/components/ThemeToggle'
import SessionGuard from './SessionGuard'

const STORAGE_KEY = 'admin_sidebar_collapsed'

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
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'true') setCollapsed(true)
    setMounted(true)
  }, [])

  function toggle() {
    setCollapsed(c => {
      const next = !c
      localStorage.setItem(STORAGE_KEY, String(next))
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
        mounted={mounted}
      />

      {/* Right column: top bar + content */}
      <div className="flex flex-col flex-1 min-w-0 h-full">

        {/* Top bar */}
        <div className="flex items-center justify-between px-4 h-12 bg-secondary-500 dark:bg-secondary-700 shrink-0">

          {/* Left: mobile hamburger OR desktop collapse toggle + brand */}
          <div className="flex items-center gap-2">
            {/* Mobile hamburger */}
            <div className="md:hidden flex items-center gap-2">
              <AdminMobileNav
                navLinks={allNavLinks}
                username={displayName}
                role={role}
              />
            </div>

            {/* Desktop: collapse/expand toggle */}
            <button
              type="button"
              onClick={toggle}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden md:flex items-center justify-center w-7 h-7 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              {collapsed ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
                </svg>
              )}
            </button>

            {/* Brand — always visible on desktop */}
            <span className="hidden md:block font-bold text-white text-sm select-none">Jeffi Stores</span>

            {/* Brand — mobile */}
            <span className="md:hidden font-bold text-white text-sm">Jeffi Admin</span>
          </div>

          {/* Right side: avatar + name + role + theme + logout */}
          <div className="flex items-center gap-3">
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
