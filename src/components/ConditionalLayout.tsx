'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import Footer from './visitor/Footer'
import { CartProvider } from '@/contexts/CartContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import PageTracker from './visitor/PageTracker'

function shouldShowFooter(pathname: string | null): boolean {
  return false
}

export default function ConditionalLayout({ children, isFormsSubdomain, isDocumentSubdomain, isBusinessSubdomain, isAdminSubdomain }: { children: React.ReactNode; isFormsSubdomain?: boolean; isDocumentSubdomain?: boolean; isBusinessSubdomain?: boolean; isAdminSubdomain?: boolean }) {
  const pathname = usePathname()
  const isAdminPage = isAdminSubdomain || pathname?.startsWith('/admin')
  const isBusinessPage = !isAdminPage && (isBusinessSubdomain || pathname?.startsWith('/business'))
  const isFormsPage = isFormsSubdomain || pathname?.startsWith('/forms')
  const isDocumentPage = isDocumentSubdomain || pathname?.startsWith('/invoice/') || pathname?.startsWith('/quotation/') || pathname?.startsWith('/purchaseorder/')

  if (isAdminPage || isFormsPage || isDocumentPage || isBusinessPage) {
    return (
      <ThemeProvider>
        <AuthProvider meEndpoint={isBusinessPage ? '/api/business/me' : '/api/auth/me'}>
          <ToastProvider>
            <ConfirmProvider>
              {children}
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    )
  }

  const showFooter = shouldShowFooter(pathname)

  return (
    <ThemeProvider>
      <AuthProvider>
        <CartProvider>
          <ToastProvider>
            <ConfirmProvider>
              <div className="flex flex-col min-h-screen bg-surface">
                <PageTracker />
                <Header />
                <main className="flex-1 bg-surface pt-16 lg:pt-20">
                  {children}
                </main>
                {showFooter && <Footer />}
              </div>
            </ConfirmProvider>
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
