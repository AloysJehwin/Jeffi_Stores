'use client'

import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { CookieSettingsLink } from './CookieConsentBanner'
import { DEFAULT_FOOTER_COLUMNS } from '@/lib/site/chrome-types'
import PhotoCredits from './site/PhotoCredits'
import type { StockCredit } from '@/lib/ai/stock-credits'

const link =
  'flex items-center min-h-[24px] sm:min-h-0 sm:py-0.5 text-xs sm:text-[13px] text-gray-300 hover:text-accent-400 transition-colors'

/** Storefront footer: links, contact, policies and copyright. Pads itself for the home indicator and any fixed bottom bar. */
export default function Footer({ cookieConsent = false, photoCredits }: { cookieConsent?: boolean; photoCredits?: StockCredit[] }) {
  const { identity, storefront, chrome } = useStoreConfig()
  // Site Builder's footer columns when set; the cookie settings link rides in the last column.
  const groups = chrome?.footer?.columns.length ? chrome.footer.columns : DEFAULT_FOOTER_COLUMNS
  const initials =
    identity.name
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'S'

  return (
    <footer data-footer-strip className="bg-secondary-800 text-white">
      <div className="container mx-auto px-4 pt-3 sm:pt-6 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col lg:flex-row lg:justify-between gap-2 sm:gap-5 lg:gap-12">
          <div className="min-w-0 lg:max-w-xs">
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              {identity.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={identity.logoUrl} alt="" className="h-5 sm:h-7 w-auto max-w-[8rem] object-contain" />
              ) : (
                <div className="w-5 h-5 sm:w-7 sm:h-7 shrink-0 bg-accent-500 rounded-md sm:rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-[10px] sm:text-sm">{initials}</span>
                </div>
              )}
              <span className="font-bold text-[13px] sm:text-sm truncate">{identity.name}</span>
              {storefront.metaTagline && <span className="sm:hidden truncate text-[11px] text-gray-400">· {storefront.metaTagline}</span>}
            </div>
            {storefront.metaTagline && <p className="hidden sm:block mt-1.5 text-xs text-gray-400">{storefront.metaTagline}</p>}
            {identity.email && (
              <div className="sm:mt-2 text-xs sm:text-sm text-gray-300">
                <a href={`mailto:${identity.email}`} className={`${link} break-all`}>
                  {identity.email}
                </a>
              </div>
            )}
          </div>

          <div className={`grid gap-3 sm:gap-12 ${groups.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : groups.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {groups.map((g, gi) => (
              <nav key={`${g.title}:${gi}`} aria-label={g.title || 'Links'} className="min-w-0">
                <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-gray-400 sm:mb-1">{g.title}</p>
                <ul>
                  {g.links.map((l, li) => (
                    <li key={`${l.href}:${li}`}>
                      <Link href={l.href} className={link}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                  {gi === groups.length - 1 && cookieConsent && (
                    <li>
                      <CookieSettingsLink className={`${link} text-left`} />
                    </li>
                  )}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-700 mt-2 pt-2 sm:mt-5 sm:pt-3">
          <p className="text-gray-400 text-[10px] sm:text-xs text-center lg:text-left">
            {chrome?.footer?.note ?? `© ${new Date().getFullYear()} ${identity.name}. All rights reserved.`}
          </p>
          <PhotoCredits credits={photoCredits} className="mt-1 text-gray-400 text-[10px] sm:text-xs text-center lg:text-left" linkClassName="underline underline-offset-2 hover:text-accent-400" />
        </div>
      </div>
    </footer>
  )
}
