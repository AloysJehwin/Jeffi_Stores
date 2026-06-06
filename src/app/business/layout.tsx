'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'

const AUTH_PAGES = ['/business/signin', '/business/signup', '/business/pending']

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const isAuthPage = AUTH_PAGES.some(p => pathname.startsWith(p))

  useEffect(() => {
    if (isLoading) return
    if (isAuthPage) return

    if (!user || !user.isBusiness) {
      router.replace('/business/signin')
      return
    }
    if (user.approvalStatus === 'pending') {
      router.replace('/business/pending')
      return
    }
    if (user.approvalStatus === 'rejected') {
      router.replace('/business/signin?rejected=1')
      return
    }
  }, [user, isLoading, isAuthPage, router])

  if (isAuthPage) return <>{children}</>

  if (isLoading || !user?.isBusiness || user.approvalStatus !== 'approved') return null

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="sticky top-0 z-40 bg-zinc-900 border-b border-zinc-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/business" className="font-bold text-white text-lg tracking-tight">
              Jeffi <span className="text-accent-400">Business</span>
            </Link>
            <nav className="hidden sm:flex items-center gap-1">
              {[
                { href: '/business', label: 'Home' },
                { href: '/business/catalog', label: 'Catalog' },
                { href: '/business/quotes', label: 'My Quotes' },
                { href: '/business/orders', label: 'Orders' },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    pathname === href
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/business/cart"
              className="text-zinc-400 hover:text-white transition-colors text-sm font-medium">
              Cart
            </Link>
            <button onClick={logout}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors font-medium">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  )
}
