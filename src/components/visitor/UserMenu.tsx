'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

export default function UserMenu() {
  const { user, logout } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  if (!user) {
    return (
      <Link
        href="/login"
        className="flex items-center gap-2 px-4 py-2 text-foreground-secondary hover:text-accent-500 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span className="hidden lg:inline font-medium">Login</span>
      </Link>
    )
  }

  const initials = `${user.firstName.charAt(0)}${user.lastName?.charAt(0) || ''}`.toUpperCase()

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-2 hover:bg-surface-secondary rounded-lg transition-colors"
      >
        <div className="w-10 h-10 bg-accent-500 text-white rounded-full flex items-center justify-center font-semibold">
          {initials}
        </div>
        <div className="hidden lg:block text-left">
          <div className="text-sm font-medium text-foreground">{user.firstName}</div>
        </div>
        <svg className={`w-4 h-4 text-foreground-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1rem)] bg-surface-elevated rounded-lg shadow-lg border border-border-default py-2 z-50">
          <div className="px-4 py-3 border-b border-border-default">
            <p className="text-sm font-semibold text-foreground">{user.firstName} {user.lastName}</p>
            <p className="text-xs text-foreground-muted truncate">{user.email}</p>
          </div>

          <Link
            href="/account"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 px-4 py-2 text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            My Account
          </Link>

          <Link
            href="/account/orders"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 px-4 py-2 text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            My Orders
          </Link>

          <Link
            href="/wishlist"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 px-4 py-2 text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            Wishlist
          </Link>

          <div className="border-t border-border-default my-2"></div>

          <button
            onClick={() => {
              setIsOpen(false)
              logout()
            }}
            className="flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      )}
    </div>
  )
}
