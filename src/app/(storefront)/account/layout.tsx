'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { AccountNavBar } from '@/components/visitor/AccountSidebar'
import { AccountSearchProvider, useAccountSearch } from '@/contexts/AccountSearchContext'
import { bp } from '@/lib/shared/business-path'
import { businessHostForHost } from '@/lib/tenancy/forms-host'

// Account pages the business portal also has, at the same path.
const BUSINESS_ACCOUNT_PATHS = ['/account/orders', '/account/addresses', '/account/transactions']

function PathnameClearer() {
  const pathname = usePathname()
  const { clear } = useAccountSearch()
  useEffect(() => {
    clear()
  }, [pathname])
  return null
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!isLoading && user?.isBusiness) {
      // On prod the business portal lives at business.jeffistores.in (no /business prefix);
      // locally it's served from /business on the same origin. Cross-origin redirects
      // need a full URL via window.location, not router.replace.
      const host = typeof window !== 'undefined' ? window.location.hostname : ''
      const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host) || host.endsWith('.local')
      // Keep the page when the portal has the same one (an order link from an email still opens
      // that order); anything retail-only lands on the portal's account page.
      const portalPath = BUSINESS_ACCOUNT_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
        ? pathname
        : '/account'
      if (isLocal) {
        // bp() auto-detects the host — on business.* it returns '/', otherwise '/business'.
        router.replace(bp(`/business${portalPath}`))
      } else {
        // The current store's own portal: business. on the platform, {slug}.business. on a tenant.
        window.location.href = `https://${businessHostForHost(host)}${portalPath}`
      }
    }
  }, [user, isLoading, router, pathname])

  if (isLoading || user?.isBusiness) return null

  return (
    <AccountSearchProvider>
      <PathnameClearer />
      <div className="flex flex-col min-h-screen bg-surface">
        <AccountNavBar />
        <div className="flex-1">{children}</div>
      </div>
    </AccountSearchProvider>
  )
}
