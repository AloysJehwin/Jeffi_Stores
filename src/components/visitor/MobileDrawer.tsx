'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useCart } from '@/contexts/CartContext'
import ThemeToggle from '@/components/ThemeToggle'

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export default function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { cartCount } = useCart()

  useEffect(() => {
    onClose()
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
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 left-0 bottom-0 z-50 w-4/5 max-w-xs bg-surface-elevated shadow-xl transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex flex-col h-full overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-border-default">
            <Link href="/" className="flex items-center gap-2" onClick={onClose}>
              <img src="/images/logo.png" alt="Jeffi Stores" className="h-10 w-auto" />
              <span className="font-bold text-secondary-500 dark:text-primary-400">Jeffi Stores</span>
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-foreground-muted hover:text-foreground rounded-lg"
              aria-label="Close menu"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-col p-4 gap-1">
            {[
              { href: '/', label: 'Home' },
              { href: '/products', label: 'Products' },
              { href: '/categories', label: 'Categories' },
              { href: '/about', label: 'About Us' },
              { href: '/support', label: 'Support' },
            ].map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-3 rounded-lg font-medium transition-colors ${
                  pathname === link.href
                    ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400'
                    : 'text-foreground-secondary hover:bg-surface-secondary'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="border-t border-border-default mx-4" />

          <div className="flex flex-col p-4 gap-1">
            <Link
              href="/cart"
              className="flex items-center justify-between px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              <span className="font-medium">Cart</span>
              {cartCount > 0 && (
                <span className="bg-accent-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                  {cartCount}
                </span>
              )}
            </Link>
            <Link
              href="/wishlist"
              className="px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors"
            >
              Wishlist
            </Link>
          </div>

          <div className="border-t border-border-default mx-4" />

          <div className="flex flex-col p-4 gap-1">
            {user ? (
              <>
                <div className="px-4 py-2 text-sm text-foreground-muted">
                  Signed in as {user.firstName || user.email}
                </div>
                <Link
                  href="/account"
                  className="px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors"
                >
                  My Account
                </Link>
                <Link
                  href="/account/orders"
                  className="px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors"
                >
                  My Orders
                </Link>
                <button
                  type="button"
                  onClick={() => { logout(); onClose() }}
                  className="px-4 py-3 rounded-lg text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-3 rounded-lg bg-accent-500 text-white text-center font-medium hover:bg-accent-600 transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/signup"
                  className="px-4 py-3 rounded-lg text-center text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>

          <div className="mt-auto p-4 border-t border-border-default">
            <div className="flex items-center justify-between px-4">
              <span className="text-sm text-foreground-muted">Theme</span>
              <ThemeToggle variant="header" />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
