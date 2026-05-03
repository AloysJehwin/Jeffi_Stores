'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import Footer from './visitor/Footer'
import { CartProvider } from '@/contexts/CartContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

const FOOTER_ROUTES = ['/', '/products', '/categories', '/about', '/contact', '/return-policy']

function shouldShowFooter(pathname: string | null): boolean {
  if (!pathname) return false
  return FOOTER_ROUTES.some(route =>
    route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(route + '/')
  )
}

export default function ConditionalLayout({ children, isFormsSubdomain }: { children: React.ReactNode; isFormsSubdomain?: boolean }) {
  const pathname = usePathname()
  const isAdminPage = pathname?.startsWith('/admin')
  const isFormsPage = isFormsSubdomain || pathname?.startsWith('/forms')

  if (isAdminPage || isFormsPage) {
    return (
      <ThemeProvider storageKey={isAdminPage ? 'jeffi-admin-theme' : undefined}>
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
              <Header />
              <main className="flex-1 bg-surface">
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
