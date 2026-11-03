import { buildWhere, filterScope, sortClause, type FilterQuery, type SortDef } from '@jeffi/list-filters'
import { queryCount, queryMany } from '@/lib/shared/db'
import { RFQ_ENTITY, RFQ_ITEMS_SQL } from '@/lib/filters/entities/business-rfqs'

// The Business RFQs list, its status tiles and its 12-month trend, all over the list's filters.

export interface RfqRow {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  item_count: string
  created_at: string
  company_name: string | null
  first_name: string
  last_name: string | null
  email: string
}

const FROM = `FROM business_rfqs r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN business_profiles bp ON bp.user_id = r.user_id`

const SORT: SortDef = {
  sorts: {
    rfq: 'r.rfq_number',
    company: 'bp.company_name',
    contact: "concat_ws(' ', u.first_name, u.last_name)",
    items: RFQ_ITEMS_SQL,
    status: 'r.status',
    created_at: 'r.created_at',
  },
  defaultSql: 'r.created_at DESC',
  tiebreak: 'r.id DESC',
}

export async function listBusinessRfqs(q: FilterQuery, page: number, pageSize: number, sort?: { get(name: string): string | null }) {
  const w = buildWhere(RFQ_ENTITY, q)
  const [rows, total] = await Promise.all([
    queryMany<RfqRow>(
      `SELECT r.id, r.rfq_number, r.status, r.notes, r.created_at,
              ${RFQ_ITEMS_SQL}::text AS item_count,
              bp.company_name, u.first_name, u.last_name, u.email
       ${FROM}
       ${w.where}
       ${sortClause(sort ?? new URLSearchParams(), SORT)}
       LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`,
      [...w.params, pageSize, (Math.max(1, page) - 1) * pageSize]
    ),
    queryCount(`SELECT COUNT(*) AS count ${FROM} ${w.where}`, w.params),
  ])
  return { rows, total }
}

/** RFQs per status over the filters. */
export async function getRfqStatusCounts(q: FilterQuery): Promise<Record<string, number>> {
  const w = buildWhere(RFQ_ENTITY, q)
  const rows = await queryMany<{ status: string; count: string }>(
    `SELECT r.status, COUNT(*)::text AS count FROM business_rfqs r ${w.where} GROUP BY 1`,
    w.params
  )
  return Object.fromEntries(rows.map(r => [r.status, parseInt(r.count, 10) || 0]))
}

/** RFQs per month for the last 12 months; the filters apply, the list's date does not. */
export async function getRfqMonthly(q: FilterQuery) {
  const s = filterScope(RFQ_ENTITY, q, { omit: ['created'] }).and(1)
  return queryMany<{ month: string; count: string }>(
    `SELECT to_char(date_trunc('month', r.created_at), 'YYYY-MM') AS month, COUNT(*)::text AS count
     FROM business_rfqs r
     WHERE r.created_at >= date_trunc('month', now()) - interval '11 months'${s.sql}
     GROUP BY 1
     ORDER BY 1`,
    s.params
  )
}
