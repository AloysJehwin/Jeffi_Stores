import { query, queryMany, queryOne } from '@/lib/shared/db'
import { searchListingsItems } from './client'

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

export async function getAmazonSummary(): Promise<AmazonSummary> {
  const m = await queryOne<AmazonSummary>(
    `SELECT last_refreshed_at, total, approved, pending, disapproved
       FROM amazon_refresh_meta WHERE id = 1`
  )
  return m ?? { last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 }
}

export interface AmazonPageParams {
  page: number
  pageSize: number
  search?: string
  status?: string
}

export async function getAmazonStatusPage(
  params: AmazonPageParams
): Promise<{ rows: AmazonStatusRow[]; total: number }> {
  const page = Math.max(1, params.page || 1)
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 50))
  const where: string[] = []
  const args: any[] = []
  if (params.search) {
    args.push(`%${params.search}%`)
    where.push(`(sku ILIKE $${args.length} OR title ILIKE $${args.length})`)
  }
  if (params.status && params.status !== 'all') {
    args.push(params.status)
    where.push(`status = $${args.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const totalRow = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM amazon_listing_status ${whereSql}`,
    args
  )
  const total = totalRow?.n ?? 0

  const limitArg = args.length + 1
  const offsetArg = args.length + 2
  const rows = await queryMany<AmazonStatusRow>(
    `SELECT sku, title, status, parent_sku, asin, price, issues, synced_at
       FROM amazon_listing_status ${whereSql}
      ORDER BY (status = 'disapproved') DESC, (status = 'pending') DESC, sku
      LIMIT $${limitArg} OFFSET $${offsetArg}`,
    [...args, pageSize, (page - 1) * pageSize]
  )
  return { rows, total }
}
