import 'server-only'
import { getProductAnalyticsData } from '@/lib/shared/admin-product-analytics'
import { SUBMISSION_STATUSES, listFormSubmissions, reviewFormMeta } from '@/lib/review-forms/submissions'
import { ExportError } from '../pipeline'
import { defineExport, type ExportDefinition, type ExportRunContext, type ExportSection } from '../define'
import { narrowed, type ExportColumn, type ExportFilter } from '../types'

// Catalog reports outside the filter registry: one product's analytics, one review form's submissions.
// The page passes the record in its query (product=<id>, form=<id>), plus its own range/status.

const UUID = /^[0-9a-f-]{36}$/i

function recordId(ctx: ExportRunContext, param: string): string {
  const id = ctx.query.get(param) ?? ''
  if (!UUID.test(id)) throw new ExportError('Open the record to export it.')
  return id
}

const days = (ctx: ExportRunContext) => Math.min(Math.max(parseInt(ctx.query.get('days') || '30', 10) || 30, 1), 365)

const ANALYTICS_TABLES: ExportFilter = {
  key: 'tables',
  label: 'Tables',
  kind: 'multi',
  options: [
    { value: 'traffic', label: 'Daily traffic' },
    { value: 'referrers', label: 'Top referrers' },
    { value: 'variants', label: 'Variant breakdown' },
    { value: 'buyers', label: 'Recent buyers' },
  ],
}

const TRAFFIC_COLS: ExportColumn[] = [
  { key: 'date', label: 'Date', type: 'date', id: true },
  { key: 'views', label: 'Views', type: 'int', total: 'sum' },
  { key: 'carts', label: 'Cart adds', type: 'int', total: 'sum' },
  { key: 'orders', label: 'Orders', type: 'int', total: 'sum' },
]

export const PRODUCT_ANALYTICS_EXPORT = defineExport({
  key: 'products.analytics',
  title: 'Product analytics',
  noun: 'Days',
  scope: 'products:read',
  columns: TRAFFIC_COLS,
  filters: [ANALYTICS_TABLES],
  scopes: ['filtered'],
  period: ctx => `Last ${days(ctx)} days`,
  filename: ctx => `product-analytics-${ctx.query.get('product')?.slice(0, 8) ?? 'product'}-${days(ctx)}d`,
  sections: async ctx => {
    const data = await getProductAnalyticsData(recordId(ctx, 'product'), days(ctx))
    if (!data) throw new ExportError('Product not found', 404)
    const want = narrowed(ANALYTICS_TABLES, ctx.filters)
    const has = (k: string) => !want || want.includes(k)
    const t = data.totals
    const out: ExportSection[] = []
    if (has('traffic')) out.push({ key: 'traffic', title: `${data.product.name} — daily traffic`, rows: data.timeSeries })
    if (has('referrers'))
      out.push({ key: 'referrers', title: 'Top referrers', columns: [{ key: 'referrer', label: 'Referrer', id: true, width: 2 }, { key: 'sessions', label: 'Sessions', type: 'int', total: 'sum' }], rows: data.referrers })
    if (has('variants'))
      out.push({
        key: 'variants',
        title: 'Variant breakdown',
        columns: [
          { key: 'variantName', label: 'Variant', id: true, width: 1.6 },
          { key: 'orders', label: 'Orders', type: 'int', total: 'sum' },
          { key: 'quantity', label: 'Units', type: 'number', total: 'sum' },
          { key: 'revenue', label: 'Revenue', type: 'money', total: 'sum' },
        ],
        rows: data.variantBreakdown.map(v => ({ ...v, variantName: v.variantName ?? 'Base product' })),
      })
    if (has('buyers'))
      out.push({
        key: 'buyers',
        title: 'Recent buyers',
        columns: [
          { key: 'orderNumber', label: 'Order no', id: true },
          { key: 'createdAt', label: 'Date', type: 'datetime', id: true },
          { key: 'customerName', label: 'Customer', width: 1.5 },
          { key: 'quantity', label: 'Units', type: 'number', total: 'sum' },
          { key: 'total', label: 'Total', type: 'money', total: 'sum' },
        ],
        rows: data.recentBuyers,
      })
    if (!out.length) out.push({ key: 'none', rows: [], totals: null })
    out[out.length - 1].summary = [
      { label: 'Product', value: `${data.product.name} (${data.product.sku})` },
      { label: 'Views', value: t.views, type: 'int' },
      { label: 'Unique viewers', value: t.uniqueViewers, type: 'int' },
      { label: 'Cart adds', value: t.cartAdds, type: 'int' },
      { label: 'Orders', value: t.orders, type: 'int' },
      { label: 'Units sold', value: t.quantitySold, type: 'number' },
      { label: 'Revenue', value: t.revenue, type: 'money' },
      { label: 'Conversion (views → orders)', value: t.conversionRate, type: 'percent' },
      { label: 'Cart conversion', value: t.cartConversionRate, type: 'percent' },
      { label: 'Revenue per view', value: t.revenuePerView, type: 'money' },
    ]
    return out
  },
})

const SUBMISSION_STATUS: ExportFilter = {
  key: 'status',
  label: 'Statuses',
  kind: 'multi',
  options: SUBMISSION_STATUSES.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
}

export const FORM_SUBMISSIONS_EXPORT = defineExport({
  key: 'review-forms.submissions',
  title: 'Review form submissions',
  noun: 'Submissions',
  scope: 'review_forms:read',
  columns: [
    { key: 'submitted_at', label: 'Submitted', type: 'datetime', id: true },
    { key: 'email', label: 'Email', id: true, width: 1.6 },
    { key: 'status', label: 'Status' },
    { key: 'coupon_code', label: 'Coupon' },
    { key: 'screenshot_url', label: 'Screenshot', optional: true, width: 2 },
  ],
  filters: [SUBMISSION_STATUS],
  scopes: ['filtered'],
  count: async ctx => {
    const picked = narrowed(SUBMISSION_STATUS, ctx.filters)
    const id = recordId(ctx, 'form')
    if (picked && !picked.length) return 0
    const statuses = picked ?? [null]
    let n = 0
    for (const s of statuses) n += (await listFormSubmissions(id, { status: s, limit: 1, offset: 0 })).total
    return n
  },
  sections: async ctx => {
    const id = recordId(ctx, 'form')
    const meta = await reviewFormMeta(id)
    if (!meta) throw new ExportError('Review form not found', 404)
    const picked = narrowed(SUBMISSION_STATUS, ctx.filters)
    const fields = (meta.custom_fields ?? []).filter(f => f.type !== 'image')
    const byKey = new Map(FORM_SUBMISSIONS_EXPORT.columns.map(c => [c.key, c]))
    // The form's own questions follow the picked columns, one column each.
    const columns: ExportColumn[] = [
      ...ctx.options.columns.map(k => byKey.get(k)!).filter(Boolean),
      ...fields.map(f => ({ key: `field:${f.id}`, label: f.label, type: f.type === 'rating' ? ('int' as const) : ('text' as const), width: f.type === 'textarea' ? 2 : 1.2 })),
    ]
    async function* rows() {
      for (const s of picked ?? [null]) {
        for (let offset = 0; offset < ctx.cap; offset += 1000) {
          const { submissions } = await listFormSubmissions(id, { status: s, limit: 1000, offset })
          yield submissions.map(r => ({ ...r, ...Object.fromEntries(fields.map(f => [`field:${f.id}`, r.extra_fields?.[f.id] ?? ''])) }))
          if (submissions.length < 1000) break
        }
      }
    }
    return [{ key: 'submissions', title: meta.title, columns, rows: picked && !picked.length ? [] : rows(), totals: null }]
  },
})

export const CATALOG_EXPORTS: ExportDefinition[] = [PRODUCT_ANALYTICS_EXPORT, FORM_SUBMISSIONS_EXPORT]
