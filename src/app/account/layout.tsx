'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user?.isBusiness) {
      router.replace('/business')
    }
  }, [user, isLoading, router])

  if (isLoading || user?.isBusiness) return null

  return <>{children}</>
}
