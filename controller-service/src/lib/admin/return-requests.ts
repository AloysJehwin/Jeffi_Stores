import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { queryMany } from '@/lib/shared/db'
import { REPLACEMENTS_ENTITY, RETURNS_ENTITY } from '@/lib/filters/entities/returns'

// One page of return / replacement requests: the list tab (bucket + history outcome), then the
// list's filters, newest first. `status=all|pending_approval|history` is the old bucket param.

const BUCKETS = ['all', 'pending_approval', 'history']
export const REQUESTS_PAGE_SIZE = 20

const ITEMS_JSON = `COALESCE(
  (SELECT json_agg(json_build_object(
    'id', rri.id,
    'order_item_id', rri.order_item_id,
    'product_id', rri.product_id,
    'variant_id', rri.variant_id,
    'quantity', rri.quantity,
    'unit_price', rri.unit_price,
    'refund_amount', rri.refund_amount,
    'product_name', rri.product_name,
    'variant_name', rri.variant_name
  ) ORDER BY rri.created_at)
  FROM return_request_items rri WHERE rri.return_request_id = rr.id),
  '[]'::json
)`

function bucketSql(bucket: string, outcome: string) {
  if (bucket === 'pending_approval') return `rr.status = 'pending_approval'`
  if (bucket === 'history') {
    if (outcome === 'approved') return `rr.status = 'completed'`
    if (outcome === 'rejected') return `rr.status = 'rejected'`
    return `rr.status IN ('completed', 'rejected')`
  }
  return `rr.status NOT IN ('rejected', 'completed')`
}

export async function listReturnRequests(type: 'refund' | 'replacement', searchParams: URLSearchParams) {
  const entity = type === 'refund' ? RETURNS_ENTITY : REPLACEMENTS_ENTITY
  const sp = new URLSearchParams(searchParams)
  const legacy = !sp.get('bucket') && BUCKETS.includes(sp.get('status') || '')
  const bucket = sp.get('bucket') || (legacy ? sp.get('status') : null) || 'all'
  if (legacy) sp.delete('status')
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '', 10) || REQUESTS_PAGE_SIZE))
  const offset = (page - 1) * limit

  const w = buildWhere(entity, normalizeQuery(entity, sp), 1, { base: false })
  const filters = w.conditions.map(c => ` AND ${c}`).join('')
  const replacement = type === 'replacement'

  const rows = await queryMany<Record<string, unknown>>(
    `WITH pg AS (
       SELECT rr.id, rr.created_at, COUNT(*) OVER () AS total_count
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       WHERE rr.type = '${type}'
         AND ${bucketSql(bucket, sp.get('filter') || 'all')}${filters}
       ORDER BY rr.created_at DESC, rr.id DESC
       LIMIT ${limit} OFFSET ${offset}
     )
     SELECT
       rr.id, rr.order_id, rr.type, rr.status, rr.reason, rr.description,
       rr.admin_notes, rr.return_tracking_number, rr.rvp_awb_number, rr.rvp_created_at,
       rr.received_at, rr.image_urls, rr.valuation_status, rr.valuation_condition,
       rr.valuation_notes, rr.valuated_at, rr.created_at,${replacement ? ' rr.replacement_order_id,' : ''}
       o.order_number, o.customer_name, o.customer_email, o.total_amount,
       u.first_name, u.last_name, u.email AS user_email,${replacement ? '\n       repl.order_number AS replacement_order_number,' : ''}
       ${ITEMS_JSON} AS items,
       pg.total_count
     FROM pg
     JOIN return_requests rr ON rr.id = pg.id
     JOIN orders o ON o.id = rr.order_id
     LEFT JOIN users u ON u.id = rr.user_id${replacement ? '\n     LEFT JOIN orders repl ON repl.id = rr.replacement_order_id' : ''}
     ORDER BY pg.created_at DESC, rr.id DESC`,
    w.params
  )
  const list = (rows ?? []).map(r => {
    const { total_count, ...rest } = r
    void total_count
    return rest
  })
  const t = rows?.[0]?.total_count
  const total = t != null ? Number(t) : page === 1 ? list.length : null
  return { rows: list, total, page, limit, hasMore: total != null && offset + list.length < total }
}
