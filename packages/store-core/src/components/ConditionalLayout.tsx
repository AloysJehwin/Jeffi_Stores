'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import { CartProvider } from '@/contexts/CartContext'
import { FlyToCartProvider } from '@/contexts/FlyToCartContext'
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
import CookieConsentBanner, { CookieSettingsLink } from './visitor/CookieConsentBanner'
import AnnouncementBar from '@/components/visitor/AnnouncementBar'
import Footer from './visitor/Footer'
import PhotoCredits from './visitor/site/PhotoCredits'
import type { StockCredit } from '@/lib/ai/stock-credits'

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
  codeChrome,
  photoCredits,
}: {
  children: React.ReactNode
  /** The store's AI-written header, footer and announcement bar (AI Site Studio), in place of the built-in ones. */
  codeChrome?: { header: React.ReactNode | null; footer: React.ReactNode | null; announcement: React.ReactNode | null } | null
  /** Credits for the stock photos the store shows (lib/site/photo-credits.ts). */
  photoCredits?: StockCredit[]
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
            <FlyToCartProvider>
              <WishlistProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <CompareProvider>
                    <NumberInputWheelGuard />
                    <div data-storefront data-app-root className="flex flex-col min-h-[100dvh] bg-surface">
                      <PageTracker />
                      {codeChrome?.header ?? <Header />}
                      <main className={`flex-1 bg-surface ${codeChrome?.header ? '' : 'pt-[calc(4rem+env(safe-area-inset-top,0px))] lg:pt-[calc(5rem+env(safe-area-inset-top,0px))]'}`}>
                        {codeChrome?.announcement ?? <AnnouncementBar />}
                        {children}
                      </main>
                      {codeChrome?.footer ? (
                        <>
                          {codeChrome.footer}
                          <PhotoCredits credits={photoCredits} className="bg-surface px-4 py-3 text-center text-xs text-foreground-muted" />
                          {cookieConsent && (
                            <div className="bg-surface px-4 py-3 text-center text-xs text-foreground-muted">
                              <CookieSettingsLink className="underline" />
                            </div>
                          )}
                        </>
                      ) : (
                        <Footer cookieConsent={cookieConsent} photoCredits={photoCredits} />
                      )}
                    </div>
                    <CompareBar />
                    <PolicyConsentGate />
                    {cookieConsent && <CookieConsentBanner />}
                  </CompareProvider>
                </ConfirmProvider>
              </ToastProvider>
            </WishlistProvider>
            </FlyToCartProvider>
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </StoreConfigProvider>
  )
}
