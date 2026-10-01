'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { AccountNavBar } from '@/components/visitor/AccountSidebar'
import { AccountSearchProvider, useAccountSearch } from '@/contexts/AccountSearchContext'
import { bp } from '@/lib/shared/business-path'

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

  useEffect(() => {
    if (!isLoading && user?.isBusiness) {
      // On prod the business portal lives at business.jeffistores.in (no /business prefix);
      // locally it's served from /business on the same origin. Cross-origin redirects
      // need a full URL via window.location, not router.replace.
      const host = typeof window !== 'undefined' ? window.location.hostname : ''
      const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host) || host.endsWith('.local')
      if (isLocal) {
        // bp() auto-detects the host — on business.* it returns '/', otherwise '/business'.
        router.replace(bp('/business'))
      } else {
        window.location.href = 'https://business.jeffistores.in/'
      }
    }
  }, [user, isLoading, router])

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
