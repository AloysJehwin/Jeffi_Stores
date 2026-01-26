'use client'

import { usePathname } from 'next/navigation'
import Header from './visitor/Header'
import Footer from './visitor/Footer'
import { CartProvider } from '@/contexts/CartContext'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAdminPage = pathname?.startsWith('/admin')

  if (isAdminPage) {
    return <>{children}</>
  }

  return (
    <CartProvider>
      <div className="flex flex-col min-h-screen bg-gray-50">
        <Header />
        <main className="flex-1 bg-gray-50">
          {children}
        </main>
        <Footer />
      </div>
    </CartProvider>
  )
}
