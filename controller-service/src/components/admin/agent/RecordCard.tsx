'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Box, ChevronRight, CreditCard, ExternalLink, FileText,
  Mail, Megaphone, MessageSquare, Package, Receipt, ShoppingBag, Store, Tag, Ticket, Truck, User, Users, Wallet,
  type LucideIcon,
} from 'lucide-react'
import { badgeCls } from '../kit/tones'
import { arr, fmtINR, fmtPct, fmtQty, KIT_TONE, parseNumber, safeHref, TEXT_TONE, type BlockTone } from './format'

// One card for any record or summary the agent shows (invoice, coupon, campaign, supplier, KPIs, an
// order's details...): header, badges, stat tiles, fields, a short item list, progress, note, actions.

type Format = 'inr' | 'number' | 'percent' | 'date' | 'datetime' | 'text'
type EntityRef = { kind: string; id: string }

interface CardStat {
  label: string
  value: string | number
  format?: Format
  /** Change vs. the previous period, in percent. */
  delta?: number
  hint?: string
}
interface CardField {
  label: string
  value: string | number
  format?: Format
  href?: string
  entity?: EntityRef
}
interface CardItem {
  title: string
  subtitle?: string
  value?: string | number
  format?: Format
  badge?: { label: string; tone?: string }
  image_url?: string
  href?: string
  entity?: EntityRef
}
interface CardAction {
  label: string
  href?: string
  entity?: EntityRef
  /** Sent as the admin's next chat message (never changes data by itself). */
  prompt?: string
  primary?: boolean
}

export interface CardData {
  title: string
  subtitle?: string
  eyebrow?: string
  icon?: string
  image_url?: string
  href?: string
  entity?: EntityRef
  tone?: string
  badges?: { label: string; tone?: string }[]
  stats?: CardStat[]
  fields?: CardField[]
  items?: CardItem[]
  progress?: { label?: string; value: number; max: number }
  note?: string
  actions?: CardAction[]
}

export interface CardBlockData extends CardData {
  type: 'card'
}
export interface CardsBlockData {
  type: 'cards'
  layout?: 'grid' | 'list'
  cards: CardData[]
}

const ICONS: Record<string, LucideIcon> = {
  product: Package, order: ShoppingBag, customer: User, customers: Users, invoice: Receipt, quotation: FileText,
  document: FileText, coupon: Ticket, campaign: Megaphone, email: Mail, supplier: Truck, shipment: Truck,
  payment: CreditCard, wallet: Wallet, report: BarChart3, metric: BarChart3, category: Tag, brand: Tag,
  store: Store, inventory: Box, alert: AlertTriangle,
}
const ITEMS_SHOWN = 6
const label = 'text-[10px] font-semibold uppercase tracking-wide text-foreground-muted'

const toneOf = (t: unknown): BlockTone =>
  t === 'error' ? 'danger' : typeof t === 'string' && t in KIT_TONE ? (t as BlockTone) : 'neutral'

const imageSrc = (src: unknown) => (typeof src === 'string' && /^(https:\/\/|\/(?!\/))/i.test(src) ? src : null)

function fmt(value: unknown, format?: Format): string {
  if (value == null || value === '') return '—'
  const n = parseNumber(value)
  switch (format) {
    case 'inr':
      return fmtINR(value)
    case 'number':
      return n == null ? String(value) : fmtQty(n)
    case 'percent':
      return n == null ? String(value) : fmtPct(n)
    case 'date':
    case 'datetime': {
      const d = new Date(String(value))
      if (isNaN(d.getTime())) return String(value)
      return format === 'date'
        ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    }
    default:
      return String(value)
  }
}

function MaybeLink({ href, className, children }: { href: string | null; className?: string; children: ReactNode }) {
  if (!href) return <span className={className}>{children}</span>
  return href.startsWith('https://') ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

export function RecordCard({ card, onSendMessage }: { card: CardData; onSendMessage?: (msg: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const tone = toneOf(card.tone)
  const href = safeHref(card.href, card.entity)
  const img = imageSrc(card.image_url)
  const badges = arr(card.badges).filter(b => b?.label)
  const stats = arr(card.stats).filter(s => s?.label)
  const Icon = ICONS[card.icon || card.entity?.kind || ''] ?? (stats.length ? BarChart3 : FileText)
  const fields = arr(card.fields).filter(f => f?.label)
  const items = arr(card.items).filter(i => i?.title)
  const actions = arr(card.actions).filter(a => a?.label && (a.prompt ? onSendMessage : safeHref(a.href, a.entity)))
  const shown = expanded ? items : items.slice(0, ITEMS_SHOWN)
  const progress = card.progress && card.progress.max > 0 ? Math.min(100, Math.max(0, (card.progress.value / card.progress.max) * 100)) : null

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-surface-elevated text-xs text-foreground ${
        tone === 'neutral' ? 'border-border-default' : `border-border-default border-l-4 ${TONE_BORDER[tone]}`
      }`}
    >
      <div className="flex flex-wrap items-start gap-2.5 px-3 py-2.5">
        {img ? (
          <img src={img} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-600 dark:text-accent-400">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-[9rem] flex-1">
          {card.eyebrow && <p className={label}>{card.eyebrow}</p>}
          <MaybeLink href={href} className={`text-sm font-semibold leading-snug [overflow-wrap:anywhere] ${href ? 'hover:text-accent-600 dark:hover:text-accent-400' : ''}`}>
            {card.title}
            {href && <ChevronRight className="ml-0.5 inline h-3.5 w-3.5 -translate-y-px text-foreground-muted" />}
          </MaybeLink>
          {card.subtitle && <p className="mt-0.5 text-foreground-muted [overflow-wrap:anywhere]">{card.subtitle}</p>}
        </div>
        {badges.length > 0 && (
          <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
            {badges.map((b, i) => (
              <span key={i} className={badgeCls(KIT_TONE[toneOf(b.tone)])}>
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {stats.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-px border-t border-border-default bg-border-default">
          {stats.map((s, i) => (
            <div key={i} className="bg-surface-elevated px-3 py-2">
              <p className={label}>{s.label}</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums">{fmt(s.value, s.format)}</p>
              {(typeof s.delta === 'number' || s.hint) && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-foreground-muted">
                  {typeof s.delta === 'number' && (
                    <span className={`inline-flex items-center tabular-nums ${s.delta >= 0 ? TEXT_TONE.success : TEXT_TONE.danger}`}>
                      {s.delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {fmtPct(Math.abs(s.delta))}
                    </span>
                  )}
                  {s.hint && <span className="truncate">{s.hint}</span>}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {fields.length > 0 && (
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-1.5 border-t border-border-default px-3 py-2.5">
          {fields.map((f, i) => {
            const fh = safeHref(f.href, f.entity)
            return (
              <div key={i} className="flex min-w-0 justify-between gap-3 sm:block">
                <dt className="shrink-0 text-foreground-muted">{f.label}</dt>
                <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere] sm:text-left">
                  <MaybeLink href={fh} className={fh ? 'text-accent-600 hover:underline dark:text-accent-400' : ''}>
                    {fmt(f.value, f.format)}
                  </MaybeLink>
                </dd>
              </div>
            )
          })}
        </dl>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-border-default border-t border-border-default">
          {shown.map((it, i) => {
            const ih = safeHref(it.href, it.entity)
            const iimg = imageSrc(it.image_url)
            return (
              <li key={i}>
                <MaybeLink href={ih} className={`flex items-center gap-2.5 px-3 py-2 ${ih ? 'hover:bg-surface-secondary' : ''}`}>
                  {iimg && <img src={iimg} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{it.title}</span>
                    {it.subtitle && <span className="block truncate text-[11px] text-foreground-muted">{it.subtitle}</span>}
                  </span>
                  {it.badge?.label && <span className={`${badgeCls(KIT_TONE[toneOf(it.badge.tone)])} shrink-0`}>{it.badge.label}</span>}
                  {it.value != null && it.value !== '' && <span className="shrink-0 font-semibold tabular-nums">{fmt(it.value, it.format)}</span>}
                </MaybeLink>
              </li>
            )
          })}
          {items.length > ITEMS_SHOWN && (
            <li>
              <button type="button" onClick={() => setExpanded(v => !v)} className="w-full px-3 py-1.5 text-left text-[11px] font-medium text-accent-600 hover:underline dark:text-accent-400">
                {expanded ? 'Show fewer' : `Show all ${items.length}`}
              </button>
            </li>
          )}
        </ul>
      )}

      {progress != null && (
        <div className="border-t border-border-default px-3 py-2.5">
          <div className="mb-1 flex justify-between text-[11px] text-foreground-muted">
            <span>{card.progress!.label}</span>
            <span className="tabular-nums">
              {fmtQty(card.progress!.value)} / {fmtQty(card.progress!.max)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-secondary">
            <div className="h-full rounded-full bg-accent-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {card.note && (
        <p className={`border-t border-border-default px-3 py-2 [overflow-wrap:anywhere] ${tone === 'neutral' ? 'text-foreground-muted' : TEXT_TONE[tone]}`}>{card.note}</p>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border-default bg-surface-secondary px-3 py-2">
          {actions.map((a, i) => {
            const cls = `inline-flex h-control-sm items-center gap-1 rounded px-2.5 text-[11px] font-semibold ${
              a.primary ? 'bg-accent-500 text-white hover:bg-accent-600' : 'border border-border-default bg-surface-elevated hover:bg-surface-secondary'
            }`
            if (a.prompt)
              return (
                <button key={i} type="button" className={cls} onClick={() => onSendMessage?.(a.prompt!)}>
                  <MessageSquare className="h-3 w-3" />
                  {a.label}
                </button>
              )
            const ah = safeHref(a.href, a.entity)!
            return (
              <MaybeLink key={i} href={ah} className={cls}>
                {a.label}
                {ah.startsWith('https://') && <ExternalLink className="h-3 w-3" />}
              </MaybeLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

const TONE_BORDER: Record<BlockTone, string> = {
  neutral: '',
  info: 'border-l-blue-500',
  success: 'border-l-green-500',
  warn: 'border-l-amber-500',
  danger: 'border-l-red-500',
}

export function RecordCards({ block, onSendMessage }: { block: CardsBlockData; onSendMessage?: (msg: string) => void }) {
  const cards = arr(block.cards).filter(c => c?.title)
  return (
    <div className={block.layout === 'list' ? 'space-y-2' : 'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2'}>
      {cards.map((c, i) => (
        <RecordCard key={i} card={c} onSendMessage={onSendMessage} />
      ))}
    </div>
  )
}
