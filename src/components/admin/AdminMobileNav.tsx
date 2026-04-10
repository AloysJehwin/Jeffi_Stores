'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'

interface NavLink {
  href: string
  label: string
}

interface AdminMobileNavProps {
  navLinks: NavLink[]
  username: string
  role: string
}

export default function AdminMobileNav({ navLinks, username, role }: AdminMobileNavProps) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  return (
    <>
      {/* Hamburger button */}
      <button
        type="button"
        className="md:hidden p-2 text-gray-300 hover:text-white transition-colors"
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 left-0 bottom-0 z-50 w-[80vw] max-w-[300px] bg-secondary-600 dark:bg-secondary-800 shadow-xl transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-white">Admin Panel</h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-2 text-gray-300 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* User info */}
          <div className="px-4 py-3 text-sm text-gray-300 border-b border-white/10">
            {username} <span className="text-gray-400">({role})</span>
          </div>

          {/* Nav Links */}
          <nav className="flex flex-col p-3 gap-1 flex-1">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className={`px-4 py-3 rounded-lg font-medium transition-colors ${
                  pathname === link.href || (link.href !== '/admin/dashboard' && pathname?.startsWith(link.href))
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Theme toggle */}
          <div className="p-4 border-t border-white/10">
            <div className="flex items-center justify-between px-2">
              <span className="text-sm text-gray-400">Theme</span>
              <ThemeToggle variant="admin" />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
