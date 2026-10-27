import { buildWhere, sortClause, type FilterQuery, type SortDef } from '@jeffi/list-filters'
import { queryCount, queryMany, queryOne } from '@/lib/shared/db'
import { B2B_ENTITY } from '@/lib/filters/entities/business-customers'

// The Business customers list and its approval cards, over the list's filters.

export interface BusinessCustomerRow {
  user_id: string
  email: string
  first_name: string
  last_name: string | null
  phone: string | null
  company_name: string
  gst_number: string
  industry: string
  approval_status: string
  created_at: string
  approved_at: string | null
}

const FROM = 'FROM business_profiles bp JOIN users u ON u.id = bp.user_id'

const SORT: SortDef = {
  sorts: {
    company: 'bp.company_name',
    contact: "concat_ws(' ', u.first_name, u.last_name)",
    gst: 'bp.gst_number',
    industry: 'bp.industry',
    status: 'bp.approval_status',
    created_at: 'bp.created_at',
  },
  defaultSql: 'bp.created_at DESC',
  tiebreak: 'bp.id DESC',
}

export async function listBusinessCustomers(q: FilterQuery, page: number, pageSize: number, sort?: { get(name: string): string | null }) {
  const w = buildWhere(B2B_ENTITY, q)
  const [rows, total] = await Promise.all([
    queryMany<BusinessCustomerRow>(
      `SELECT u.id AS user_id, u.email, u.first_name, u.last_name, u.phone,
              bp.company_name, bp.gst_number, bp.industry, bp.approval_status,
              bp.created_at, bp.approved_at
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

/** Accounts per approval state over the other filters, so each card shows what picking it lists. */
export async function getBusinessCustomerCounts(q: FilterQuery) {
  const w = buildWhere(B2B_ENTITY, q, 1, { omit: ['approval'] })
  const r = await queryOne<Record<string, string>>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE bp.approval_status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE bp.approval_status = 'approved') AS approved,
            COUNT(*) FILTER (WHERE bp.approval_status = 'rejected') AS rejected
     ${FROM} ${w.where}`,
    w.params
  )
  const n = (v: unknown) => Number(v ?? 0) || 0
  return { all: n(r?.total), pending: n(r?.pending), approved: n(r?.approved), rejected: n(r?.rejected) }
}
