'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SearchBar from '@/components/visitor/SearchBar'
import ThemeToggle from '@/components/ThemeToggle'
import { useCart } from '@/contexts/CartContext'
import { useAuth } from '@/contexts/AuthContext'
import { bp } from '@/lib/business-path'

export default function BusinessHeader() {
  const { cartCount } = useCart()
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pulseBadge, setPulseBadge] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const prevCount = useRef(cartCount)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (cartCount > prevCount.current) {
      setPulseBadge(true)
      const t = setTimeout(() => setPulseBadge(false), 500)
      prevCount.current = cartCount
      return () => clearTimeout(t)
    }
    prevCount.current = cartCount
  }, [cartCount])

  useEffect(() => {
    setMobileMenuOpen(false)
    setUserMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    if (userMenuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [userMenuOpen])

  const NAV = [
    { href: '/business/products', label: 'Products' },
    { href: '/business/categories', label: 'Categories' },
    { href: '/business/about', label: 'About Us' },
    { href: '/business/support', label: 'Support' },
  ]

  return (
    <>
      <header className="bg-surface-elevated shadow-sm dark:shadow-none dark:border-b dark:border-border-default fixed top-0 left-0 right-0 z-40 w-full">
        <div className="container mx-auto px-3 sm:px-4 relative">
          <div className="flex items-center justify-between h-16 sm:h-16 lg:h-20 gap-3">

            {/* Logo */}
            <Link href={bp('/business')} className="flex items-center shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <img src="/images/logo.png" alt="Jeffi Stores Logo" className="h-8 sm:h-10 lg:h-12 w-auto" />
                <div>
                  <div className="text-base sm:text-lg lg:text-xl font-bold text-secondary-500 dark:text-primary-400 leading-tight">Jeffi Stores</div>
                  <div className="text-[10px] sm:text-xs text-accent-500 font-semibold leading-tight">Business</div>
                </div>
              </div>
            </Link>

            {/* Desktop Nav */}
            <nav
              className={`hidden lg:flex items-center gap-8 transition-all duration-300 ${
                searchOpen ? 'opacity-0 pointer-events-none -translate-y-1 invisible' : 'opacity-100 translate-y-0 visible'
              }`}
              aria-hidden={searchOpen}
            >
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={bp(href)}
                  className={`font-medium transition-colors ${
                    pathname.startsWith(bp(href)) ? 'text-accent-500' : 'text-foreground-secondary hover:text-accent-500'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>

            {/* Right Actions */}
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <SearchBar isOpen={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} basePath={bp('/business/products')} />

              {/* Cart */}
              <Link href={bp('/business/cart')} className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-secondary hover:text-accent-500 transition-all active:scale-95 relative group">
                <svg className="w-6 h-6 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {cartCount > 0 && (
                  <span className={`absolute top-0.5 right-0.5 bg-accent-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center transition-transform duration-300 ${pulseBadge ? 'animate-cart-pulse' : ''}`}>
                    {cartCount}
                  </span>
                )}
              </Link>

              {/* User menu */}
              <div className="hidden sm:block relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(o => !o)}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-surface-secondary transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-accent-500 flex items-center justify-center text-white text-sm font-bold">
                    {user?.firstName?.[0]?.toUpperCase() || 'B'}
                  </div>
                  <span className="hidden lg:block text-sm font-medium text-foreground max-w-[120px] truncate">
                    {user?.firstName || 'Account'}
                  </span>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-surface-elevated border border-border-default rounded-xl shadow-lg py-1 z-50">
                    <Link href={bp('/business/account')} className="block px-4 py-2.5 text-sm text-foreground hover:bg-surface-secondary transition-colors">My Profile</Link>
                    <Link href={bp('/business/account/orders')} className="block px-4 py-2.5 text-sm text-foreground hover:bg-surface-secondary transition-colors">My Orders</Link>
                    <Link href={bp('/business/quotes')} className="block px-4 py-2.5 text-sm text-foreground hover:bg-surface-secondary transition-colors">My Quotes</Link>
                    <div className="border-t border-border-default my-1" />
                    <button onClick={logout} className="block w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-surface-secondary transition-colors">
                      Sign Out
                    </button>
                  </div>
                )}
              </div>

              <div className="hidden lg:block">
                <ThemeToggle variant="header" />
              </div>

              {/* Mobile menu button */}
              <button
                type="button"
                className="lg:hidden p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-secondary hover:text-accent-500 transition-all active:scale-90"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <>
          <div
            className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className={`fixed top-0 left-0 bottom-0 z-50 w-4/5 max-w-xs bg-surface-elevated shadow-xl flex flex-col overflow-y-auto transition-transform duration-300 ease-in-out ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
          >
            <div className="flex items-center justify-between p-4 border-b border-border-default">
              <Link href={bp('/business')} className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                <img src="/images/logo.png" alt="Jeffi Stores" className="h-10 w-auto" />
                <div>
                  <span className="font-bold text-secondary-500 dark:text-primary-400">Jeffi Stores</span>
                  <p className="text-xs text-accent-500 font-semibold">Business</p>
                </div>
              </Link>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-2 text-foreground-muted hover:text-foreground rounded-lg">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Main nav */}
            <nav className="flex flex-col p-4 gap-1">
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={bp(href)}
                  className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    pathname.startsWith(bp(href)) ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400' : 'text-foreground-secondary hover:bg-surface-secondary'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>

            <div className="border-t border-border-default mx-4" />

            {/* Cart */}
            <div className="flex flex-col p-4 gap-1">
              <Link
                href={bp('/business/cart')}
                className="flex items-center justify-between px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="font-medium">Cart</span>
                {cartCount > 0 && (
                  <span className="bg-accent-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                    {cartCount}
                  </span>
                )}
              </Link>
            </div>

            <div className="border-t border-border-default mx-4" />

            {/* Account section */}
            <div className="flex flex-col p-4 gap-1">
              {user && (
                <div className="flex items-center gap-3 px-4 py-2">
                  <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.firstName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-accent-500 text-white flex items-center justify-center font-semibold">
                        {`${user.firstName.charAt(0)}${user.lastName?.charAt(0) || ''}`.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{user.firstName} {user.lastName}</p>
                    <p className="text-xs text-foreground-muted truncate">{user.email}</p>
                  </div>
                </div>
              )}
              <Link href={bp('/business/account')} className="px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors text-sm">
                My Profile
              </Link>
              <Link href={bp('/business/account/orders')} className="px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors text-sm">
                My Orders
              </Link>
              <Link href={bp('/business/quotes')} className="px-4 py-3 rounded-lg text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors text-sm">
                My Quotes
              </Link>
              <button
                type="button"
                onClick={() => { logout(); setMobileMenuOpen(false) }}
                className="px-4 py-3 rounded-lg text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors text-sm"
              >
                Sign Out
              </button>
            </div>

            <div className="mt-auto p-4 border-t border-border-default">
              <div className="flex items-center justify-between px-4">
                <span className="text-sm text-foreground-muted">Theme</span>
                <ThemeToggle variant="header" />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
