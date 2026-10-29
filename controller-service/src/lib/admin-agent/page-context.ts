import 'server-only'
import { VALUE_SEPARATOR, normalizeQuery, type FilterEntity, type FilterQuery } from '@jeffi/list-filters'
import { getEntity } from '@/lib/filters/registry'
import type { PageContext } from './conversations'

// What the admin's page tells the agent: the record they are on and the tools that change it, or the
// list they are looking at with its filters, so "this" and "these" resolve.

export const MAX_PROPOSALS_PER_TURN = 25

const PAGE_KINDS = new Set(['product', 'order', 'customer', 'invoice', 'quotation', 'coupon', 'supplier', 'rfq', 'category', 'brand', 'campaign'])

// Tools that read or change a record of each kind; the propose_ ones (and mark_order_shipped) change it.
const TOOLS_FOR_KIND: Record<string, string[]> = {
  order: [
    'get_order',
    'propose_update_order_status',
    'mark_order_shipped',
    'propose_set_payment_status',
    'propose_mark_invoice_paid',
    'propose_cancel_order',
    'get_order_refund_options',
    'propose_refund_order',
  ],
  product: ['get_product_full', 'propose_update_product', 'propose_adjust_inventory', 'propose_set_product_featured'],
  customer: [
    'get_customer',
    'get_customer_notes',
    'get_customer_tasks',
    'get_customer_tags',
    'propose_add_customer_note',
    'propose_add_customer_tag',
    'propose_remove_customer_tag',
    'propose_create_customer_task',
    'propose_close_customer_task',
    'propose_toggle_marketing_opt_out',
  ],
  quotation: ['get_quotation', 'propose_send_quotation_email'],
  invoice: ['get_invoice'],
  coupon: ['get_coupon'],
  brand: ['get_brand'],
  category: ['get_category'],
  campaign: ['get_campaign', 'propose_update_campaign_template'],
}

// Admin list pages: their filter list and the kind of record each row is.
const LISTS: Record<string, { list: string; kind?: string }> = {
  '/admin/orders': { list: 'orders', kind: 'order' },
  '/admin/products': { list: 'products', kind: 'product' },
  '/admin/customers': { list: 'customers', kind: 'customer' },
  '/admin/coupons': { list: 'coupons', kind: 'coupon' },
  '/admin/invoices': { list: 'invoices', kind: 'invoice' },
  '/admin/quotations': { list: 'quotations', kind: 'quotation' },
  '/admin/brands': { list: 'brands', kind: 'brand' },
  '/admin/categories': { list: 'categories', kind: 'category' },
  '/admin/returns': { list: 'returns' },
  '/admin/replacements': { list: 'replacements' },
  '/admin/subscriptions': { list: 'subscriptions' },
  '/admin/suppliers': { list: 'suppliers' },
  '/admin/tasks': { list: 'tasks' },
  '/admin/reviews': { list: 'reviews' },
  '/admin/packing-slips': { list: 'packing_slips' },
  '/admin/cash-sale': { list: 'cash_sale' },
  '/admin/business/rfqs': { list: 'business_rfqs' },
  '/admin/business/customers': { list: 'business_customers' },
}

const isChange = (tool: string) => tool.startsWith('propose_') || tool === 'mark_order_shipped'

export function cleanPageContext(pc: unknown): PageContext | null {
  if (!pc || typeof pc !== 'object') return null
  const { path, section, entity, query } = pc as PageContext
  const out: PageContext = {}
  if (typeof path === 'string' && /^\/admin(\/[\w\-./]*)?$/.test(path) && path.length <= 200) out.path = path
  if (typeof section === 'string' && /^[\w\- ]{1,60}$/.test(section)) out.section = section
  if (entity && PAGE_KINDS.has(entity.kind) && typeof entity.id === 'string' && /^[\w-]{1,64}$/.test(entity.id)) {
    out.entity = { kind: entity.kind, id: entity.id }
  }
  if (typeof query === 'string' && query.length <= 1000 && !/[\s<>]/.test(query)) out.query = query.replace(/^\?/, '')
  return out.path || out.entity ? out : null
}

/** The filter list the page shows, with its filters as the list itself reads them. */
function pageList(pc: PageContext) {
  const def = !pc.entity && pc.path ? LISTS[pc.path] : undefined
  const entity = def && getEntity(def.list)
  if (!def || !entity) return null
  return { key: def.list, kind: def.kind, entity, q: normalizeQuery(entity, new URLSearchParams(pc.query ?? '')) }
}

function describeFilters(entity: FilterEntity, q: FilterQuery): string[] {
  return Object.entries(q).map(([param, value]) => {
    const field = (entity.fields ?? []).find(f => (Array.isArray(f.name) ? f.name : [f.name]).includes(param))
    if (!field) return `${param === 'search' ? 'search' : param}: ${value}`
    const label = Array.isArray(field.name) ? `${field.label} ${param === field.name[0] ? 'from' : 'to'}` : field.label
    const shown = value
      .split(VALUE_SEPARATOR)
      .map(v => field.options?.find(o => o.value === v)?.label ?? v)
      .join(', ')
    return `${label}: ${shown}`
  })
}

/** Tools worth offering on this page when only a subset is sent (local model). */
export function pageTools(pc: PageContext | null): string[] {
  if (!pc) return []
  if (pc.entity) return TOOLS_FOR_KIND[pc.entity.kind] ?? []
  const list = pageList(pc)
  return list ? ['get_page_rows', ...(list.kind ? TOOLS_FOR_KIND[list.kind] ?? [] : [])] : []
}

export function pageContextNote(pc: PageContext | null): string {
  if (!pc) return ''
  const lines: string[] = []
  const list = pageList(pc)
  if (pc.entity) {
    const { kind, id } = pc.entity
    lines.push(`The admin is viewing the ${kind} ${id}${pc.path ? ` (${pc.path})` : ''}. "This" or "here" refers to it unless they say otherwise.`)
    const changes = (TOOLS_FOR_KIND[kind] ?? []).filter(isChange)
    if (changes.length) lines.push(`To change it, use ${changes.join(', ')} with this id; each change waits for the admin's approval.`)
  } else if (list) {
    const filters = describeFilters(list.entity, list.q)
    lines.push(
      `The admin is on the ${list.entity.noun} list (${pc.path})${filters.length ? `, filtered by ${filters.join('; ')}` : ', unfiltered'}. "These" or "this list" means the rows it shows.`
    )
    lines.push(
      `To read or act on them, call get_page_rows with list="${list.key}" and query="${new URLSearchParams(list.q).toString()}", then propose one change per row (at most ${MAX_PROPOSALS_PER_TURN} per answer; ask the admin to narrow the list beyond that).`
    )
  } else {
    lines.push(`The admin is viewing ${pc.section || 'the page'} (${pc.path}).`)
  }
  return `\n\n<page_context>${lines.join(' ')}</page_context>`
}
