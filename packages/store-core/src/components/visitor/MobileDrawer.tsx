'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useCart } from '@/contexts/CartContext'
import { useWishlist } from '@/contexts/WishlistContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import ThemeToggle from '@/components/ThemeToggle'
import { CookieSettingsLink } from './CookieConsentBanner'

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

type DrawerCategory = { id: string; name: string; slug: string; parent_category_id: string | null }

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/about', label: 'About Us' },
  { href: '/support', label: 'Support' },
  { href: '/contact', label: 'Contact' },
]
const MAX_CATEGORIES = 12
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

const row = 'flex items-center min-h-[44px] px-4 py-2.5 rounded-lg font-medium transition-colors'

export default function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { cartCount } = useCart()
  const { count: wishlistCount } = useWishlist()
  const { identity } = useStoreConfig()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [categories, setCategories] = useState<DrawerCategory[] | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    onClose()
  }, [pathname])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Top-level categories, fetched once on first open.
  useEffect(() => {
    if (!isOpen || categories) return
    let active = true
    fetch('/api/categories')
      .then(r => (r.ok ? r.json() : { categories: [] }))
      .then(d => {
        if (!active) return
        const all: DrawerCategory[] = Array.isArray(d?.categories) ? d.categories : []
        setCategories(all.filter(c => !c.parent_category_id))
      })
      .catch(() => active && setCategories([]))
    return () => {
      active = false
    }
  }, [isOpen, categories])

  // Focus moves into the panel, Tab stays inside it, Esc closes and focus returns to the opener.
  useEffect(() => {
    if (!isOpen) return
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetParent !== null
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [isOpen])

  const shown = categories?.slice(0, MAX_CATEGORIES) ?? []

  return (
    <>
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`fixed top-0 left-0 bottom-0 z-50 w-4/5 max-w-xs bg-surface-elevated shadow-xl transition-[transform,visibility] duration-300 ease-in-out pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] ${isOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'}`}
      >
        <div className="flex flex-col h-full overflow-y-auto overscroll-contain">
          <div className="flex items-center justify-between gap-2 p-4 border-b border-border-default">
            <Link href="/" className="flex items-center gap-2 min-w-0" onClick={onClose}>
              {identity.logoUrl && (
                <img src={identity.logoUrl} alt="" className="h-10 w-auto max-w-[6rem] object-contain" />
              )}
              <span className="font-bold text-secondary-500 dark:text-primary-400 truncate">{identity.name}</span>
            </Link>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-muted hover:text-foreground rounded-lg"
              aria-label="Close menu"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav aria-label="Main" className="flex flex-col p-4 gap-1">
            {NAV.map(link => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
                className={`${row} ${
                  pathname === link.href
                    ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400'
                    : 'text-foreground-secondary hover:bg-surface-secondary'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {shown.length > 0 && (
            <>
              <div className="border-t border-border-default mx-4" />
              <div className="p-4">
                <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Shop by category
                </p>
                <ul className="flex flex-col gap-0.5">
                  {shown.map(c => (
                    <li key={c.id}>
                      <Link
                        href={`/categories/${c.slug}`}
                        className={`${row} text-sm text-foreground-secondary hover:bg-surface-secondary`}
                      >
                        <span className="truncate">{c.name}</span>
                      </Link>
                    </li>
                  ))}
                  {(categories?.length ?? 0) > MAX_CATEGORIES && (
                    <li>
                      <Link href="/categories" className={`${row} text-sm text-accent-600 dark:text-accent-400`}>
                        All categories
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            </>
          )}

          <div className="border-t border-border-default mx-4" />

          <div className="flex flex-col p-4 gap-1">
            <Link
              href="/cart"
              className={`${row} justify-between text-foreground-secondary hover:bg-surface-secondary`}
            >
              <span>Cart</span>
              {cartCount > 0 && (
                <span className="bg-accent-500 text-white text-xs font-bold rounded-full px-2 py-0.5">{cartCount}</span>
              )}
            </Link>
            <Link
              href="/wishlist"
              className={`${row} justify-between text-foreground-secondary hover:bg-surface-secondary`}
            >
              <span>Wishlist</span>
              {wishlistCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                  {wishlistCount}
                </span>
              )}
            </Link>
          </div>

          <div className="border-t border-border-default mx-4" />

          <div className="flex flex-col p-4 gap-1">
            {user ? (
              <>
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
                    <p className="text-sm font-semibold text-foreground truncate">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-xs text-foreground-muted truncate">{user.email}</p>
                  </div>
                </div>
                <Link href="/account" className={`${row} text-foreground-secondary hover:bg-surface-secondary`}>
                  My Account
                </Link>
                <Link href="/account/orders" className={`${row} text-foreground-secondary hover:bg-surface-secondary`}>
                  My Orders
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    onClose()
                  }}
                  className={`${row} text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20`}
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className={`${row} justify-center bg-accent-500 text-white hover:bg-accent-600`}>
                  Login
                </Link>
                <Link
                  href="/signup"
                  className={`${row} justify-center text-foreground-secondary hover:bg-surface-secondary`}
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>

          <div className="mt-auto p-4 border-t border-border-default">
            <div className="flex items-center justify-between px-4 min-h-[44px]">
              <span className="text-sm text-foreground-muted">Theme</span>
              <ThemeToggle variant="header" />
            </div>
            <Link
              href="/legal"
              className="flex items-center min-h-[44px] px-4 text-sm text-foreground-muted hover:text-accent-500 transition-colors"
            >
              Policies
            </Link>
            <CookieSettingsLink className="flex items-center min-h-[44px] px-4 w-full text-left text-sm text-foreground-muted hover:text-accent-500 transition-colors" />
          </div>
        </div>
      </div>
    </>
  )
}
