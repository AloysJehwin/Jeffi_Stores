'use client'

import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { storeHostForHost } from '@/lib/forms-host'

export function storeUrlFrom(web: string): string {
  const trimmed = web.trim()
  if (!trimmed) {
    const host = typeof window !== 'undefined' ? window.location.host : ''
    return `https://${storeHostForHost(host)}`
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

interface Props {
  /** Surface name shown beside the store name (e.g. "Certificate Portal"). */
  title?: string
  /** Where the store name links; defaults to the storefront. */
  homeHref?: string
  /** Right-hand action; defaults to a "Shop with us" link to the storefront. */
  right?: React.ReactNode
  maxWidth?: string
}

// Dedicated top bar shared by the public forms, the certificate portal and the staff notes
// surfaces. Same dark band everywhere so the store's off-admin pages read as one product.
export default function PortalTopNav({ title, homeHref, right, maxWidth = 'max-w-6xl' }: Props) {
  const storeConfig = useStoreConfig()
  const storeName = storeConfig.identity.name || 'Our Store'
  const storeUrl = storeUrlFrom(storeConfig.identity.web)
  return (
    <header style={{ background: '#1a3a4a' }} className="w-full sticky top-0 z-40">
      <div className={`${maxWidth} mx-auto px-4 py-3 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-2 min-w-0">
          <Link href={homeHref || storeUrl} className="text-white font-bold text-base tracking-tight truncate">
            {storeName}
          </Link>
          {title && (
            <>
              <span className="text-white/40">/</span>
              <span className="text-white/85 text-sm font-medium truncate">{title}</span>
            </>
          )}
        </div>
        <div className="shrink-0">
          {right ?? (
            <Link href={storeUrl} className="text-sm text-white/80 hover:text-white transition-colors">
              Shop with us →
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
