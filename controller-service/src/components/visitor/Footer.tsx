'use client'

import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { CookieSettingsLink } from './CookieConsentBanner'

// Build a tel: href from a phone string that may contain multiple comma-separated
// numbers — use the first one, stripped of spaces/punctuation.
function telHref(phone: string): string {
  const first = phone.split(',')[0].trim()
  return `tel:${first.replace(/[^\d+]/g, '')}`
}

const GROUPS = [
  {
    title: 'Shop',
    links: [
      { href: '/', label: 'Home' },
      { href: '/products', label: 'Products' },
      { href: '/categories', label: 'Categories' },
    ],
  },
  {
    title: 'Help',
    links: [
      { href: '/about', label: 'About Us' },
      { href: '/contact', label: 'Contact' },
      { href: '/support', label: 'Support' },
    ],
  },
  {
    title: 'Policies',
    links: [
      { href: '/legal', label: 'Policies' },
      { href: '/legal/privacy-policy', label: 'Privacy' },
    ],
  },
]

const link =
  'flex items-center min-h-[44px] sm:min-h-0 sm:py-0.5 text-sm sm:text-[13px] text-gray-300 hover:text-accent-400 transition-colors'

/** Storefront footer: links, contact, policies and copyright. Pads itself for the home indicator and any fixed bottom bar. */
export default function Footer({ cookieConsent = false }: { cookieConsent?: boolean }) {
  const { identity, storefront } = useStoreConfig()
  const initials =
    identity.name
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'S'

  return (
    <footer data-footer-strip className="bg-secondary-800 text-white">
      <div className="container mx-auto px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col lg:flex-row lg:justify-between gap-5 lg:gap-12">
          <div className="min-w-0 lg:max-w-xs">
            <div className="flex items-center gap-2.5">
              {identity.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={identity.logoUrl} alt="" className="h-7 w-auto max-w-[8rem] object-contain" />
              ) : (
                <div className="w-7 h-7 shrink-0 bg-accent-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">{initials}</span>
                </div>
              )}
              <span className="font-bold text-sm truncate">{identity.name}</span>
            </div>
            {storefront.metaTagline && <p className="mt-1.5 text-xs text-gray-400">{storefront.metaTagline}</p>}
            {(identity.email || identity.phone) && (
              <div className="mt-1 sm:mt-2 flex flex-wrap gap-x-4 text-sm text-gray-300">
                {identity.email && (
                  <a href={`mailto:${identity.email}`} className={`${link} break-all`}>
                    {identity.email}
                  </a>
                )}
                {identity.phone && (
                  <a href={telHref(identity.phone)} className={link}>
                    {identity.phone}
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 sm:gap-12">
            {GROUPS.map(g => (
              <nav key={g.title} aria-label={g.title} className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{g.title}</p>
                <ul>
                  {g.links.map(l => (
                    <li key={l.href}>
                      <Link href={l.href} className={link}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                  {g.title === 'Policies' && cookieConsent && (
                    <li>
                      <CookieSettingsLink className={`${link} text-left`} />
                    </li>
                  )}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-700 mt-5 pt-3">
          <p className="text-gray-400 text-xs text-center lg:text-left">
            © {new Date().getFullYear()} {identity.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
