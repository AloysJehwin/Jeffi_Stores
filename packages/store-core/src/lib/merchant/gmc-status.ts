import { sortClause, type SortDef } from '@jeffi/list-filters'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { listProducts } from './client'

// Advisory lock so two refreshes can't run concurrently (distinct from the sync lock).
const GMC_STATUS_LOCK_KEY = 84219574

export interface GmcStatusRow {
  offer_id: string
  title: string | null
  status: string | null
  item_group_id: string | null
  link: string | null
  price: string | null
  item_issues: any[]
  synced_at: string
}

export interface GmcSummary {
  last_refreshed_at: string | null
  total: number
  approved: number
  pending: number
  disapproved: number
}

// One overall status from a Merchant API productStatus: disapproved if any reporting context
// disapproves it in any country, else pending if any is pending, else approved.
function deriveStatus(status: any): string {
  const dests: any[] = status?.destinationStatuses || []
  const any = (key: string) => dests.some(d => (d[key] || []).length > 0)
  if (any('disapprovedCountries')) return 'disapproved'
  if (any('pendingCountries')) return 'pending'
  if (any('approvedCountries')) return 'approved'
  return 'unknown'
}

const SERVABILITY: Record<string, string> = {
  DISAPPROVED: 'disapproved',
  DEMOTED: 'demoted',
  NOT_IMPACTED: 'unaffected',
}

function formatPrice(p: any): string | null {
  const micros = Number(p?.amountMicros)
  return Number.isFinite(micros) && p?.amountMicros != null
    ? `${(micros / 1_000_000).toFixed(2)} ${p.currencyCode || ''}`.trim()
    : null
}

// Pull ALL processed products with their status (Merchant API products.list, paginated), upsert
// them into merchant_gmc_status, then recompute the aggregate meta row. Returns the fresh summary.
export async function refreshGmcStatusSnapshot(): Promise<GmcSummary | { locked: true }> {
  const lock = await queryOne<{ acquired: boolean }>(`SELECT pg_try_advisory_lock($1) AS acquired`, [
    GMC_STATUS_LOCK_KEY,
  ])
  if (!lock?.acquired) return { locked: true }

  try {
    const seen: string[] = []
    let pageToken: string | undefined
    do {
      const res = await listProducts(pageToken)
      for (const product of res.products || []) {
        const offerId = product.offerId || ''
        if (!offerId) continue
        const attrs = product.productAttributes || {}
        const ps = product.productStatus || {}
        const issues = (ps.itemLevelIssues || []).map((i: any) => ({
          code: i.code,
          severity: i.severity,
          servability: SERVABILITY[i.severity] || String(i.severity || '').toLowerCase(),
          description: i.description,
          detail: i.detail,
          attribute: i.attribute,
          resolution: i.resolution,
          documentation: i.documentation,
        }))
        await query(
          `INSERT INTO merchant_gmc_status
             (offer_id, title, status, item_group_id, link, price, destination_statuses, item_issues, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now())
           ON CONFLICT (offer_id) DO UPDATE SET
             title = EXCLUDED.title, status = EXCLUDED.status, item_group_id = EXCLUDED.item_group_id,
             link = EXCLUDED.link, price = EXCLUDED.price,
             destination_statuses = EXCLUDED.destination_statuses,
             item_issues = EXCLUDED.item_issues, synced_at = now()`,
          [
            offerId,
            attrs.title || null,
            deriveStatus(ps),
            attrs.itemGroupId || null,
            attrs.link || null,
            formatPrice(attrs.salePrice || attrs.price),
            JSON.stringify(ps.destinationStatuses || []),
            JSON.stringify(issues),
          ]
        )
        seen.push(offerId)
      }
      pageToken = res.nextPageToken
    } while (pageToken)

    // Drop rows no longer present in GMC (offers that were removed).
    if (seen.length > 0) {
      await query(`DELETE FROM merchant_gmc_status WHERE offer_id <> ALL($1::text[])`, [seen])
    }

    // Recompute meta counts from the table.
    const counts = await queryOne<{ total: number; approved: number; pending: number; disapproved: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'disapproved')::int AS disapproved
         FROM merchant_gmc_status`
    )
    await query(
      `INSERT INTO merchant_gmc_refresh_meta (key, last_refreshed_at, total, approved, pending, disapproved)
       VALUES ('default', now(), $1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         last_refreshed_at = now(), total = $1, approved = $2, pending = $3, disapproved = $4`,
      [counts?.total ?? 0, counts?.approved ?? 0, counts?.pending ?? 0, counts?.disapproved ?? 0]
    )
    return await getGmcSummary()
  } finally {
    await query(`SELECT pg_advisory_unlock($1)`, [GMC_STATUS_LOCK_KEY]).catch(() => {})
  }
}

export async function getGmcSummary(): Promise<GmcSummary> {
  const m = await queryOne<GmcSummary>(
    `SELECT last_refreshed_at, total, approved, pending, disapproved
       FROM merchant_gmc_refresh_meta WHERE key = 'default' LIMIT 1`
  )
  return m ?? { last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 }
}

export interface GmcPageParams {
  page: number
  pageSize: number
  search?: string
  status?: string
  /** ?sort&dir */
  sort?: { get(name: string): string | null }
}

const GMC_SORT: SortDef = {
  sorts: { offer: 'offer_id', title: 'title', status: 'status', issue: "item_issues->0->>'description'" },
  defaultSql: "(status = 'disapproved') DESC, (status = 'pending') DESC",
  tiebreak: 'offer_id',
}

export async function getGmcStatusPage(params: GmcPageParams): Promise<{ rows: GmcStatusRow[]; total: number }> {
  const page = Math.max(1, params.page || 1)
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 50))
  const where: string[] = []
  const args: any[] = []
  if (params.search) {
    args.push(`%${params.search}%`)
    where.push(`(offer_id ILIKE $${args.length} OR title ILIKE $${args.length})`)
  }
  if (params.status && params.status !== 'all') {
    args.push(params.status)
    where.push(`status = $${args.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const totalRow = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM merchant_gmc_status ${whereSql}`, args)
  const total = totalRow?.n ?? 0

  const limitArg = args.length + 1
  const offsetArg = args.length + 2
  const rows = await queryMany<GmcStatusRow>(
    `SELECT offer_id, title, status, item_group_id, link, price, item_issues, synced_at
       FROM merchant_gmc_status ${whereSql}
      ${sortClause(params.sort ?? new URLSearchParams(), GMC_SORT)}
      LIMIT $${limitArg} OFFSET $${offsetArg}`,
    [...args, pageSize, (page - 1) * pageSize]
  )
  return { rows, total }
}
