'use client'

import { DEFAULT_NAV } from '@/lib/site/chrome-types'
import { useState } from 'react'
import Link from 'next/link'
import SearchBar from './SearchBar'
import UserMenu from './UserMenu'
import MobileDrawer from './MobileDrawer'
import ThemeToggle from '@/components/ThemeToggle'
import AiAssistantButton from './AiAssistantButton'
import { useCart } from '@/contexts/CartContext'
import { useWishlist } from '@/contexts/WishlistContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { StoreLogoMark } from './site/code/parts/chrome/marks'
import CartLink from './site/code/parts/chrome/CartLink'

export default function Header() {
  const { cartCount } = useCart()
  const { count: wishlistCount } = useWishlist()
  const { identity, storefront, chrome } = useStoreConfig()
  // Site Builder's menu links when set; the first three always show, the rest from xl up so no label wraps.
  const nav = chrome?.nav?.length ? chrome.nav : DEFAULT_NAV
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <>
      <header className="bg-surface-elevated shadow-sm dark:shadow-none dark:border-b dark:border-border-default fixed top-0 left-0 right-0 z-40 w-full pt-[env(safe-area-inset-top,0px)]">
        <div className="container mx-auto px-3 sm:px-4 relative">
          <div className="flex items-center justify-between h-16 sm:h-16 lg:h-20 gap-3">
            {/* Logo: the name truncates on phones so the icon row always fits */}
            <Link href="/" className="flex items-center min-w-0 lg:shrink-0">
              <StoreLogoMark name={identity.name} logoUrl={identity.logoUrl} tagline={storefront.metaTagline} />
            </Link>

            {/* Desktop Navigation: About Us and Support drop out below xl so no label wraps */}
            <nav
              className={`hidden lg:flex items-center gap-5 xl:gap-8 whitespace-nowrap transition-all duration-300 ${
                searchOpen
                  ? 'opacity-0 pointer-events-none -translate-y-1 invisible'
                  : 'opacity-100 translate-y-0 visible'
              }`}
              aria-hidden={searchOpen}
            >
              {nav.map((l, i) => (
                <Link
                  key={`${l.href}:${i}`}
                  href={l.href}
                  className={`${i >= 3 ? 'hidden xl:inline ' : ''}text-foreground-secondary hover:text-accent-500 font-medium transition-colors`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            {/* Right Actions */}
            <div className="flex items-center gap-0 sm:gap-4 shrink-0">
              {/* Search Bar */}
              <SearchBar isOpen={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} />

              {/* AI Assistant (logged-in only) */}
              <AiAssistantButton />

              {/* Wishlist Icon */}
              <Link
                href="/wishlist"
                aria-label={wishlistCount > 0 ? `Wishlist, ${wishlistCount} items` : 'Wishlist'}
                className="hidden sm:flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center text-foreground-secondary hover:text-accent-500 transition-all hover:scale-110 active:scale-95 relative"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
                {wishlistCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                    {wishlistCount > 99 ? '99+' : wishlistCount}
                  </span>
                )}
              </Link>

              {/* Cart Icon */}
              <CartLink count={cartCount} />

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
                className="lg:hidden relative p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-secondary hover:text-accent-500 transition-all active:scale-90"
                onClick={() => setMobileMenuOpen(true)}
                aria-label={cartCount > 0 ? `Open menu, ${cartCount} in cart` : 'Open menu'}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                {/* Phones keep the cart in the drawer, so its count rides on the menu button. */}
                {cartCount > 0 && (
                  <span className="sm:hidden absolute top-0.5 right-0.5 bg-accent-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <MobileDrawer isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </>
  )
}
