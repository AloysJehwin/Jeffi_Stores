'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { bp } from '@/lib/business-path'
import ThemeToggle from '@/components/ThemeToggle'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

type AuthState = 'guest' | 'pending' | 'approved' | 'rejected'

export default function BusinessPublicHeader({ authState = 'guest' }: { authState?: AuthState }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { identity } = useStoreConfig()

  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  const renderDesktopCtas = () => {
    if (authState === 'approved') {
      return (
        <Link
          href={bp('/business/products')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors"
        >
          Continue to Portal
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </Link>
      )
    }
    if (authState === 'pending') {
      return (
        <Link
          href={bp('/business/pending')}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
        >
          Approval Pending
        </Link>
      )
    }
    return (
      <>
        <Link
          href={bp('/business/signin')}
          className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium text-foreground-secondary hover:text-foreground transition-colors"
        >
          Sign In
        </Link>
        <Link
          href={bp('/business/signup')}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors"
        >
          Register
        </Link>
      </>
    )
  }

  const renderMobileCtas = () => {
    const close = () => setMobileOpen(false)
    if (authState === 'approved') {
      return (
        <Link
          onClick={close}
          href={bp('/business/products')}
          className="flex items-center justify-center gap-1.5 w-full px-4 py-3 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-base font-semibold transition-colors"
        >
          Continue to Portal
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </Link>
      )
    }
    if (authState === 'pending') {
      return (
        <Link
          onClick={close}
          href={bp('/business/pending')}
          className="flex items-center justify-center w-full px-4 py-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-base font-semibold transition-colors"
        >
          Approval Pending
        </Link>
      )
    }
    return (
      <div className="grid grid-cols-2 gap-3">
        <Link
          onClick={close}
          href={bp('/business/signin')}
          className="flex items-center justify-center px-4 py-3 rounded-lg border border-border-default text-foreground text-sm font-semibold hover:bg-surface-secondary transition-colors"
        >
          Sign In
        </Link>
        <Link
          onClick={close}
          href={bp('/business/signup')}
          className="flex items-center justify-center px-4 py-3 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors"
        >
          Register
        </Link>
      </div>
    )
  }

  return (
    <header className="bg-surface-elevated shadow-sm dark:shadow-none dark:border-b dark:border-border-default fixed top-0 left-0 right-0 z-40 w-full">
      <div className="container mx-auto px-3 sm:px-4">
        <div className="flex items-center justify-between h-16 sm:h-16 lg:h-20 gap-2">
          <Link
            href={bp('/business')}
            className="flex items-center shrink-0 min-w-0"
            onClick={() => setMobileOpen(false)}
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {identity.logoUrl && (
                <img
                  src={identity.logoUrl}
                  alt={`${identity.name} Logo`}
                  className="h-8 sm:h-10 lg:h-12 w-auto shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="text-base sm:text-lg lg:text-xl font-bold text-secondary-500 dark:text-primary-400 truncate leading-tight">
                  {identity.name}
                </div>
                <div className="text-[10px] sm:text-xs text-accent-500 font-semibold leading-tight">Business</div>
              </div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-8">
            <a
              href="#advantages"
              className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors"
            >
              Why Business
            </a>
            <a
              href="#how-it-works"
              className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors"
            >
              How it Works
            </a>
            <a href="#faq" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">
              FAQ
            </a>
          </nav>

          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <ThemeToggle />
            {renderDesktopCtas()}
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen(o => !o)}
            className="lg:hidden -mr-1 p-2 rounded-lg text-foreground-secondary hover:bg-surface-secondary active:scale-95 transition-all"
            aria-label="Menu"
            aria-expanded={mobileOpen}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
              />
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-50 bg-black/50 transition-opacity duration-300"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="lg:hidden fixed top-0 left-0 bottom-0 z-50 w-4/5 max-w-xs bg-surface-elevated shadow-xl flex flex-col overflow-y-auto transition-transform duration-300 ease-in-out translate-x-0">
            <div className="flex items-center justify-between p-4 border-b border-border-default">
              <Link href={bp('/business')} className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                {identity.logoUrl && (
                  <img src={identity.logoUrl} alt={`${identity.name} Logo`} className="h-10 w-auto" />
                )}
                <div>
                  <div className="font-bold text-secondary-500 dark:text-primary-400 leading-tight">
                    {identity.name}
                  </div>
                  <div className="text-xs text-accent-500 font-semibold leading-tight">Business</div>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-2 text-foreground-muted hover:text-foreground rounded-lg"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-col p-4 gap-1">
              <a
                onClick={() => setMobileOpen(false)}
                href="#advantages"
                className="px-4 py-3 rounded-lg text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors"
              >
                Why Business
              </a>
              <a
                onClick={() => setMobileOpen(false)}
                href="#how-it-works"
                className="px-4 py-3 rounded-lg text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors"
              >
                How it Works
              </a>
              <a
                onClick={() => setMobileOpen(false)}
                href="#faq"
                className="px-4 py-3 rounded-lg text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors"
              >
                FAQ
              </a>
            </nav>

            <div className="border-t border-border-default mx-4" />

            <div className="p-4">{renderMobileCtas()}</div>

            <div className="mt-auto p-4 border-t border-border-default">
              <div className="flex items-center justify-between px-4">
                <span className="text-sm text-foreground-muted">Theme</span>
                <ThemeToggle />
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  )
}
