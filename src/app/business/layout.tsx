'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import BusinessHeader from '@/components/business/Header'
import { CartProvider } from '@/contexts/CartContext'

const AUTH_PAGES = ['/business/signin', '/business/signup', '/business/pending']
const AUTH_PAGES_SUBDOMAIN = ['/signin', '/signup', '/pending']

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const isSubdomain = typeof window !== 'undefined' && window.location.hostname.startsWith('business.')
  const authPages = isSubdomain ? AUTH_PAGES_SUBDOMAIN : AUTH_PAGES
  const signinPath = isSubdomain ? '/signin' : '/business/signin'
  const pendingPath = isSubdomain ? '/pending' : '/business/pending'

  const isAuthPage = authPages.some(p => pathname.startsWith(p)) || AUTH_PAGES.some(p => pathname.startsWith(p))

  useEffect(() => {
    if (isLoading || isAuthPage) return
    if (!user || !user.isBusiness) { router.replace(signinPath); return }
    if (user.approvalStatus === 'pending') { router.replace(pendingPath); return }
    if (user.approvalStatus === 'rejected') { router.replace(`${signinPath}?rejected=1`); return }
  }, [user, isLoading, isAuthPage, router, signinPath, pendingPath])

  if (isAuthPage) return <>{children}</>

  if (isLoading || !user?.isBusiness || user.approvalStatus !== 'approved') return null

  return (
    <CartProvider>
      <div className="flex flex-col min-h-screen bg-surface">
        <BusinessHeader />
        <main className="flex-1 pt-16 lg:pt-20">
          {children}
        </main>
      </div>
    </CartProvider>
  )
}
