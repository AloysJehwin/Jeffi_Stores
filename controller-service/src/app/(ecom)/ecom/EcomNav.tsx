'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

// Custom top nav for the ecom control-plane surface (ecom.jeffistores.in).
// Distinct from the storefront + admin nav. Shows Sign in/Get started when
// logged out; Dashboard + Sign out when an owner is signed in.
// Self-hides on full-page auth routes (client-reactive so it updates instantly
// on in-app navigation, not just on hard reload).
const HIDE_ON = ['/signin', '/signup', '/ecom/signin', '/ecom/signup']

export default function EcomNav({ owner }: { owner: { email: string; name: string | null } | null }) {
  const router = useRouter()
  const pathname = usePathname()
  if (HIDE_ON.includes(pathname) || pathname.startsWith('/dashboard')) return null

  async function signOut() {
    await fetch('/api/ecom/auth/signout', { method: 'POST' }).catch(() => {})
    router.push('/')
    router.refresh()
  }

  return (
    <header className="fixed top-0 inset-x-0 z-40 bg-surface/85 backdrop-blur">
      <div className="w-full px-6 lg:px-10 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-foreground">
          <span className="ecom-accent-bg inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-display font-black">
            J
          </span>
          <span className="font-display font-black text-xl tracking-tight">Jeffi Commerce</span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-4 text-sm">
          <Link href="/#apis" className="hidden sm:inline text-foreground-secondary hover:text-foreground px-2">
            APIs
          </Link>
          <Link href="/pricing" className="hidden sm:inline text-foreground-secondary hover:text-foreground px-2">
            Pricing
          </Link>
          {owner ? (
            <>
              <Link href="/dashboard" className="text-foreground-secondary hover:text-foreground px-2">
                Dashboard
              </Link>
              <span className="hidden sm:inline text-foreground-muted text-xs">{owner.name || owner.email}</span>
              <button
                onClick={signOut}
                className="org-sand org-sand-hover px-4 py-1.5 rounded-full text-foreground transition-colors"
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
                className="ecom-accent-bg px-5 py-2 rounded-full text-white font-display font-bold transition-colors"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
