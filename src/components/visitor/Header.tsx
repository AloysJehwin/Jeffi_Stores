'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import SearchBar from './SearchBar'
import UserMenu from './UserMenu'
import MobileDrawer from './MobileDrawer'
import ThemeToggle from '@/components/ThemeToggle'
import AiAssistantButton from './AiAssistantButton'
import { useCart } from '@/contexts/CartContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

export default function Header() {
  const { cartCount } = useCart()
  const { identity, storefront } = useStoreConfig()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pulseBadge, setPulseBadge] = useState(false)
  const prevCount = useRef(cartCount)

  useEffect(() => {
    if (cartCount > prevCount.current) {
      setPulseBadge(true)
      const t = setTimeout(() => setPulseBadge(false), 500)
      prevCount.current = cartCount
      return () => clearTimeout(t)
    }
    prevCount.current = cartCount
  }, [cartCount])

  return (
    <>
      <header className="bg-surface-elevated shadow-sm dark:shadow-none dark:border-b dark:border-border-default fixed top-0 left-0 right-0 z-40 w-full pt-[env(safe-area-inset-top,0px)]">
        <div className="container mx-auto px-3 sm:px-4 relative">
          <div className="flex items-center justify-between h-16 sm:h-16 lg:h-20 gap-3">
            {/* Logo */}
            <Link href="/" className="flex items-center shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                {identity.logoUrl && <img
                  src={identity.logoUrl}
                  alt={`${identity.name} Logo`}
                  className="h-8 sm:h-10 lg:h-12 w-auto"
                />}
                <div>
                  <div className="text-base sm:text-lg lg:text-xl font-bold text-secondary-500 dark:text-primary-400">{identity.name}</div>
                  {storefront.metaTagline && (
                    <div className="hidden sm:block text-xs text-foreground-muted">{storefront.metaTagline}</div>
                  )}
                </div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav
              className={`hidden lg:flex items-center gap-8 transition-all duration-300 ${
                searchOpen
                  ? 'opacity-0 pointer-events-none -translate-y-1 invisible'
                  : 'opacity-100 translate-y-0 visible'
              }`}
              aria-hidden={searchOpen}
            >
              <Link href="/" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">
                Home
              </Link>
              <Link href="/products" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">
                Products
              </Link>
              <Link href="/categories" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">
                Categories
              </Link>
              <Link href="/about" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">
                About Us
              </Link>
              <Link href="/support" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">
                Support
              </Link>
            </nav>

            {/* Right Actions */}
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              {/* Search Bar */}
              <SearchBar isOpen={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} />

              {/* AI Assistant (logged-in only) */}
              <AiAssistantButton />

              {/* Wishlist Icon */}
              <Link href="/wishlist" className="hidden sm:flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center text-foreground-secondary hover:text-accent-500 transition-all hover:scale-110 active:scale-95 relative">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </Link>

              {/* Cart Icon */}
              <Link href="/cart" className="hidden min-[400px]:flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center text-foreground-secondary hover:text-accent-500 transition-all active:scale-95 relative group">
                <svg className="w-6 h-6 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {cartCount > 0 && (
                  <span className={`absolute top-0.5 right-0.5 bg-accent-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center transition-transform duration-300 ${pulseBadge ? 'animate-cart-pulse' : ''}`}>
                    {cartCount}
                  </span>
                )}
              </Link>

              {/* User Menu (hidden on small mobile) */}
              <div className="hidden sm:block">
                <UserMenu />
              </div>

              {/* Theme Toggle (desktop only) */}
              <div className="hidden lg:block">
                <ThemeToggle variant="header" />
              </div>

              {/* Mobile Menu Button */}
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

      <MobileDrawer isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </>
  )
}
