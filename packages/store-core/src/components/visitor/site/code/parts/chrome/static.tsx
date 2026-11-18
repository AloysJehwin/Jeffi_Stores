import type { ReactNode } from 'react'
import Link from 'next/link'
import type { ChromeLink } from '@/lib/site/chrome-types'
import { MenuButtonPart } from './client'

// Server-rendered header and footer parts: links, footer columns and social icons.

export type NavMobile = 'menu' | 'scroll' | 'hide' | 'show'
const NAV_LIST = 'flex items-center gap-5 xl:gap-8'
const NAV_LINK = 'font-medium whitespace-nowrap opacity-80 hover:opacity-100 hover:text-accent-500 transition-colors'

/** Menu links; on phones a menu button (the store's drawer), a scrolling row, hidden, or as-is. */
export function NavList({ links, items, mobile = 'menu', className }: { links: ChromeLink[]; items?: ReactNode[]; mobile?: NavMobile; className?: string }) {
  const list = (
    <ul className={className || NAV_LIST}>
      {links.map((l, i) => (
        <li key={`${l.href}:${i}`}>
          {items ? (
            items[i]
          ) : (
            <Link href={l.href} className={NAV_LINK}>
              {l.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
  if (mobile === 'show') return <nav aria-label="Main">{list}</nav>
  if (mobile === 'scroll')
    return (
      <nav aria-label="Main" className="max-w-full overflow-x-auto [scrollbar-width:none]">
        {list}
      </nav>
    )
  return (
    <nav aria-label="Main" className="flex items-center">
      <div className="hidden lg:block">{list}</div>
      {mobile === 'menu' && <MenuButtonPart />}
    </nav>
  )
}

export interface FooterColumn {
  title: string
  links: ChromeLink[]
}

export function FooterColumns({ columns, items, className }: { columns: FooterColumn[]; items?: ReactNode[]; className?: string }) {
  if (!columns.length) return null
  return (
    <div className={className || `grid gap-8 ${columns.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : columns.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {columns.map((c, ci) =>
        items ? (
          <div key={`${c.title}:${ci}`}>{items[ci]}</div>
        ) : (
          <nav key={`${c.title}:${ci}`} aria-label={c.title || 'Links'} className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-2">{c.title}</p>
            <ul className="space-y-1.5">
              {c.links.map((l, li) => (
                <li key={`${l.href}:${li}`}>
                  <Link href={l.href} className="text-sm opacity-90 hover:opacity-100 hover:underline underline-offset-2">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )
      )}
    </div>
  )
}

export const SOCIAL_NETWORKS = ['instagram', 'facebook', 'youtube', 'x', 'linkedin', 'pinterest', 'whatsapp'] as const
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]
export const SOCIAL_LABEL: Record<SocialNetwork, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X', linkedin: 'LinkedIn', pinterest: 'Pinterest', whatsapp: 'WhatsApp' }

function SocialGlyph({ network }: { network: SocialNetwork }) {
  const p = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.8 }
  return (
    <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      {network === 'instagram' && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" {...p} />
          <circle cx="12" cy="12" r="4" {...p} />
          <circle cx="17.5" cy="6.5" r="0.8" {...p} />
        </>
      )}
      {network === 'facebook' && <path {...p} d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />}
      {network === 'youtube' && (
        <>
          <rect x="2" y="5" width="20" height="14" rx="4" {...p} />
          <path {...p} d="M10 9l5 3-5 3z" />
        </>
      )}
      {network === 'x' && <path {...p} d="M4 4l16 16M20 4L4 20" />}
      {network === 'linkedin' && (
        <>
          <path {...p} d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z" />
          <circle cx="4" cy="4" r="2" {...p} />
        </>
      )}
      {network === 'pinterest' && (
        <>
          <circle cx="12" cy="12" r="9" {...p} />
          <path {...p} d="M11 8.5c2.6-.6 4.6.8 4.6 3 0 2.3-1.5 3.9-3.3 3.9-1 0-1.6-.6-1.6-.6L9.5 20" />
        </>
      )}
      {network === 'whatsapp' && (
        <path {...p} d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8z" />
      )}
    </svg>
  )
}

const SOCIAL_ICON = 'inline-flex w-9 h-9 items-center justify-center rounded-full border border-current opacity-80 hover:opacity-100 hover:text-accent-500 transition-colors'

/** `inert`: the studio preview's stand-ins for a store that has not added its profiles yet (icons, no links). */
export function SocialIcons({ links, items, className, inert = false }: { links: { network: SocialNetwork; href: string }[]; items?: ReactNode[]; className?: string; inert?: boolean }) {
  if (!links.length) return null
  return (
    <ul className={className || 'flex items-center gap-3'}>
      {links.map((l, i) => (
        <li key={`${l.network}:${i}`}>
          {items ? (
            items[i]
          ) : inert ? (
            <span role="presentation" className={SOCIAL_ICON}>
              <SocialGlyph network={l.network} />
            </span>
          ) : (
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={SOCIAL_LABEL[l.network]}
              className={SOCIAL_ICON}
            >
              <SocialGlyph network={l.network} />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}
