import { queryMany } from '@/lib/shared/db'

// A record's change log, read from admin_audit_log: rows the audit trigger writes (table names, with
// field diffs) and rows routes write with logAdminAudit (singular names, with a summary), plus rows of
// its child tables, which carry metadata.parent_id.

interface ChangeKind {
  scope: string
  /** entity_type values whose entity_id is the record's id */
  types: string[]
  /** child tables whose metadata.parent_id is the record's id → their label */
  children?: Record<string, string>
}

export const CHANGE_LOG_KINDS: Record<string, ChangeKind> = {
  order: { scope: 'orders:read', types: ['orders', 'order'], children: { order_items: 'Item', invoices: 'Invoice' } },
  // Invoices are orders; the invoice page's id is the order's.
  invoice: { scope: 'invoices:read', types: ['orders', 'order', 'invoice'], children: { order_items: 'Item', invoices: 'Invoice' } },
  cash_sale: { scope: 'invoices:read', types: ['cash_sales', 'cash_sale'], children: { cash_sale_items: 'Item', invoices: 'Invoice' } },
  quotation: { scope: 'quotations:read', types: ['quotations', 'quotation'], children: { quotation_items: 'Line item' } },
  product: {
    scope: 'products:read',
    types: ['products', 'product', 'inventory'],
    children: {
      product_variants: 'Variant',
      product_sub_variants: 'Sub-variant',
      product_images: 'Image',
      variant_images: 'Variant image',
      shelf_stock: 'Shelf stock',
    },
  },
  customer: {
    scope: 'customers:read',
    types: ['users', 'customer'],
    children: { customer_profiles: 'Company details', business_profiles: 'Business account' },
  },
  business_customer: {
    scope: 'business_customers:read',
    types: ['users', 'business_user', 'customer'],
    children: { business_profiles: 'Business account', business_discounts: 'Category discount', customer_profiles: 'Company details' },
  },
  rfq: { scope: 'business_rfqs:read', types: ['business_rfqs', 'rfq'] },
  subscription: { scope: 'subscriptions:read', types: ['subscriptions', 'subscription'] },
  coupon: { scope: 'coupons:read', types: ['coupons', 'coupon'] },
  offer: { scope: 'coupons:read', types: ['product_offers', 'offer'] },
  brand: { scope: 'brands:read', types: ['brands', 'brand'] },
  category: { scope: 'categories:read', types: ['categories', 'category'] },
  supplier: { scope: 'inventory:read', types: ['suppliers', 'supplier'] },
  review_form: { scope: 'review_forms:read', types: ['review_forms', 'review_form'] },
  campaign: { scope: 'campaigns:read', types: ['campaigns', 'campaign'] },
  email_campaign: { scope: 'mailer:read', types: ['email_campaigns'] },
  payable: { scope: 'financial:read', types: ['expenses', 'expense'], children: { expense_payments: 'Payment' } },
  purchase_order: { scope: 'inventory:read', types: ['purchase_orders', 'purchase_order'], children: { purchase_order_items: 'Item' } },
  grn: { scope: 'inventory:read', types: ['grns', 'grn'], children: { grn_items: 'Item' } },
}

// Draft locks and sign-ins are about the editor, not the record.
const NOT_CHANGES = ['lock', 'unlock', 'handover', 'takeover', 'request_access', 'export', 'login', 'logout']
// Columns that change as a side effect (image placeholders, search indexes), not edits worth reading.
const NOISE = /^(blurhash.*|.*_hash|search_vector|embedding.*|.*_tsv)$/
const GROUP_GAP_MS = 5_000
const MAX_ROWS = 100

export interface FieldChange {
  field: string
  from: unknown
  to: unknown
  fromLabel?: string
  toLabel?: string
}

export interface ChangePart {
  entityType: string
  entityId: string
  action: string
  /** set when the row is a child (an order's item, a product's variant) */
  child?: { label: string; name: string | null }
  changes: FieldChange[]
  image?: string | null
}

export interface ChangeActor {
  kind: 'admin' | 'customer' | 'source' | 'system'
  name: string
}

export interface ChangeItem {
  id: string
  at: string
  actor: ChangeActor
  /** what a route said it did ("Refund of ₹500 recorded"), when one did */
  summary: string | null
  parts: ChangePart[]
  ip?: string | null
}

export interface ChangeLogPage {
  items: ChangeItem[]
  next: string | null
}

interface Row {
  id: string
  admin_id: string | null
  action: string
  entity_type: string
  entity_id: string
  summary: string | null
  diff: Record<string, { from: unknown; to: unknown; fromLabel?: string; toLabel?: string }> | null
  metadata: Record<string, any> | null
  ip: string | null
  created_at: Date
  /** exact timestamp for the cursor (a Date drops the microseconds) */
  at_raw: string
  admin_name: string | null
  customer_name: string | null
}

const SOURCES: Record<string, string> = {
  razorpay: 'Razorpay',
  delhivery: 'Delhivery',
  cron: 'Scheduled job',
  assistant: 'Assistant',
}

function actorOf(r: Row): ChangeActor {
  if (r.admin_id) return { kind: 'admin', name: r.admin_name || 'An admin' }
  const actor = typeof r.metadata?.actor === 'string' ? r.metadata.actor : ''
  if (actor.startsWith('customer:')) return { kind: 'customer', name: r.customer_name || 'Customer' }
  if (SOURCES[actor]) return { kind: 'source', name: SOURCES[actor] }
  if (actor.startsWith('service:')) return { kind: 'source', name: actor.slice(8) }
  return { kind: 'system', name: 'System' }
}

const actorKey = (r: Row) => r.admin_id ?? r.metadata?.actor ?? 'system'

/** One save is several rows (the order + its items, the trigger row + the route's own row): one item. */
function group(rows: Row[], kind: ChangeKind, parentTypes: Set<string>, withIp: boolean): ChangeItem[] {
  const items: ChangeItem[] = []
  let last: { item: ChangeItem; key: string; at: number } | null = null
  for (const r of rows) {
    const at = new Date(r.created_at).getTime()
    const key = actorKey(r)
    const isChild = !parentTypes.has(r.entity_type)
    const childLabel = isChild ? (kind.children?.[r.entity_type] ?? r.entity_type) : null
    const auto = !!r.metadata?.auto
    const diff = Object.entries(r.diff ?? {}).filter(([field]) => !NOISE.test(field))
    // An update whose only changes were noise says nothing.
    if (r.action === 'update' && r.diff && !diff.length && r.metadata?.auto) continue
    const changes: FieldChange[] = diff.map(([field, v]) => ({
      field,
      from: v?.from ?? null,
      to: v?.to ?? null,
      ...(v?.fromLabel ? { fromLabel: v.fromLabel } : {}),
      ...(v?.toLabel ? { toLabel: v.toLabel } : {}),
    }))
    const part: ChangePart = {
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      ...(childLabel ? { child: { label: childLabel, name: r.summary?.match(/"([^"]*)"/)?.[1] ?? null } } : {}),
      changes,
      ...(r.metadata?.thumbnail_url ? { image: r.metadata.thumbnail_url } : {}),
    }
    if (last && last.key === key && last.at - at <= GROUP_GAP_MS && last.item.parts.length < 50) {
      const same = last.item.parts.find(p => p.entityType === part.entityType && p.entityId === part.entityId && p.action === part.action)
      if (same) {
        for (const c of changes) if (!same.changes.some(x => x.field === c.field)) same.changes.push(c)
      } else last.item.parts.push(part)
      if (!auto && r.summary) last.item.summary = r.summary
      if (withIp && !last.item.ip && r.ip) last.item.ip = r.ip
      last.at = at
      continue
    }
    const item: ChangeItem = {
      id: r.id,
      at: new Date(r.created_at).toISOString(),
      actor: actorOf(r),
      summary: auto ? null : r.summary,
      parts: [part],
      ...(withIp ? { ip: r.ip } : {}),
    }
    items.push(item)
    last = { item, key, at }
  }
  // Explicit rows with nothing else to say are their summary; keep the part list to real changes.
  for (const item of items) {
    item.parts.sort((a, b) => Number(!!a.child) - Number(!!b.child))
    if (item.summary) item.parts = item.parts.filter(p => p.changes.length || p.child || p.action === 'create' || p.action === 'delete')
  }
  return items
}

const encodeCursor = (r: Row) => Buffer.from(`${r.at_raw}|${r.id}`).toString('base64url')
function decodeCursor(c?: string | null): [string, string] | null {
  if (!c) return null
  const [at, id] = Buffer.from(c, 'base64url').toString().split('|')
  return /^\d{4}-\d\d-\d\d[ T][\d:.]+([+-]\d\d(:?\d\d)?|Z)?$/.test(at ?? '') && /^[0-9a-f-]{36}$/i.test(id ?? '') ? [at, id] : null
}

export async function getChangeLog(
  kindKey: string,
  id: string,
  opts: { fields?: string[]; before?: string | null; limit?: number; withIp?: boolean } = {}
): Promise<ChangeLogPage> {
  const kind = CHANGE_LOG_KINDS[kindKey]
  if (!kind || !id) return { items: [], next: null }
  const limit = Math.min(MAX_ROWS, Math.max(1, opts.limit ?? 30))
  const cursor = decodeCursor(opts.before)
  const fields = opts.fields?.filter(f => /^[a-z_]{1,60}$/.test(f)) ?? []
  const children = Object.keys(kind.children ?? {})
  const params: unknown[] = [kind.types, id, children, NOT_CHANGES, fields.length ? fields : null]
  const where = `((l.entity_type = ANY($1) AND l.entity_id = $2)
          OR (l.entity_type = ANY($3) AND l.metadata ? 'parent_id' AND l.metadata->>'parent_id' = $2))
         AND l.action <> ALL($4)
         AND ($5::text[] IS NULL OR l.diff ?| $5 OR (l.action = 'create' AND l.entity_type = ANY($1)))`
  const page = cursor ? ` AND (l.created_at, l.id) < ($6::timestamptz, $7::uuid)` : ''
  const rows = await queryMany<Row>(
    `SELECT l.id::text, l.admin_id::text, l.action, l.entity_type, l.entity_id, l.summary, l.diff, l.metadata,
            l.ip_address::text AS ip, l.created_at, l.created_at::text AS at_raw,
            COALESCE(NULLIF(btrim(concat_ws(' ', au.first_name, au.last_name)), ''), au.email) AS admin_name,
            COALESCE(NULLIF(btrim(concat_ws(' ', cu.first_name, cu.last_name)), ''), cu.email, cu.phone) AS customer_name
       FROM admin_audit_log l
       LEFT JOIN admins a ON a.id = l.admin_id
       LEFT JOIN users au ON au.id = a.user_id
       LEFT JOIN users cu ON l.admin_id IS NULL
            AND cu.id = CASE WHEN l.metadata->>'actor' ~ '^customer:[0-9a-f-]{36}$' THEN substr(l.metadata->>'actor', 10)::uuid END
      WHERE ${where}${page}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${limit + 1}`,
    cursor ? [...params, ...cursor] : params
  )
  const more = rows.length > limit
  const shown = more ? rows.slice(0, limit) : rows
  return {
    items: group(shown, kind, new Set(kind.types), !!opts.withIp),
    next: more ? encodeCursor(shown[shown.length - 1]) : null,
  }
}
