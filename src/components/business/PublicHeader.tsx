'use client'

import Link from 'next/link'
import { useState } from 'react'
import { bp } from '@/lib/business-path'
import ThemeToggle from '@/components/ThemeToggle'

export default function BusinessPublicHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="bg-surface-elevated shadow-sm dark:shadow-none dark:border-b dark:border-border-default fixed top-0 left-0 right-0 z-40 w-full">
      <div className="container mx-auto px-3 sm:px-4">
        <div className="flex items-center justify-between h-16 sm:h-16 lg:h-20 gap-3">
          <Link href={bp('/business')} className="flex items-center shrink-0">
            <div className="flex items-center gap-2 sm:gap-3">
              <img src="/images/logo.png" alt="Jeffi Stores Logo" className="h-8 sm:h-10 lg:h-12 w-auto" />
              <div>
                <div className="text-base sm:text-lg lg:text-xl font-bold text-secondary-500 dark:text-primary-400">Jeffi Stores</div>
                <div className="hidden sm:block text-xs text-accent-500 font-semibold">Business</div>
              </div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-8">
            <a href="#advantages" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">Why Business</a>
            <a href="#how-it-works" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">How it Works</a>
            <a href="#faq" className="text-foreground-secondary hover:text-accent-500 font-medium transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            <Link
              href={bp('/business/signin')}
              className="hidden sm:inline-flex items-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm font-medium text-foreground-secondary hover:text-foreground transition-colors"
            >
              Sign In
            </Link>
            <Link
              href={bp('/business/signup')}
              className="inline-flex items-center px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors"
            >
              Register
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen(o => !o)}
              className="lg:hidden p-2 rounded-lg text-foreground-secondary hover:bg-surface-secondary"
              aria-label="Menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
              </svg>
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-border-default py-3 space-y-1">
            <a onClick={() => setMobileOpen(false)} href="#advantages" className="block px-2 py-2 text-sm text-foreground-secondary hover:bg-surface-secondary rounded-lg">Why Business</a>
            <a onClick={() => setMobileOpen(false)} href="#how-it-works" className="block px-2 py-2 text-sm text-foreground-secondary hover:bg-surface-secondary rounded-lg">How it Works</a>
            <a onClick={() => setMobileOpen(false)} href="#faq" className="block px-2 py-2 text-sm text-foreground-secondary hover:bg-surface-secondary rounded-lg">FAQ</a>
            <Link href={bp('/business/signin')} className="block px-2 py-2 text-sm font-medium text-foreground hover:bg-surface-secondary rounded-lg">Sign In</Link>
          </div>
        )}
      </div>
    </header>
  )
}
