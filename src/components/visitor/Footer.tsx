'use client'

import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

// Build a tel: href from a phone string that may contain multiple comma-separated
// numbers — use the first one, stripped of spaces/punctuation.
function telHref(phone: string): string {
  const first = phone.split(',')[0].trim()
  return `tel:${first.replace(/[^\d+]/g, '')}`
}

export default function Footer() {
  const { identity } = useStoreConfig()
  const initials =
    identity.name
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'JS'

  return (
    <footer className="bg-secondary-800 text-white">
      <div className="container mx-auto px-4 py-6 pb-20 md:pb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            {identity.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={identity.logoUrl} alt={identity.name} className="h-8 w-auto object-contain" />
            ) : (
              <div className="w-8 h-8 bg-accent-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">{initials}</span>
              </div>
            )}
            <span className="font-bold text-base">{identity.name}</span>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">
              Home
            </Link>
            <Link href="/products" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">
              Products
            </Link>
            <Link href="/categories" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">
              Categories
            </Link>
            <Link href="/about" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">
              About Us
            </Link>
            <Link href="/contact" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">
              Contact
            </Link>
          </div>

          <div className="flex flex-col gap-1 text-sm text-gray-300">
            <a href={`mailto:${identity.email}`} className="hover:text-accent-400 transition-colors">
              {identity.email}
            </a>
            <a href={telHref(identity.phone)} className="hover:text-accent-400 transition-colors">
              {identity.phone}
            </a>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-5 pt-4">
          <p className="text-gray-400 text-xs text-center md:text-left">
            © {new Date().getFullYear()} {identity.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
