'use client'

import { usePathname } from 'next/navigation'

// Wraps the ecom page content. The nav is `fixed`, so content needs top offset —
// but only where the nav actually renders. Mirrors EcomNav's hide logic so auth
// pages (no nav) don't get a blank strip at the top.
const NO_NAV = ['/signin', '/signup', '/ecom/signin', '/ecom/signup']

export default function EcomMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideNav = NO_NAV.includes(pathname)
  return <main className={`flex-1 ${hideNav ? '' : 'pt-14'}`}>{children}</main>
}
