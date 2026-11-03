'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Bot, ChevronDown, Clock, CreditCard, History, Settings2, Truck, User } from 'lucide-react'
import { Card } from '@/components/admin/kit/layout'
import { Sheet } from '@/components/admin/kit/dialog'
import { StatusBadge } from '@/components/admin/kit/status'
import { statusMap } from './status'
import { KIND_NOUN, VERB, fieldLabel, formatWhen, headline, showValue, textOf, timeAgo, type ShownValue } from '@/lib/admin/change-log-format'
import type { ChangeActor, ChangeItem, ChangePart, FieldChange } from '@/lib/admin/change-log'
import { useChangeLog, type ChangeLogState } from './useChangeLog'

// A record's change log: who changed what, and when. One component in four shapes, so each view page
// can place it to fit: a card in the main column, a compact card in the aside, a collapsible section,
// or a bare list for a tab.

type Preset = 'order' | 'product'

const PRICE_STOCK = new Set(['price', 'selling_price', 'mrp', 'cost_price', 'stock_quantity', 'stock', 'gst_rate', 'discount_pct'])
const ORDER_STATUS_FIELDS = new Set(['status', 'payment_status', 'shipment_status'])

const CHIPS: Record<Preset, { label: string; match?: (p: ChangePart) => boolean }[]> = {
  order: [
    { label: 'All' },
    { label: 'Status', match: p => !p.child && (p.action === 'create' || p.changes.some(c => ORDER_STATUS_FIELDS.has(c.field))) },
    { label: 'Items', match: p => p.entityType === 'order_items' },
  ],
  product: [
    { label: 'All' },
    { label: 'Price & stock', match: p => p.changes.some(c => PRICE_STOCK.has(c.field)) },
    { label: 'Variants', match: p => p.entityType === 'product_variants' || p.entityType === 'product_sub_variants' },
    { label: 'Images', match: p => p.entityType === 'product_images' || p.entityType === 'variant_images' },
    { label: 'Details', match: p => !p.child && !p.changes.some(c => PRICE_STOCK.has(c.field)) },
  ],
}

const SOURCE_ICON: Record<string, typeof Truck> = { Razorpay: CreditCard, Delhivery: Truck, 'Scheduled job': Clock, Assistant: Bot }

function ActorIcon({ actor, size = 'md' }: { actor: ChangeActor; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-5 h-5 text-[9px]' : 'w-7 h-7 text-[11px]'
  const icon = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'
  if (actor.kind === 'admin') {
    const initials = actor.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || 'A'
    return <span className={`${box} shrink-0 rounded-full bg-accent-500/15 text-accent-600 dark:text-accent-400 font-semibold flex items-center justify-center`}>{initials}</span>
  }
  const Icon = actor.kind === 'customer' ? User : actor.kind === 'source' ? (SOURCE_ICON[actor.name] ?? Settings2) : Settings2
  return (
    <span className={`${box} shrink-0 rounded-full bg-surface-secondary text-foreground-muted flex items-center justify-center`}>
      <Icon className={icon} />
    </span>
  )
}

function Value({ v, strike }: { v: ShownValue; strike?: boolean }) {
  const [open, setOpen] = useState(false)
  if (v.kind === 'empty') return <span className="text-foreground-muted">—</span>
  if (v.kind === 'status') return <span className={strike ? 'opacity-60' : ''}><StatusBadge status={v.status} map={statusMap(v.domain)} /></span>
  if (v.kind === 'image')
    return (
      <a href={v.url} target="_blank" rel="noopener noreferrer" className={`inline-block align-middle ${strike ? 'opacity-50' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={v.url} alt="" className="w-8 h-8 rounded object-cover border border-border-default" />
      </a>
    )
  if (v.kind === 'link')
    return (
      <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
        {v.text}
      </a>
    )
  return (
    <span className={strike ? 'text-foreground-muted line-through decoration-foreground-muted/50' : 'text-foreground'}>
      {v.full && open ? <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] font-mono">{v.full}</pre> : v.text}
      {v.full && (
        <button type="button" onClick={() => setOpen(o => !o)} className="ml-1 text-[11px] text-accent-600 hover:underline no-underline">
          {open ? 'less' : 'more'}
        </button>
      )}
    </span>
  )
}

function FieldRow({ entityType, c }: { entityType: string; c: FieldChange }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-relaxed">
      <span className="text-foreground-muted">{fieldLabel(c.field)}</span>
      <Value v={showValue(entityType, c.field, c.from, c.fromLabel)} strike />
      <span className="text-foreground-muted">→</span>
      <Value v={showValue(entityType, c.field, c.to, c.toLabel)} />
    </div>
  )
}

/** One line for the compact card: "Status → Shipped", else the headline. */
function oneLine(item: ChangeItem, noun: string): string {
  const parent = item.parts.find(p => !p.child)
  if (!item.summary && parent?.action === 'update' && parent.changes.length) {
    const c = parent.changes[0]
    const more = parent.changes.length - 1 + item.parts.length - 1
    const to = showValue(parent.entityType, c.field, c.to, c.toLabel)
    const text = to.kind === 'status' ? (statusMap(to.domain)?.[to.status]?.label ?? textOf(to)) : textOf(to)
    return `${fieldLabel(c.field)} → ${text}${more > 0 ? ` +${more}` : ''}`
  }
  const h = headline(item, noun)
  return h.charAt(0).toUpperCase() + h.slice(1)
}

const SHOW_FIELDS = 6

export function ChangeEntry({ item, noun, last }: { item: ChangeItem; noun: string; last?: boolean }) {
  const [all, setAll] = useState(false)
  const parent = item.parts.find(p => !p.child)
  const children = item.parts.filter(p => p.child)
  const rows: ReactNode[] = []
  for (const c of parent?.action === 'update' ? parent.changes : []) rows.push(<FieldRow key={`p-${c.field}`} entityType={parent!.entityType} c={c} />)
  for (const p of children) {
    rows.push(
      <div key={`c-${p.entityType}-${p.entityId}-${p.action}`} className="text-xs">
        <span className="text-foreground-muted">{p.child!.label}</span>{' '}
        <span className="text-foreground">{p.child!.name ? `“${p.child!.name}”` : ''}</span>
        {p.action !== 'update' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-foreground-muted">{VERB[p.action] ?? p.action}</span>}
        {p.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt="" className="inline-block ml-1.5 w-6 h-6 rounded object-cover border border-border-default align-middle" />
        )}
        {p.action === 'update' && p.changes.length > 0 && (
          <div className="pl-3 mt-0.5 space-y-0.5 border-l border-border-default">
            {p.changes.map(c => (
              <FieldRow key={c.field} entityType={p.entityType} c={c} />
            ))}
          </div>
        )}
      </div>
    )
  }
  const shown = all ? rows : rows.slice(0, SHOW_FIELDS)
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span className="absolute left-3.5 top-8 bottom-0 w-px bg-border-default" aria-hidden />}
      <ActorIcon actor={item.actor} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-sm font-medium text-foreground">{item.actor.name}</span>
          <span className="text-xs text-foreground-muted" title={formatWhen(item.at)}>
            {timeAgo(item.at)}
          </span>
          {item.ip && <span className="text-[10px] text-foreground-muted">· {item.ip}</span>}
        </div>
        <p className="text-sm text-foreground-secondary break-words">{headline(item, noun)}</p>
        {rows.length > 0 && (
          <div className="mt-1.5 space-y-1 rounded-lg bg-surface-secondary/60 px-2.5 py-2">
            {shown}
            {rows.length > SHOW_FIELDS && (
              <button type="button" onClick={() => setAll(a => !a)} className="text-[11px] text-accent-600 hover:underline">
                {all ? 'Show less' : `Show ${rows.length - SHOW_FIELDS} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function filterItems(items: ChangeItem[], match?: (p: ChangePart) => boolean): ChangeItem[] {
  if (!match) return items
  return items.flatMap(i => {
    const parts = i.parts.filter(match)
    return parts.length ? [{ ...i, parts, summary: parts.length === i.parts.length ? i.summary : null }] : []
  })
}

function States({ log, empty }: { log: ChangeLogState; empty: boolean }) {
  if (log.loading) return <p className="text-xs text-foreground-muted py-2">Loading changes…</p>
  if (log.error && empty)
    return (
      <p className="text-xs text-foreground-muted py-2">
        Couldn’t load the change log.{' '}
        <button type="button" onClick={log.reload} className="text-accent-600 hover:underline">
          Retry
        </button>
      </p>
    )
  if (empty) return <p className="text-xs text-foreground-muted py-2">No changes recorded yet.</p>
  return null
}

/** The list itself: entries, then "Show more" over what's loaded and then the next page. */
function ChangeList({ log, noun, preset, step = 10 }: { log: ChangeLogState; noun: string; preset?: Preset; step?: number }) {
  const [chip, setChip] = useState(0)
  const [visible, setVisible] = useState(step)
  const chips = preset ? CHIPS[preset] : null
  const items = useMemo(() => filterItems(log.items, chips?.[chip]?.match), [log.items, chips, chip])
  const shown = items.slice(0, visible)
  const more = items.length > visible || log.hasMore
  return (
    <div>
      {chips && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {chips.map((c, i) => (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                setChip(i)
                setVisible(step)
              }}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                i === chip ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300' : 'border-border-default text-foreground-muted hover:text-foreground'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <States log={log} empty={!items.length} />
      {!log.loading && shown.length > 0 && (
        <ul>
          {shown.map((i, n) => (
            <ChangeEntry key={i.id} item={i} noun={noun} last={n === shown.length - 1 && !more} />
          ))}
        </ul>
      )}
      {!log.loading && more && (
        <button
          type="button"
          disabled={log.loadingMore}
          onClick={() => {
            setVisible(v => v + step)
            if (items.length <= visible + step) log.loadMore()
          }}
          className="mt-3 text-xs text-accent-600 hover:underline disabled:opacity-50"
        >
          {log.loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  )
}

interface ChangeLogProps {
  kind: string
  id: string
  /** card: main column · compact: aside, opens the full log in a sheet · collapsible: closed until opened · plain: no chrome */
  variant?: 'card' | 'compact' | 'collapsible' | 'plain'
  title?: string
  /** filter chips for this kind of record */
  preset?: Preset
  /** the record's updated_at, so the log refreshes after the page saves */
  version?: unknown
}

export default function ChangeLog({ kind, id, variant = 'card', title, preset, version }: ChangeLogProps) {
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const log = useChangeLog(kind, id, { version, enabled: variant !== 'collapsible' || open })
  const noun = KIND_NOUN[kind] ?? 'record'

  if (variant === 'plain') return <ChangeList log={log} noun={noun} preset={preset} />

  if (variant === 'collapsible')
    return (
      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground">
            <History className="w-4 h-4 text-foreground-muted" />
            {title ?? 'Change log'}
          </span>
          <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="px-4 pb-4 pt-1">
            <ChangeList log={log} noun={noun} preset={preset} />
          </div>
        )}
      </div>
    )

  if (variant === 'compact') {
    const recent = log.items.slice(0, 4)
    return (
      <Card
        title={title ?? 'Recent changes'}
        action={
          (log.items.length > 4 || log.hasMore) && (
            <button type="button" onClick={() => setSheet(true)} className="text-xs text-accent-600 hover:underline">
              View all
            </button>
          )
        }
      >
        <States log={log} empty={!log.items.length} />
        {!log.loading && recent.length > 0 && (
          <ul className="space-y-2.5">
            {recent.map(i => (
              <li key={i.id} className="flex items-start gap-2 min-w-0">
                <ActorIcon actor={i.actor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground break-words">{oneLine(i, noun)}</p>
                  <p className="text-[11px] text-foreground-muted truncate" title={formatWhen(i.at)}>
                    {i.actor.name} · {timeAgo(i.at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!log.loading && log.items.length > 0 && log.items.length <= 4 && !log.hasMore && (
          <button type="button" onClick={() => setSheet(true)} className="mt-3 text-xs text-accent-600 hover:underline">
            Details
          </button>
        )}
        <Sheet open={sheet} onClose={() => setSheet(false)} title={title ?? 'Change log'} description="Who changed what, and when">
          <ChangeList log={log} noun={noun} preset={preset} />
        </Sheet>
      </Card>
    )
  }

  return (
    <Card title={title ?? 'Change log'} hint="Who changed what, and when">
      <ChangeList log={log} noun={noun} preset={preset} />
    </Card>
  )
}
