import { ap } from '@/lib/shared/admin-path'
import type { Tone } from '../kit/tones'

// Formatting shared by the agent's ui blocks.

const INR_FORMATTER = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const QTY_FORMATTER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 })

export function parseNumber(input: unknown): number | null {
  if (input == null) return null
  if (typeof input === 'number') return isFinite(input) ? input : null
  const cleaned = String(input)
    .replace(/[₹,\s]/g, '')
    .trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return isFinite(n) ? n : null
}

export function fmtINR(input: unknown, fallback = '—'): string {
  const n = parseNumber(input)
  if (n == null) return fallback
  return `₹${INR_FORMATTER.format(n)}`
}

/** 5, 2.5, 1,200 — no trailing zeros. */
export function fmtQty(input: unknown, fallback = '—'): string {
  const n = parseNumber(input)
  return n == null ? fallback : QTY_FORMATTER.format(n)
}

export const fmtPct = (n: number) => `${QTY_FORMATTER.format(n)}%`

export const adminHref = (href: string) => (href.startsWith('/admin') ? ap(href) : href)

export const humanizeKind = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '')

export const arr = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : [])

export type BlockTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger'

export const KIT_TONE: Record<BlockTone, Tone> = {
  neutral: 'muted',
  info: 'blue',
  success: 'green',
  warn: 'amber',
  danger: 'red',
}

export const TEXT_TONE: Record<BlockTone, string> = {
  neutral: 'text-foreground',
  info: 'text-blue-700 dark:text-blue-400',
  success: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
}

export const toneOf = (t: unknown): BlockTone => (typeof t === 'string' && t in KIT_TONE ? (t as BlockTone) : 'neutral')

export const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  product: id => `/admin/products/${id}`,
  order: id => `/admin/orders/${id}/view`,
  customer: id => `/admin/customers/${id}/view`,
  invoice: id => `/admin/invoices/${id}/view`,
  quotation: id => `/admin/quotations/${id}/view`,
  coupon: id => `/admin/coupons/${id}/view`,
  supplier: id => `/admin/suppliers/${id}/view`,
  rfq: id => `/admin/business/rfqs/${id}/view`,
  category: id => `/admin/categories/${id}/view`,
  brand: id => `/admin/brands/${id}/view`,
  campaign: kind => `/admin/campaigns/${kind}`,
}

/** A link a block may carry: an entity ref, an app path, or an https URL; anything else is dropped. */
export function safeHref(href: unknown, entity?: { kind?: unknown; id?: unknown } | null): string | null {
  if (entity && typeof entity.kind === 'string' && typeof entity.id === 'string' && entity.id.trim()) {
    const route = ENTITY_ROUTES[entity.kind]
    if (route) return adminHref(route(encodeURIComponent(entity.id.trim())))
  }
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/\\')) return adminHref(h)
  return /^https:\/\//i.test(h) ? h : null
}
