'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'

// Custom top nav for the ecom control-plane surface (ecom.jeffistores.in).
// Distinct from the storefront + admin nav. Shows Sign in/Get started when
// logged out; Dashboard + Sign out when an owner is signed in.
// Self-hides on full-page auth routes (client-reactive so it updates instantly
// on in-app navigation, not just on hard reload).
const HIDE_ON = ['/signin', '/signup', '/ecom/signin', '/ecom/signup']

const menuRow = 'flex min-h-12 w-full items-center rounded-2xl px-4 text-left text-base font-semibold text-foreground ecom-hover'

export default function EcomNav({ owner }: { owner: { email: string; name: string | null } | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => { setMenuOpen(false) }, [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  if (HIDE_ON.includes(pathname) || pathname.startsWith('/dashboard')) return null

  const close = () => setMenuOpen(false)

  async function signOut() {
    setMenuOpen(false)
    await fetch('/api/ecom/auth/signout', { method: 'POST' }).catch(() => {})
    router.push('/')
    router.refresh()
  }

  return (
    <header className="fixed top-0 inset-x-0 z-40 bg-surface/85 backdrop-blur">
      <div className="w-full px-4 sm:px-6 lg:px-10 h-14 flex items-center justify-between gap-2 sm:gap-0">
        <Link href="/" className="flex min-w-0 items-center gap-2 font-bold text-foreground">
          <span className="ecom-accent-bg inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full text-white text-sm font-display font-black">
            J
          </span>
          <span className="font-display font-black text-xl tracking-tight max-sm:truncate max-sm:text-lg">Jeffi Commerce</span>
        </Link>

        <nav className="flex shrink-0 items-center gap-2 sm:gap-4 text-sm">
          <Link href="/#apis" className="hidden sm:inline text-foreground-secondary hover:text-foreground px-2">
            APIs
          </Link>
          <Link href="/pricing" className="hidden sm:inline text-foreground-secondary hover:text-foreground px-2">
            Pricing
          </Link>
          {owner ? (
            <>
              <Link href="/dashboard" className="text-foreground-secondary hover:text-foreground px-2 max-sm:inline-flex max-sm:h-11 max-sm:items-center">
                Dashboard
              </Link>
              <span className="hidden sm:inline text-foreground-muted text-xs">{owner.name || owner.email}</span>
              <button
                onClick={signOut}
                className="hidden sm:inline-block org-sand org-sand-hover px-4 py-1.5 rounded-full text-foreground transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" className="hidden sm:inline text-foreground-secondary hover:text-foreground px-2">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="ecom-accent-bg px-5 py-2 rounded-full text-white font-display font-bold transition-colors max-sm:inline-flex max-sm:h-11 max-sm:items-center max-sm:px-4 max-sm:py-0"
              >
                Get started
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            aria-expanded={menuOpen}
            aria-controls="ecom-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="sm:hidden -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground ecom-hover"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>
      </div>

      {menuOpen && (
        <nav id="ecom-mobile-menu" aria-label="Menu" className="sm:hidden border-t border-border-default bg-surface px-3 pt-2 pb-4 shadow-lg shadow-black/[0.06]">
          <Link href="/#apis" onClick={close} className={menuRow}>APIs</Link>
          <Link href="/pricing" onClick={close} className={menuRow}>Pricing</Link>
          {owner ? (
            <>
              <div className="mx-4 mt-2 border-t border-border-default pt-3 pb-1 text-xs text-foreground-muted truncate">{owner.name || owner.email}</div>
              <button type="button" onClick={signOut} className={menuRow}>Sign out</button>
            </>
          ) : (
            <Link href="/signin" onClick={close} className={menuRow}>Sign in</Link>
          )}
        </nav>
      )}
    </header>
  )
}
