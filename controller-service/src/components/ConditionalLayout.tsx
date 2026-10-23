'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import { CartProvider } from '@/contexts/CartContext'
import { WishlistProvider } from '@/contexts/WishlistContext'
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
import CookieConsentBanner, { StorefrontFooterBar } from './visitor/CookieConsentBanner'

export default function ConditionalLayout({
  children,
  initialStoreConfig,
  isFormsSubdomain,
  isDocumentSubdomain,
  isBusinessSubdomain,
  isAdminSubdomain,
  isEcomSubdomain,
  isCertPortalSubdomain,
  isVaultSubdomain,
  cookieConsent,
}: {
  children: React.ReactNode
  initialStoreConfig?: StoreConfig
  isFormsSubdomain?: boolean
  isDocumentSubdomain?: boolean
  isBusinessSubdomain?: boolean
  isAdminSubdomain?: boolean
  isEcomSubdomain?: boolean
  isCertPortalSubdomain?: boolean
  isVaultSubdomain?: boolean
  cookieConsent?: boolean
}) {
  const pathname = usePathname()
  // The vault brings its own chrome; host paths there are /library, not /vault/*.
  if (isVaultSubdomain) return <>{children}</>
  const isAdminPage = isAdminSubdomain || pathname?.startsWith('/admin')
  const isBusinessPage = !isAdminPage && (isBusinessSubdomain || pathname?.startsWith('/business'))
  const isFormsPage = isFormsSubdomain || pathname?.startsWith('/forms')
  const isDocumentPage =
    isDocumentSubdomain ||
    pathname?.startsWith('/invoice/') ||
    pathname?.startsWith('/quotation/') ||
    pathname?.startsWith('/purchaseorder/')
  const isEcomPage = isEcomSubdomain || pathname?.startsWith('/ecom')
  const isCertPortalPage = isCertPortalSubdomain || pathname?.startsWith('/certportal')
  const isStaffPage = pathname?.startsWith('/staff')
  // Sign-in and sign-up pages carry their own brand panel (components/auth/AuthSplitShell), never the top nav.
  const isAuthPage = pathname === '/login' || pathname === '/signup' || !!pathname?.startsWith('/auth/')

  if (isAdminPage || isFormsPage || isDocumentPage || isBusinessPage || isEcomPage || isCertPortalPage || isStaffPage) {
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

  return (
    <StoreConfigProvider initialConfig={initialStoreConfig}>
      <ThemeProvider>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <CompareProvider>
                    <NumberInputWheelGuard />
                    <div className="flex flex-col min-h-[100dvh] bg-surface">
                      <PageTracker />
                      {!isAuthPage && <Header />}
                      <main className={`flex-1 bg-surface ${isAuthPage ? '' : 'pt-16 lg:pt-20'}`}>{children}</main>
                      {cookieConsent && <StorefrontFooterBar />}
                    </div>
                    <CompareBar />
                    <PolicyConsentGate />
                    {cookieConsent && <CookieConsentBanner />}
                  </CompareProvider>
                </ConfirmProvider>
              </ToastProvider>
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </StoreConfigProvider>
  )
}
