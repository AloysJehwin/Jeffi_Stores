'use client'

import Link from 'next/link'
import { businessSectionPublic, sectionCopyDefaults, type BusinessAccountTile } from '@/lib/catalog/homepage-sections'
import { formatDate, formatINR, humanizeLabel } from '@/lib/shared/format'
import { useBusinessHome } from './BusinessHomeProvider'
import { SectionHeading, SignInPrompt, SkeletonBlocks } from './parts'
import type { BusinessSection } from './business-home'

const TILE_TITLES: Record<BusinessAccountTile, string> = {
  orders: 'Recent orders',
  payments: 'Payments due',
  quotes: 'Open quotes',
}

const TILE = 'bg-surface-elevated rounded-2xl border border-border-default p-5 flex flex-col'
const TILE_LINK = 'mt-auto pt-4 text-sm text-accent-500 hover:text-accent-400 font-semibold transition-colors'

/** Company, recent orders, payments due, open quotes and the sales contact. */
export default function BusinessAccount({ section }: { section: BusinessSection }) {
  const { status, data, href } = useBusinessHome()
  const pub = businessSectionPublic(section)
  if (!pub?.account) return null
  const copy = sectionCopyDefaults(section.type)
  const eyebrow = section.eyebrow ?? copy.eyebrow
  const title = section.title ?? copy.title

  if (status === 'visitor') {
    if (pub.visitor !== 'signin') return null
    return (
      <SignInPrompt
        eyebrow={eyebrow}
        title={title}
        message="Sign in to see your orders, payments due and open quotes."
      />
    )
  }
  if (status === 'error') return null

  const { tiles, contact } = pub.account
  const account = data?.account
  const cols = tiles.length >= 3 ? 'md:grid-cols-3' : tiles.length === 2 ? 'md:grid-cols-2' : ''

  const tile = (t: BusinessAccountTile) => {
    if (t === 'orders') {
      const orders = account?.recentOrders ?? []
      return (
        <>
          {orders.length === 0 ? (
            <p className="text-sm text-foreground-secondary">No orders yet.</p>
          ) : (
            <ul className="space-y-2">
              {orders.map(o => (
                <li key={o.id}>
                  <Link
                    href={href(`/business/account/orders/${o.id}`)}
                    className="flex items-center justify-between gap-3 text-sm hover:text-accent-500 transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-foreground truncate">{o.orderNumber}</span>
                      <span className="block text-xs text-foreground-muted">
                        {humanizeLabel(o.status)} · {formatDate(o.createdAt)}
                      </span>
                    </span>
                    <span className="font-semibold text-foreground shrink-0">{formatINR(o.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href={href('/business/account/orders')} className={TILE_LINK}>
            View all orders
          </Link>
        </>
      )
    }
    if (t === 'payments') {
      const due = account?.paymentsDue ?? { count: 0, total: 0 }
      return (
        <>
          <p className="text-3xl font-black text-foreground">{formatINR(due.total)}</p>
          <p className="text-sm text-foreground-secondary mt-1">
            {due.count === 0 ? 'Nothing due' : `${due.count} unpaid ${due.count === 1 ? 'order' : 'orders'}`}
          </p>
          <Link href={href('/business/account/orders')} className={TILE_LINK}>
            View orders
          </Link>
        </>
      )
    }
    const open = data?.quotes?.open ?? 0
    return (
      <>
        <p className="text-3xl font-black text-foreground">{open}</p>
        <p className="text-sm text-foreground-secondary mt-1">{open === 1 ? 'Quote in progress' : 'Quotes in progress'}</p>
        <Link href={href('/business/quotes')} className={TILE_LINK}>
          View quotes
        </Link>
      </>
    )
  }

  return (
    <section className="py-12 md:py-16 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <SectionHeading eyebrow={eyebrow} title={title} />

        {status === 'loading' ? (
          <div className={`grid grid-cols-1 gap-5 ${cols}`}>
            <SkeletonBlocks count={Math.max(tiles.length, 1)} className="h-40" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-surface-elevated rounded-2xl border border-border-default p-5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-lg font-bold text-foreground">{data?.company.name || 'Your business'}</p>
              {data?.company.gstNumber && (
                <p className="text-sm text-foreground-secondary">GSTIN {data.company.gstNumber}</p>
              )}
            </div>

            {tiles.length > 0 && (
              <div className={`grid grid-cols-1 gap-5 ${cols}`}>
                {tiles.map(t => (
                  <div key={t} className={TILE}>
                    <h3 className="text-xs font-black uppercase tracking-[0.15em] text-foreground-muted mb-3">
                      {TILE_TITLES[t]}
                    </h3>
                    {tile(t)}
                  </div>
                ))}
              </div>
            )}

            {contact && (
              <div className="bg-surface-elevated rounded-2xl border border-border-default p-5">
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-foreground-muted mb-2">
                  Your sales contact
                </h3>
                {contact.name && <p className="font-bold text-foreground">{contact.name}</p>}
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm">
                  {contact.phone && (
                    <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="text-accent-500 hover:text-accent-400">
                      {contact.phone}
                    </a>
                  )}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-accent-500 hover:text-accent-400">
                      {contact.email}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
