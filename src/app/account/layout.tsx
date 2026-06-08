'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AccountNavBar } from '@/components/visitor/AccountSidebar'
import { AccountSearchProvider } from '@/contexts/AccountSearchContext'

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user?.isBusiness) {
      router.replace('/business')
    }
  }, [user, isLoading, router])

  if (isLoading || user?.isBusiness) return null

  return (
    <AccountSearchProvider>
      <div className="flex flex-col min-h-screen bg-surface">
        <AccountNavBar />
        <div className="flex-1">
          {children}
        </div>
      </div>
    </AccountSearchProvider>
  )
}
