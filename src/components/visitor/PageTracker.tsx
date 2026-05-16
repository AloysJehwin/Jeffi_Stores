'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

function classifyPage(path: string): string {
  if (path === '/') return 'home'
  if (path === '/categories') return 'categories'
  if (path.startsWith('/categories/')) return 'category'
  if (path.startsWith('/products/')) return 'product'
  if (path === '/cart' || path.startsWith('/cart')) return 'cart'
  if (path.startsWith('/checkout')) return 'checkout'
  if (path.startsWith('/account/orders/') && !path.endsWith('/orders')) return 'order_placed'
  if (path === '/search' || path.startsWith('/search')) return 'search'
  return 'other'
}

function getOrCreateSessionId(): string {
  try {
    const key = 'jeffi_sid'
    let sid = sessionStorage.getItem(key)
    if (!sid) {
      sid = crypto.randomUUID()
      sessionStorage.setItem(key, sid)
    }
    return sid
  } catch {
    return crypto.randomUUID()
  }
}

export default function PageTracker() {
  const pathname = usePathname()
  const lastTracked = useRef<string>('')

  useEffect(() => {
    if (pathname === lastTracked.current) return
    lastTracked.current = pathname

    const page = classifyPage(pathname)
    if (page === 'other') return

    const sessionId = getOrCreateSessionId()
    const referrer = typeof document !== 'undefined' ? document.referrer : ''

    navigator.sendBeacon('/api/track', JSON.stringify({
      sessionId,
      page,
      path: pathname,
      referrer,
    }))
  }, [pathname])

  return null
}
