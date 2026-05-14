'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import Footer from './visitor/Footer'
import { CartProvider } from '@/contexts/CartContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import PageTracker from './visitor/PageTracker'

function shouldShowFooter(pathname: string | null): boolean {
  return false
}

export default function ConditionalLayout({ children, isFormsSubdomain }: { children: React.ReactNode; isFormsSubdomain?: boolean }) {
  const pathname = usePathname()
  const isAdminPage = pathname?.startsWith('/admin')
  const isFormsPage = isFormsSubdomain || pathname?.startsWith('/forms')

  if (isAdminPage || isFormsPage) {
    return (
      <ThemeProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </ThemeProvider>
    )
  }

  const showFooter = shouldShowFooter(pathname)

  return (
    <ThemeProvider>
      <AuthProvider>
        <CartProvider>
          <ToastProvider>
            <div className="flex flex-col min-h-screen bg-surface">
              <PageTracker />
              <Header />
              <main className="flex-1 bg-surface pt-16 lg:pt-20">
                {children}
              </main>
              {showFooter && <Footer />}
            </div>
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
