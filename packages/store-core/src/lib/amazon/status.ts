import { buildWhere, hasFilters, normalizeQuery, sortClause, type FilterQuery, type SortDef } from '@jeffi/list-filters'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { AMAZON_LISTINGS_ENTITY } from '@/lib/filters/entities/amazon-listings'
import { searchListingsItems } from './client'
import { recordAmazonQuantities } from './stock'

// Amazon listing-status snapshot — analog of src/lib/merchant/gmc-status.ts.
// Advisory lock so two refreshes can't run concurrently (distinct from the sync lock and
// from the GMC locks 84219573/84219574).
const AMAZON_STATUS_LOCK_KEY = 84219576

export interface AmazonStatusRow {
  sku: string
  title: string | null
  status: string | null
  parent_sku: string | null
  asin: string | null
  price: string | null
  issues: any[]
  synced_at: string
}

export interface AmazonSummary {
  last_refreshed_at: string | null
  total: number
  approved: number
  pending: number
  disapproved: number
}

// Derive a single overall status from a Listings Items summary + issues.
// summaries[].status is an ARRAY (e.g. ["BUYABLE"] / ["DISCOVERABLE"]); issues[].severity is
// ERROR/WARNING/INFO.
function deriveStatus(item: any): string {
  const issues: any[] = item.issues || []
  if (issues.some(i => String(i.severity || '').toUpperCase() === 'ERROR')) return 'disapproved'
  const summaries: any[] = item.summaries || []
  const statuses = summaries
    .flatMap(s => (Array.isArray(s.status) ? s.status : s.status ? [s.status] : []))
    .map((v: any) => String(v).toUpperCase())
  const buyable = statuses.includes('BUYABLE')
  if (issues.some(i => String(i.severity || '').toUpperCase() === 'WARNING')) return 'pending'
  if (buyable) return 'approved'
  if (summaries.length) return 'pending'
  return 'unknown'
}

function itemTitle(item: any): string | null {
  const s = (item.summaries || [])[0]
  return s?.itemName || null
}

function itemAsin(item: any): string | null {
  const s = (item.summaries || [])[0]
  return s?.asin || null
}

// Pull ALL our Amazon listings (paginated) and upsert into amazon_listing_status, then
// recompute the aggregate meta row. Returns the fresh summary.
export async function refreshAmazonStatusSnapshot(): Promise<AmazonSummary | { locked: true }> {
  const lock = await queryOne<{ acquired: boolean }>(`SELECT pg_try_advisory_lock($1) AS acquired`, [
    AMAZON_STATUS_LOCK_KEY,
  ])
  if (!lock?.acquired) return { locked: true }

  try {
    const seen: string[] = []
    let pageToken: string | undefined
    do {
      const res = await searchListingsItems(pageToken)
      const items = res.items || []
      await recordAmazonQuantities(items).catch(() => {})
      for (const item of items) {
        const sku = item.sku
        if (!sku) continue
        const status = deriveStatus(item)
        const issues = (item.issues || []).map((i: any) => ({
          code: i.code,
          severity: i.severity,
          message: i.message,
          attributeNames: i.attributeNames,
        }))
        await query(
          `INSERT INTO amazon_listing_status
             (sku, title, status, asin, summaries, issues, synced_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now())
           ON CONFLICT (sku) DO UPDATE SET
             title = EXCLUDED.title, status = EXCLUDED.status, asin = EXCLUDED.asin,
             summaries = EXCLUDED.summaries, issues = EXCLUDED.issues, synced_at = now()`,
          [sku, itemTitle(item), status, itemAsin(item), JSON.stringify(item.summaries || []), JSON.stringify(issues)]
        )
        seen.push(sku)
      }
      pageToken = res.pagination?.nextToken
    } while (pageToken)

    // Drop rows no longer present in Amazon (listings that were removed).
    if (seen.length > 0) {
      await query(`DELETE FROM amazon_listing_status WHERE sku <> ALL($1::text[])`, [seen])
    }

    const counts = await queryOne<{ total: number; approved: number; pending: number; disapproved: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'disapproved')::int AS disapproved
         FROM amazon_listing_status`
    )
    await query(
      `UPDATE amazon_refresh_meta
          SET last_refreshed_at = now(), total = $1, approved = $2, pending = $3, disapproved = $4
        WHERE id = 1`,
      [counts?.total ?? 0, counts?.approved ?? 0, counts?.pending ?? 0, counts?.disapproved ?? 0]
    )
    return await getAmazonSummary()
  } finally {
    await query(`SELECT pg_advisory_unlock($1)`, [AMAZON_STATUS_LOCK_KEY]).catch(() => {})
  }
}

/** The last refresh's counts; with list filters, live counts of the matching listings instead. */
export async function getAmazonSummary(filters?: FilterQuery): Promise<AmazonSummary> {
  const m = await queryOne<AmazonSummary>(
    `SELECT last_refreshed_at, total, approved, pending, disapproved
       FROM amazon_refresh_meta WHERE id = 1`
  )
  const meta = m ?? { last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 }
  if (!filters || !hasFilters(AMAZON_LISTINGS_ENTITY, filters)) return meta
  const w = buildWhere(AMAZON_LISTINGS_ENTITY, filters)
  const c = await queryOne<Record<string, number>>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE al.status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE al.status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE al.status = 'disapproved')::int AS disapproved
       FROM amazon_listing_status al ${w.where}`,
    w.params
  )
  return {
    last_refreshed_at: meta.last_refreshed_at,
    total: c?.total ?? 0,
    approved: c?.approved ?? 0,
    pending: c?.pending ?? 0,
    disapproved: c?.disapproved ?? 0,
  }
}

export interface AmazonPageParams {
  page: number
  pageSize: number
  search?: string
  status?: string
  /** The listings tab's filters (normalised); `search` / `status` are the old params. */
  filters?: FilterQuery
  /** ?sort&dir */
  sort?: { get(name: string): string | null }
}

const LISTING_SORT: SortDef = {
  sorts: { sku: 'al.sku', title: 'al.title', status: 'al.status', issue: "al.issues->0->>'message'" },
  defaultSql: "(al.status = 'disapproved') DESC, (al.status = 'pending') DESC",
  tiebreak: 'al.sku',
}

export async function getAmazonStatusPage(
  params: AmazonPageParams
): Promise<{ rows: AmazonStatusRow[]; total: number }> {
  const page = Math.max(1, params.page || 1)
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 50))
  const q = params.filters ?? normalizeQuery(AMAZON_LISTINGS_ENTITY, { search: params.search, status: params.status })
  const w = buildWhere(AMAZON_LISTINGS_ENTITY, q)

  const totalRow = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM amazon_listing_status al ${w.where}`,
    w.params
  )
  const total = totalRow?.n ?? 0

  const rows = await queryMany<AmazonStatusRow>(
    `SELECT al.sku, al.title, al.status, al.parent_sku, al.asin, al.price, al.issues, al.synced_at
       FROM amazon_listing_status al ${w.where}
      ${sortClause(params.sort ?? new URLSearchParams(), LISTING_SORT)}
      LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`,
    [...w.params, pageSize, (page - 1) * pageSize]
  )
  return { rows, total }
}
