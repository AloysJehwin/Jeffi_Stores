'use client'

import Link from 'next/link'
import { Package, ShoppingBag, User, AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const INR_FORMATTER = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function parseNumber(input: unknown): number | null {
  if (input == null) return null
  if (typeof input === 'number') return isFinite(input) ? input : null
  const cleaned = String(input).replace(/[₹,\s]/g, '').trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return isFinite(n) ? n : null
}

function fmtINR(input: unknown, fallback = '—'): string {
  const n = parseNumber(input)
  if (n == null) return fallback
  return `₹${INR_FORMATTER.format(n)}`
}

function fmtPriceOrAsk(input: unknown): string {
  const n = parseNumber(input)
  if (n == null || n <= 0) return 'Price on request'
  return fmtINR(n)
}

function fmtStock(input: unknown): { label: string; tone: 'ok' | 'low' | 'out' | 'unknown' } {
  const n = parseNumber(input)
  if (n == null) return { label: 'Stock —', tone: 'unknown' }
  if (n <= 0) return { label: 'Out of stock', tone: 'out' }
  if (n < 5) return { label: `Low stock (${n})`, tone: 'low' }
  return { label: `${n} in stock`, tone: 'ok' }
}

export interface BaseBlock {
  type: string
  [key: string]: unknown
}

interface TextBlock extends BaseBlock { type: 'text'; value: string; weight?: 'normal' | 'bold' | 'muted' }
interface HeadingBlock extends BaseBlock { type: 'heading'; value: string; level?: 1 | 2 | 3 }
interface KvPairsBlock extends BaseBlock { type: 'kv_pairs'; pairs: { key: string; value: string }[] }
interface TableBlock extends BaseBlock { type: 'table'; headers: string[]; rows: (string | number)[][] }
interface ProductGridBlock extends BaseBlock {
  type: 'product_grid'
  products: { id: string; name: string; sku?: string; price?: string | number; image_url?: string | null; stock?: number | string; subtitle?: string }[]
}
interface CustomerListBlock extends BaseBlock {
  type: 'customer_list'
  customers: { id: string; name?: string; email: string; total_orders?: number | string; lifetime_value?: number | string; phone?: string | null }[]
}
interface OrderListBlock extends BaseBlock {
  type: 'order_list'
  orders: { id: string; order_number: string; status: string; total?: number | string; created_at?: string; customer_name?: string }[]
}
interface ChoicePickerBlock extends BaseBlock {
  type: 'choice_picker'
  choice_kind: string
  options: { id: string; label: string; sublabel?: string }[]
  note?: string
}
interface CalloutBlock extends BaseBlock { type: 'callout'; tone: 'info' | 'warn' | 'error' | 'success'; message: string; title?: string }
interface CodeBlockType extends BaseBlock { type: 'code_block'; content: string; language?: string }
interface LinkButtonBlock extends BaseBlock { type: 'link_button'; label: string; href: string }
interface ImageCardBlock extends BaseBlock { type: 'image_card'; image_url: string; title?: string; subtitle?: string; href?: string }

export type UiBlock =
  | TextBlock | HeadingBlock | KvPairsBlock | TableBlock
  | ProductGridBlock | CustomerListBlock | OrderListBlock
  | ChoicePickerBlock | CalloutBlock | CodeBlockType | LinkButtonBlock | ImageCardBlock

interface Props {
  blocks: UiBlock[]
  onPickOption?: (kind: string, option: { id: string; label: string }) => void
  pickerResolved?: boolean
}

export default function AdminAgentBlocks({ blocks, onPickOption, pickerResolved }: Props) {
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <div key={i}>{renderBlock(block, { onPickOption, pickerResolved })}</div>
      ))}
    </div>
  )
}

function renderBlock(b: UiBlock, ctx: { onPickOption?: Props['onPickOption']; pickerResolved?: boolean }): ReactNode {
  switch (b.type) {
    case 'text': {
      const cls = b.weight === 'bold' ? 'text-sm font-semibold text-foreground' :
                  b.weight === 'muted' ? 'text-xs text-foreground-muted' :
                  'text-sm text-foreground'
      return <p className={`${cls} whitespace-pre-wrap`}>{b.value}</p>
    }
    case 'heading': {
      const lvl = b.level ?? 2
      const cls = lvl === 1 ? 'text-base font-bold' : lvl === 2 ? 'text-sm font-bold' : 'text-xs font-semibold uppercase tracking-wide text-foreground-muted'
      return <p className={cls}>{b.value}</p>
    }
    case 'kv_pairs':
      return (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          {b.pairs.map((p, i) => (
            <div key={i} className="contents">
              <dt className="text-foreground-muted">{p.key}</dt>
              <dd className="text-foreground">{p.value}</dd>
            </div>
          ))}
        </dl>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="border-b border-border-default">
                {b.headers.map((h, i) => <th key={i} className="text-left font-semibold py-1.5 px-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border-default/50">
                  {row.map((cell, ci) => <td key={ci} className="py-1.5 px-2 align-top">{String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'product_grid':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {b.products.map(p => {
            const stockInfo = fmtStock(p.stock)
            return (
              <Link
                key={p.id}
                href={`/admin/products/${p.id}`}
                className="flex gap-3 p-2 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors"
              >
                <div className="w-12 h-12 rounded bg-surface-secondary flex items-center justify-center shrink-0 overflow-hidden">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-foreground-muted" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{p.name}</p>
                  {p.sku && <p className="text-[10px] text-foreground-muted font-mono">{p.sku}</p>}
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <p className="text-xs font-medium text-foreground tabular-nums">{fmtPriceOrAsk(p.price)}</p>
                    <p className={`text-[10px] tabular-nums ${
                      stockInfo.tone === 'out' ? 'text-red-600 dark:text-red-400'
                      : stockInfo.tone === 'low' ? 'text-amber-600 dark:text-amber-400'
                      : 'text-foreground-muted'
                    }`}>
                      {stockInfo.label}
                    </p>
                  </div>
                  {p.subtitle && <p className="text-[10px] text-foreground-muted mt-0.5">{p.subtitle}</p>}
                </div>
              </Link>
            )
          })}
        </div>
      )
    case 'customer_list':
      return (
        <div className="space-y-1">
          {b.customers.map(c => (
            <Link key={c.id} href={`/admin/customers/${c.id}`} className="flex items-center gap-2 p-2 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors">
              <User className="w-4 h-4 text-foreground-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">{c.name || c.email}</p>
                <p className="text-[10px] text-foreground-muted truncate">{c.email}{c.phone ? ` · ${c.phone}` : ''}</p>
              </div>
              {c.total_orders !== undefined && (
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-foreground-muted">orders</p>
                  <p className="text-xs font-semibold text-foreground">{c.total_orders}</p>
                </div>
              )}
              {c.lifetime_value !== undefined && (
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-foreground-muted">LTV</p>
                  <p className="text-xs font-semibold text-foreground tabular-nums">{fmtINR(c.lifetime_value)}</p>
                </div>
              )}
            </Link>
          ))}
        </div>
      )
    case 'order_list':
      return (
        <div className="space-y-1">
          {b.orders.map(o => (
            <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex items-center gap-2 p-2 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors">
              <ShoppingBag className="w-4 h-4 text-foreground-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">{o.order_number}{o.customer_name ? ` · ${o.customer_name}` : ''}</p>
                <p className="text-[10px] text-foreground-muted">
                  {o.status}
                  {o.created_at ? ` · ${new Date(o.created_at).toLocaleDateString()}` : ''}
                </p>
              </div>
              {o.total !== undefined && <p className="text-xs font-semibold text-foreground shrink-0 tabular-nums">{fmtINR(o.total)}</p>}
            </Link>
          ))}
        </div>
      )
    case 'choice_picker':
      if (ctx.pickerResolved) return null
      return (
        <div className="rounded-lg border border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/10 p-3">
          <p className="text-xs font-semibold text-accent-900 dark:text-accent-200 mb-2">Pick a {b.choice_kind}{b.note ? ` — ${b.note}` : ''}</p>
          <div className="space-y-1">
            {b.options.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => ctx.onPickOption?.(b.choice_kind, { id: opt.id, label: opt.label })}
                className="w-full text-left px-3 py-1.5 rounded-md hover:bg-accent-100 dark:hover:bg-accent-900/30 transition-colors"
              >
                <p className="text-sm font-medium text-foreground">{opt.label}</p>
                {opt.sublabel && <p className="text-[11px] text-foreground-muted">{opt.sublabel}</p>}
              </button>
            ))}
          </div>
        </div>
      )
    case 'callout': {
      const tone = b.tone || 'info'
      const Icon = tone === 'warn' ? AlertTriangle : tone === 'error' ? XCircle : tone === 'success' ? CheckCircle : Info
      const cls = tone === 'warn'
        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
        : tone === 'error'
          ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-900 dark:text-red-200'
          : tone === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-900 dark:text-green-200'
            : 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-200'
      return (
        <div className={`rounded-lg border p-3 flex items-start gap-2 text-xs ${cls}`}>
          <Icon className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            {b.title && <p className="font-semibold mb-0.5">{b.title}</p>}
            <p>{b.message}</p>
          </div>
        </div>
      )
    }
    case 'code_block':
      return (
        <pre className="text-[11px] font-mono bg-surface-secondary text-foreground rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {b.content}
        </pre>
      )
    case 'link_button':
      return (
        <Link href={b.href} className="inline-flex items-center px-3 py-1.5 rounded text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white">
          {b.label}
        </Link>
      )
    case 'image_card': {
      const inner = (
        <div className="flex gap-3 p-2 rounded-lg border border-border-default">
          <img src={b.image_url} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
          <div className="min-w-0">
            {b.title && <p className="text-xs font-semibold text-foreground">{b.title}</p>}
            {b.subtitle && <p className="text-[10px] text-foreground-muted">{b.subtitle}</p>}
          </div>
        </div>
      )
      return b.href ? <Link href={b.href}>{inner}</Link> : inner
    }
    default:
      return <p className="text-xs text-foreground-muted">[unknown block type: {(b as any).type}]</p>
  }
}
