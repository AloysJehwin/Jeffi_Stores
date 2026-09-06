'use client'

import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { storeHostForHost } from '@/lib/forms-host'

function storeUrlFrom(web: string): string {
  const trimmed = web.trim()
  if (!trimmed) {
    const host = typeof window !== 'undefined' ? window.location.host : ''
    return `https://${storeHostForHost(host)}`
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export default function FormsTopNav() {
  const storeConfig = useStoreConfig()
  const storeName = storeConfig.identity.name || 'Our Store'
  const storeUrl = storeUrlFrom(storeConfig.identity.web)
  return (
    <header style={{ background: '#1a3a4a' }} className="w-full">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <Link href={storeUrl} className="text-white font-bold text-base tracking-tight">
          {storeName}
        </Link>
        <Link
          href={storeUrl}
          className="text-sm text-white/80 hover:text-white transition-colors"
        >
          Shop with us →
        </Link>
      </div>
    </header>
  )
}
