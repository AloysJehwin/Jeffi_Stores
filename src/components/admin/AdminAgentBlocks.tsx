'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Package, ShoppingBag, User, AlertTriangle, Info, CheckCircle, XCircle, HelpCircle, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { ap } from '@/lib/admin-path'
import AdminSelect from './AdminSelect'
import CopySku from '@/components/ui/CopySku'

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

interface QuotationResolverSubVariant {
  id: string; name: string; sku: string | null; price: number
}
interface QuotationResolverVariant {
  id: string; name: string; sku: string | null; price: number
  subVariants?: QuotationResolverSubVariant[]
}
interface QuotationResolverCandidate {
  productId: string; name: string; sku: string | null; price: number; sim: number; score: number
  imageUrl?: string | null
  variants?: QuotationResolverVariant[]
}
interface QuotationResolverLine {
  requestedText: string; qty: number
  status: 'matched' | 'ambiguous' | 'unmatched'
  candidates: QuotationResolverCandidate[]
}
interface QuotationResolverBlock extends BaseBlock {
  type: 'quotation_resolver'
  lines: QuotationResolverLine[]
  counts: { matched: number; ambiguous: number; unmatched: number }
}

export type UiBlock =
  | TextBlock | HeadingBlock | KvPairsBlock | TableBlock
  | ProductGridBlock | CustomerListBlock | OrderListBlock
  | ChoicePickerBlock | CalloutBlock | CodeBlockType | LinkButtonBlock | ImageCardBlock
  | QuotationResolverBlock

interface Props {
  blocks: UiBlock[]
  onPickOption?: (kind: string, option: { id: string; label: string }) => void
  pickerResolved?: boolean
  onSendMessage?: (msg: string) => void
}

export default function AdminAgentBlocks({ blocks, onPickOption, pickerResolved, onSendMessage }: Props) {
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <div key={i}>{renderBlock(block, { onPickOption, pickerResolved, onSendMessage })}</div>
      ))}
    </div>
  )
}

function renderBlock(b: UiBlock, ctx: { onPickOption?: Props['onPickOption']; pickerResolved?: boolean; onSendMessage?: (msg: string) => void }): ReactNode {
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
                href={ap(`/admin/products/${p.id}`)}
                className="flex gap-3 p-2 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors"
              >
                <div className="w-12 h-12 rounded bg-surface-secondary flex items-center justify-center shrink-0 overflow-hidden">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-foreground-muted" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{p.name}</p>
                  {p.sku && <p className="text-[10px] text-foreground-muted font-mono"><span className="inline-flex items-center gap-1">{p.sku}<CopySku sku={p.sku} /></span></p>}
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
            <Link key={c.id} href={ap(`/admin/customers/${c.id}`)} className="flex items-center gap-2 p-2 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors">
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
            <Link key={o.id} href={ap(`/admin/orders/${o.id}`)} className="flex items-center gap-2 p-2 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors">
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
    case 'quotation_resolver':
      return <QuotationResolverBlockUI block={b} onSendMessage={ctx.onSendMessage} />
    default:
      return <p className="text-xs text-foreground-muted">[unknown block type: {(b as any).type}]</p>
  }
}

interface ManualPickResult {
  productId: string; name: string; sku: string | null; price: number
  sim?: number; score?: number
  imageUrl?: string | null
  variants?: QuotationResolverVariant[]
}

function ProductSearchPicker({ onPick }: { onPick: (p: ManualPickResult) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ManualPickResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=8`)
        const json = await res.json()
        const products = (Array.isArray(json) ? json : (json.products || json.results || [])) as Array<{
          id: string; name: string; sku?: string | null; base_price?: number; price?: number; image_url?: string | null; thumbnail_url?: string | null
        }>
        setResults(products.map(p => ({
          productId: p.id,
          name: p.name,
          sku: p.sku ?? null,
          price: p.price ?? p.base_price ?? 0,
          imageUrl: p.thumbnail_url || p.image_url || null,
        })))
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
  }, [])

  return (
    <div className="mt-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          placeholder="Search product catalog…"
          onChange={e => { setQuery(e.target.value); search(e.target.value) }}
          className="w-full rounded-md border border-border-default bg-surface-primary pl-7 pr-2 py-1.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent-500"
        />
      </div>
      {loading && <p className="text-[10px] text-foreground-muted mt-1">Searching…</p>}
      {results.length > 0 && (
        <div className="mt-1 rounded-md border border-border-default divide-y divide-border-default/50 overflow-hidden">
          {results.map(p => (
            <button
              key={p.productId}
              type="button"
              onClick={() => { onPick(p); setQuery(''); setResults([]) }}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-surface-secondary text-left"
            >
              {p.imageUrl
                ? <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                : <div className="w-8 h-8 rounded bg-surface-secondary flex items-center justify-center shrink-0"><Package className="w-3.5 h-3.5 text-foreground-muted" /></div>
              }
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                {p.sku && <p className="text-[10px] text-foreground-muted font-mono"><span className="inline-flex items-center gap-1">{p.sku}<CopySku sku={p.sku} /></span></p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function QuotationResolverBlockUI({
  block,
  onSendMessage,
}: {
  block: QuotationResolverBlock
  onSendMessage?: (msg: string) => void
}) {
  const { lines, counts } = block

  const [cardIndex, setCardIndex] = useState(0)
  const [candidateIndex, setCandidateIndex] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {}
    lines.forEach((_, i) => { init[i] = 0 })
    return init
  })
  // confirmedByLine[lineIdx] = { productId, variantId?, subVariantId?, name, price, sku, imageUrl? }
  const [confirmedByLine, setConfirmedByLine] = useState<Record<number, {
    productId: string; variantId?: string; subVariantId?: string
    name: string; price: number; sku: string | null; imageUrl?: string | null
  }>>({})
  const [variantSel, setVariantSel] = useState<Record<string, string>>({})
  const [subVariantSel, setSubVariantSel] = useState<Record<string, string>>({})
  // manualPick[lineIdx] = manually searched product (overrides candidates)
  const [manualPick, setManualPick] = useState<Record<number, ManualPickResult>>({})
  const [showSearch, setShowSearch] = useState<Record<number, boolean>>({})
  const [skippedLines, setSkippedLines] = useState<Record<number, boolean>>({})

  const ambiguousIndices = lines
    .map((l, i) => (l.status === 'ambiguous' || l.status === 'unmatched') ? i : -1)
    .filter(i => i >= 0)
  // "Create" enabled when all ambiguous lines are either confirmed or skipped
  const canCreate = lines
    .filter((l, i) => l.status === 'ambiguous' ? (!confirmedByLine[i] && !skippedLines[i]) : false)
    .length === 0

  const resolvedCount = lines.filter((l, i) =>
    (l.status === 'ambiguous' || l.status === 'unmatched') && (confirmedByLine[i] !== undefined || skippedLines[i])
  ).length
  const needsReviewCount = lines.filter(l => l.status === 'ambiguous').length

  function submitQuotation() {
    const items = lines.map((l, i) => {
      if (l.status === 'matched' && l.candidates[0]) {
        return { productId: l.candidates[0].productId, quantity: l.qty }
      }
      if (confirmedByLine[i]) {
        const c = confirmedByLine[i]
        return { productId: c.productId, variantId: c.variantId, subVariantId: c.subVariantId, quantity: l.qty }
      }
      if (skippedLines[i]) {
        return { skipped: true, requestedText: l.requestedText, quantity: l.qty }
      }
      return null
    }).filter(Boolean)
    if (!items.length) return
    onSendMessage?.(`__quotation_confirm__${JSON.stringify(items)}`)
  }

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-green-600 dark:text-green-400' :
    score >= 60 ? 'text-amber-600 dark:text-amber-400' :
    'text-red-500 dark:text-red-400'

  const scoreBg = (score: number) =>
    score >= 80 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
    score >= 60 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
    'border-border-default'

  if (!lines[cardIndex]) return null

  const currentLine = lines[cardIndex]
  const cidx = candidateIndex[cardIndex] ?? 0

  // Active candidate: manual pick overrides catalog candidates
  const manPick = manualPick[cardIndex]
  const activeCandidateRaw = manPick ?? currentLine.candidates[cidx]
  const candidate: (Partial<QuotationResolverCandidate> & ManualPickResult) | null = activeCandidateRaw ?? null

  const confirmed = confirmedByLine[cardIndex]
  const isAmbiguous = currentLine.status === 'ambiguous'
  const isMatched = currentLine.status === 'matched'
  const isUnmatched = currentLine.status === 'unmatched'
  const isResolved = confirmed !== undefined
  const isSkipped = !!skippedLines[cardIndex]

  const vKey = `${cardIndex}-${cidx}`
  const variants = candidate?.variants ?? []
  const selVariantId = variantSel[vKey] ?? variants[0]?.id ?? ''
  const selVariant = variants.find(v => v.id === selVariantId) ?? variants[0]
  const subVariants = selVariant?.subVariants ?? []
  const selSubVariantId = subVariantSel[vKey] ?? subVariants[0]?.id ?? ''
  const selSubVariant = subVariants.find(sv => sv.id === selSubVariantId)

  const displayPrice = selSubVariant?.price ?? selVariant?.price ?? candidate?.price ?? 0
  const displaySku = selSubVariant?.sku ?? selVariant?.sku ?? candidate?.sku ?? null

  function useCurrentCandidate() {
    if (!candidate) return
    setConfirmedByLine(prev => ({
      ...prev,
      [cardIndex]: {
        productId: candidate.productId,
        variantId: selVariant?.id,
        subVariantId: selSubVariant?.id,
        name: candidate.name,
        price: displayPrice,
        sku: displaySku,
        imageUrl: candidate.imageUrl,
      },
    }))
    setShowSearch(prev => ({ ...prev, [cardIndex]: false }))
    const nextUnresolved = lines.findIndex((l, i) =>
      i > cardIndex && (l.status === 'ambiguous' || l.status === 'unmatched') && !confirmedByLine[i]
    )
    if (nextUnresolved >= 0) setCardIndex(nextUnresolved)
  }

  function handleManualPick(p: ManualPickResult) {
    setManualPick(prev => ({ ...prev, [cardIndex]: p }))
    setVariantSel(prev => { const n = { ...prev }; delete n[vKey]; return n })
    setSubVariantSel(prev => { const n = { ...prev }; delete n[vKey]; return n })
    setShowSearch(prev => ({ ...prev, [cardIndex]: false }))
  }

  function lineDot(l: QuotationResolverLine, i: number) {
    if (l.status === 'matched') return 'bg-green-500'
    if (skippedLines[i]) return 'bg-slate-400 dark:bg-slate-500'
    if (l.status === 'unmatched' && !confirmedByLine[i]) return 'bg-red-400'
    if (confirmedByLine[i]) return 'bg-accent-500'
    return 'bg-amber-400'
  }

  return (
    <div className="rounded-lg border border-border-default overflow-hidden text-xs">
      {/* Header */}
      <div className="px-3 py-2 bg-surface-secondary border-b border-border-default flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground text-xs">
          {counts.matched} matched · {needsReviewCount} need review · {counts.unmatched} not found
          {needsReviewCount > 0 && (
            <span className="ml-2 text-foreground-muted font-normal">
              ({resolvedCount}/{needsReviewCount} resolved)
            </span>
          )}
        </p>
        {canCreate && (counts.matched > 0 || resolvedCount > 0) && (
          <button
            type="button"
            onClick={submitQuotation}
            className="px-2.5 py-1 rounded bg-accent-500 hover:bg-accent-600 text-white font-semibold shrink-0 text-xs"
          >
            Create quotation
          </button>
        )}
      </div>

      {/* Dot strip */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-default/60 overflow-x-auto">
        {lines.map((l, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setCardIndex(i)}
            title={`${i + 1}. ${l.requestedText}`}
            className={`w-2 h-2 rounded-full shrink-0 transition-all ${lineDot(l, i)} ${
              i === cardIndex ? 'ring-2 ring-offset-1 ring-foreground/40 scale-125' : 'opacity-60 hover:opacity-100'
            }`}
          />
        ))}
      </div>

      {/* Card */}
      <div className="p-3">
        {/* Card header: item nav + admin input */}
        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            disabled={cardIndex === 0}
            onClick={() => setCardIndex(c => c - 1)}
            className="p-0.5 rounded hover:bg-surface-secondary disabled:opacity-30 shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {isMatched && <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />}
              {isAmbiguous && !isResolved && !isSkipped && <HelpCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              {(isAmbiguous || isUnmatched) && isResolved && <CheckCircle className="w-3.5 h-3.5 text-accent-500 shrink-0" />}
              {isUnmatched && !isResolved && !isSkipped && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
              {isSkipped && <span className="text-[10px] text-foreground-muted font-medium shrink-0">skipped</span>}
              <span className="font-medium text-foreground truncate">{currentLine.requestedText}</span>
              <span className="text-foreground-muted shrink-0">× {currentLine.qty}</span>
            </div>
            <p className="text-[10px] text-foreground-muted mt-0.5">Item {cardIndex + 1} of {lines.length}</p>
          </div>

          <button
            type="button"
            disabled={cardIndex === lines.length - 1}
            onClick={() => setCardIndex(c => c + 1)}
            className="p-0.5 rounded hover:bg-surface-secondary disabled:opacity-30 shrink-0"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Resolved — show locked choice */}
        {isResolved && (() => {
          const c = confirmed
          return (
            <div className="rounded-lg border border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/10 p-2">
              <div className="flex gap-2.5">
                {c.imageUrl
                  ? <img src={c.imageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  : <div className="w-12 h-12 rounded bg-surface-secondary flex items-center justify-center shrink-0"><Package className="w-5 h-5 text-foreground-muted" /></div>
                }
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{c.name}</p>
                  <p className="text-[10px] font-mono text-foreground-muted"><span className="inline-flex items-center gap-1">{c.sku || '—'}{c.sku && <CopySku sku={c.sku} />}</span> · ₹{c.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmedByLine(prev => { const n = { ...prev }; delete n[cardIndex]; return n })
                    setManualPick(prev => { const n = { ...prev }; delete n[cardIndex]; return n })
                  }}
                  className="text-[10px] text-foreground-muted underline shrink-0 self-start"
                >
                  change
                </button>
              </div>
            </div>
          )
        })()}

        {/* Skipped — show undo option */}
        {isSkipped && (
          <div className="rounded-lg border border-dashed border-border-secondary bg-surface-secondary/50 p-3 flex items-center justify-between gap-2">
            <p className="text-xs text-foreground-muted">Skipped — will be added to quotation as a pending item</p>
            <button
              type="button"
              onClick={() => setSkippedLines(prev => { const n = { ...prev }; delete n[cardIndex]; return n })}
              className="text-xs text-accent-600 dark:text-accent-400 hover:underline shrink-0"
            >
              Undo
            </button>
          </div>
        )}

        {/* Active card (matched, ambiguous unresolved, or unmatched unresolved) */}
        {!isResolved && !isSkipped && (
          <div>
            {/* Candidate slider nav (ambiguous with multiple candidates, no manual pick) */}
            {isAmbiguous && !manPick && currentLine.candidates.length > 1 && (
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  disabled={cidx === 0}
                  onClick={() => setCandidateIndex(prev => ({ ...prev, [cardIndex]: cidx - 1 }))}
                  className="flex items-center gap-0.5 text-[10px] text-foreground-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronLeft className="w-3 h-3" /> Prev
                </button>
                <span className="text-[10px] text-foreground-muted">{cidx + 1} / {currentLine.candidates.length} matches</span>
                <button
                  type="button"
                  disabled={cidx >= currentLine.candidates.length - 1}
                  onClick={() => setCandidateIndex(prev => ({ ...prev, [cardIndex]: cidx + 1 }))}
                  className="flex items-center gap-0.5 text-[10px] text-foreground-muted hover:text-foreground disabled:opacity-30"
                >
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Product card — shown for matched/ambiguous when candidate exists */}
            {candidate ? (
              <div className={`rounded-lg border p-2 ${isMatched ? scoreBg((candidate as QuotationResolverCandidate).score ?? 0) : 'border-border-default'}`}>
                <div className="flex gap-2.5 mb-2">
                  {candidate.imageUrl
                    ? <img src={candidate.imageUrl} alt="" className="w-14 h-14 rounded object-cover shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    : <div className="w-14 h-14 rounded bg-surface-secondary flex items-center justify-center shrink-0"><Package className="w-6 h-6 text-foreground-muted" /></div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className="font-semibold text-foreground leading-snug text-sm">{candidate.name}</p>
                      {!manPick && (candidate as QuotationResolverCandidate).score != null && (
                        <span className={`font-bold tabular-nums shrink-0 text-sm ${scoreColor((candidate as QuotationResolverCandidate).score)}`}>
                          {(candidate as QuotationResolverCandidate).score}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-foreground-muted mt-0.5">
                      {displaySku || '—'} · ₹{displayPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {/* Variant selector */}
                {variants.length > 0 && (
                  <div className="mb-2">
                    <label className="block text-[10px] text-foreground-muted mb-1">Variant</label>
                    <AdminSelect
                      sm
                      value={selVariantId}
                      options={variants.map(v => ({
                        value: v.id,
                        label: `${v.name}${v.sku ? ` (${v.sku})` : ''} — ₹${v.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
                      }))}
                      onChange={val => {
                        setVariantSel(prev => ({ ...prev, [vKey]: val }))
                        setSubVariantSel(prev => { const n = { ...prev }; delete n[vKey]; return n })
                      }}
                    />
                  </div>
                )}

                {/* Sub-variant selector */}
                {subVariants.length > 0 && (
                  <div className="mb-2">
                    <label className="block text-[10px] text-foreground-muted mb-1">Sub-variant</label>
                    <AdminSelect
                      sm
                      value={selSubVariantId}
                      options={subVariants.map(sv => ({
                        value: sv.id,
                        label: `${sv.name}${sv.sku ? ` (${sv.sku})` : ''} — ₹${sv.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
                      }))}
                      onChange={val => setSubVariantSel(prev => ({ ...prev, [vKey]: val }))}
                    />
                  </div>
                )}

                {/* Use this / Skip this (non-matched lines) */}
                {!isMatched && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={useCurrentCandidate}
                      className="flex-1 py-1.5 rounded-md bg-accent-500 hover:bg-accent-600 text-white font-semibold text-xs"
                    >
                      Use this
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSkippedLines(prev => ({ ...prev, [cardIndex]: true }))
                        const next = lines.findIndex((l, i) =>
                          i > cardIndex && (l.status === 'ambiguous' || l.status === 'unmatched') && !confirmedByLine[i] && !skippedLines[i]
                        )
                        if (next >= 0) setCardIndex(next)
                        else if (cardIndex + 1 < lines.length) setCardIndex(cardIndex + 1)
                      }}
                      className="px-3 py-1.5 rounded-md border border-border-secondary text-foreground-muted hover:text-foreground hover:border-border-default text-xs font-medium"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Unmatched with no manual pick yet */
              <div className="rounded-lg border border-dashed border-border-default p-3 text-center text-foreground-muted">
                <XCircle className="w-5 h-5 mx-auto mb-1 text-red-400" />
                <p className="text-xs">No catalog match found</p>
                <p className="text-[10px] mt-0.5">Search below to add manually</p>
              </div>
            )}

            {/* Manual search toggle — available for all non-matched lines */}
            {!isMatched && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowSearch(prev => ({ ...prev, [cardIndex]: !prev[cardIndex] }))}
                  className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground"
                >
                  <Search className="w-3 h-3" />
                  {showSearch[cardIndex] ? 'Hide search' : (manPick ? 'Search different product' : 'Search product catalog')}
                </button>
                {showSearch[cardIndex] && (
                  <ProductSearchPicker onPick={handleManualPick} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}