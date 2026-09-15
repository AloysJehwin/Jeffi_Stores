'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import Footer from './visitor/Footer'
import { CartProvider } from '@/contexts/CartContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { CompareProvider } from '@/contexts/CompareContext'
import { StoreConfigProvider, type StoreConfig } from '@/contexts/StoreConfigContext'
import CompareBar from '@/components/visitor/CompareBar'
import PageTracker from './visitor/PageTracker'
import PolicyConsentGate from './PolicyConsentGate'
import NumberInputWheelGuard from './NumberInputWheelGuard'

function shouldShowFooter(pathname: string | null): boolean {
  return false
}

export default function ConditionalLayout({ children, initialStoreConfig, isFormsSubdomain, isDocumentSubdomain, isBusinessSubdomain, isAdminSubdomain, isEcomSubdomain }: { children: React.ReactNode; initialStoreConfig?: StoreConfig; isFormsSubdomain?: boolean; isDocumentSubdomain?: boolean; isBusinessSubdomain?: boolean; isAdminSubdomain?: boolean; isEcomSubdomain?: boolean }) {
  const pathname = usePathname()
  const isAdminPage = isAdminSubdomain || pathname?.startsWith('/admin')
  const isBusinessPage = !isAdminPage && (isBusinessSubdomain || pathname?.startsWith('/business'))
  const isFormsPage = isFormsSubdomain || pathname?.startsWith('/forms')
  const isDocumentPage = isDocumentSubdomain || pathname?.startsWith('/invoice/') || pathname?.startsWith('/quotation/') || pathname?.startsWith('/purchaseorder/')
  const isEcomPage = isEcomSubdomain || pathname?.startsWith('/ecom')

  if (isAdminPage || isFormsPage || isDocumentPage || isBusinessPage || isEcomPage) {
    return (
      <StoreConfigProvider initialConfig={initialStoreConfig}>
        <ThemeProvider>
          <AuthProvider meEndpoint={isBusinessPage ? '/api/business/me' : '/api/auth/me'}>
            <ToastProvider>
              <ConfirmProvider>
                <NumberInputWheelGuard />
                {children}
                {isBusinessPage && <PolicyConsentGate />}
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </StoreConfigProvider>
    )
  }

  const showFooter = shouldShowFooter(pathname)

  return (
    <StoreConfigProvider initialConfig={initialStoreConfig}>
      <ThemeProvider>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              <ConfirmProvider>
                <CompareProvider>
                  <NumberInputWheelGuard />
                  <div className="flex flex-col min-h-[100dvh] bg-surface">
                    <PageTracker />
                    <Header />
                    <main className="flex-1 bg-surface pt-16 lg:pt-20">
                      {children}
                    </main>
                    {showFooter && <Footer />}
                  </div>
                  <CompareBar />
                  <PolicyConsentGate />
                </CompareProvider>
              </ConfirmProvider>
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </StoreConfigProvider>
  )
}
