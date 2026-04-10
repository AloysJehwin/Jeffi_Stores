'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import Footer from './visitor/Footer'
import { CartProvider } from '@/contexts/CartContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAdminPage = pathname?.startsWith('/admin')

  if (isAdminPage) {
    return (
      <ThemeProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </ThemeProvider>
    )
  }

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
              <Footer />
            </div>
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
