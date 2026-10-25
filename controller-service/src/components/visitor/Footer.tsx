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
  'flex items-center min-h-[44px] sm:min-h-0 sm:py-1 text-sm text-gray-300 hover:text-accent-400 transition-colors'

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
      <div className="container mx-auto px-4 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col lg:flex-row lg:justify-between gap-6 lg:gap-12">
          <div className="min-w-0 lg:max-w-xs">
            <div className="flex items-center gap-2.5">
              {identity.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={identity.logoUrl} alt="" className="h-8 w-auto max-w-[8rem] object-contain" />
              ) : (
                <div className="w-8 h-8 shrink-0 bg-accent-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">{initials}</span>
                </div>
              )}
              <span className="font-bold text-base truncate">{identity.name}</span>
            </div>
            {storefront.metaTagline && <p className="mt-2 text-sm text-gray-400">{storefront.metaTagline}</p>}
            {(identity.email || identity.phone) && (
              <div className="mt-3 flex flex-col text-sm text-gray-300">
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
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1 sm:mb-2">{g.title}</p>
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

        <div className="border-t border-gray-700 mt-6 pt-4">
          <p className="text-gray-400 text-xs text-center lg:text-left">
            © {new Date().getFullYear()} {identity.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
