import { queryMany, queryOne, query } from '@/lib/shared/db'
import { runChange } from './change-log'
import type { ChangeActor } from './types'

// Which brands each sales channel may receive. Marketplaces gate brands (Amazon brand approval,
// Myntra/AJIO/Flipkart brand authorisation), so a brand is pushed there only once it's approved. Google and
// the Meta catalogue take every brand unless the store marks one not approved.
export const BRAND_GATED_CHANNELS = { amazon: true, myntra: true, ajio: true, flipkart: true, gmc: false, meta_ads: false } as const
export type GatedChannel = keyof typeof BRAND_GATED_CHANNELS
export type ApprovalStatus = 'approved' | 'pending' | 'not_approved'
export const APPROVAL_STATUSES: ApprovalStatus[] = ['approved', 'pending', 'not_approved']

export const isGatedChannel = (c: unknown): c is GatedChannel => typeof c === 'string' && Object.prototype.hasOwnProperty.call(BRAND_GATED_CHANNELS, c)
export const requiresApproval = (channel: GatedChannel) => BRAND_GATED_CHANNELS[channel]

/** Whether a brand with this status may be pushed. Products without a brand are never held back. */
export function brandAllowed(channel: GatedChannel, status: ApprovalStatus | null | undefined): boolean {
  if (status === 'approved') return true
  if (status === 'pending' || status === 'not_approved') return false
  return !requiresApproval(channel)
}

export interface BrandGate {
  allows(brandId: string | null | undefined): boolean
}

export async function loadBrandGate(channel: GatedChannel): Promise<BrandGate> {
  const rows = await queryMany<{ brand_id: string; status: ApprovalStatus }>(
    `SELECT brand_id::text, status FROM channel_brand_approvals WHERE channel = $1`,
    [channel]
  )
  const status = new Map(rows.map(r => [r.brand_id, r.status]))
  return { allows: id => !id || brandAllowed(channel, status.get(id) ?? null) }
}

export interface BrandApprovalRow {
  brandId: string
  brandName: string
  productCount: number
  status: ApprovalStatus | null
  allowed: boolean
  source: string | null
  note: string | null
  approvalUrl: string | null
  checkedAt: string | null
  updatedBy: string | null
  updatedAt: string | null
}

/** Every brand with its active product count and its approval for the channel. */
export async function listBrandApprovals(channel: GatedChannel): Promise<BrandApprovalRow[]> {
  const rows = await queryMany<any>(
    `SELECT b.id::text AS brand_id, b.name AS brand_name, count(p.id)::int AS product_count,
            a.status, a.source, a.note, a.approval_url, a.checked_at, a.updated_by, a.updated_at
       FROM brands b
       LEFT JOIN products p ON p.brand_id = b.id AND COALESCE(p.is_active, true)
       LEFT JOIN channel_brand_approvals a ON a.brand_id = b.id AND a.channel = $1
      GROUP BY b.id, b.name, a.status, a.source, a.note, a.approval_url, a.checked_at, a.updated_by, a.updated_at
      ORDER BY count(p.id) DESC, b.name`,
    [channel]
  )
  return rows.map(r => ({
    brandId: r.brand_id,
    brandName: r.brand_name,
    productCount: r.product_count,
    status: r.status ?? null,
    allowed: brandAllowed(channel, r.status ?? null),
    source: r.source ?? null,
    note: r.note ?? null,
    approvalUrl: r.approval_url ?? null,
    checkedAt: r.checked_at ? new Date(r.checked_at).toISOString() : null,
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }))
}

/** Set (or with `status: null`, clear) a brand's approval for a channel; logged in the channel's change history.
 * A note left undefined keeps the stored one (e.g. Amazon's reason). */
export async function setBrandApproval(
  channel: GatedChannel,
  brandId: string,
  status: ApprovalStatus | null,
  opts: { note?: string | null; approvalUrl?: string | null },
  actor: ChangeActor
) {
  const before = await queryOne<{ status: ApprovalStatus; name: string }>(
    `SELECT a.status, b.name FROM brands b LEFT JOIN channel_brand_approvals a ON a.brand_id = b.id AND a.channel = $1 WHERE b.id = $2`,
    [channel, brandId]
  )
  return runChange(
    {
      channel,
      action: 'brand_approval',
      entityType: 'brand',
      entityId: brandId,
      summary: `${before?.name ?? 'Brand'}: ${status ? status.replace('_', ' ') : 'approval cleared'}`,
      before: { status: before?.status ?? null },
      after: { status },
      validate: () => (before ? [] : ['Brand not found.']),
      apply: async () => {
        if (!status) {
          await query(`DELETE FROM channel_brand_approvals WHERE channel = $1 AND brand_id = $2`, [channel, brandId])
          return null
        }
        await query(
          `INSERT INTO channel_brand_approvals (channel, brand_id, status, source, note, approval_url, updated_by, updated_at)
           VALUES ($1, $2, $3, 'manual', $4, $5, $6, now())
           ON CONFLICT (channel, brand_id) DO UPDATE SET status = EXCLUDED.status, source = 'manual',
             note = CASE WHEN $7 THEN channel_brand_approvals.note ELSE EXCLUDED.note END,
             approval_url = COALESCE(EXCLUDED.approval_url, channel_brand_approvals.approval_url),
             updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [channel, brandId, status, opts.note ?? null, opts.approvalUrl ?? null, actor.email, opts.note === undefined]
        )
        return status
      },
    },
    actor,
    false
  )
}

export interface PushScope {
  brandIds: string[]
  categoryIds: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A push's brand/category filter from a request body; null when it pushes everything. */
export function parsePushScope(body: any): PushScope | null {
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 500) : [])
  const scope = { brandIds: ids(body?.brandIds), categoryIds: ids(body?.categoryIds) }
  return scope.brandIds.length || scope.categoryIds.length ? scope : null
}

// Amazon's Listings Restrictions API answers per ASIN: no restrictions means the seller may offer it;
// APPROVAL_REQUIRED carries a "Request approval" link. Brand gating is per brand, so one ASIN we
// matched for each brand (by GTIN or a live listing, never a keyword guess) stands for the brand.
export async function checkAmazonBrandApprovals(
  getRestrictions: (asin: string) => Promise<{ restrictions?: any[] }>,
  opts: { brandIds?: string[] } = {}
): Promise<{ checked: number; approved: number; notApproved: number; manualKept: number; noAsin: number; errors: Array<{ brand: string; error: string }> }> {
  const brands = await queryMany<{ brand_id: string; brand_name: string; asin: string | null; source: string | null }>(
    `SELECT b.id::text AS brand_id, b.name AS brand_name, x.asin, a.source
       FROM brands b
       LEFT JOIN LATERAL (
         SELECT COALESCE(v.asin, p.asin) AS asin
           FROM products p LEFT JOIN product_variants v ON v.product_id = p.id AND v.asin IS NOT NULL AND v.asin_match IN ('gtin', 'listed')
          WHERE p.brand_id = b.id AND COALESCE(p.is_active, true)
            AND (v.asin IS NOT NULL OR (p.asin IS NOT NULL AND p.asin_match IN ('gtin', 'listed')))
          LIMIT 1) x ON true
       LEFT JOIN channel_brand_approvals a ON a.channel = 'amazon' AND a.brand_id = b.id
      WHERE EXISTS (SELECT 1 FROM products p WHERE p.brand_id = b.id AND COALESCE(p.is_active, true))
        AND ($1::uuid[] IS NULL OR b.id = ANY($1::uuid[]))`,
    [opts.brandIds?.length ? opts.brandIds : null]
  )
  const out = { checked: 0, approved: 0, notApproved: 0, manualKept: 0, noAsin: 0, errors: [] as Array<{ brand: string; error: string }> }
  for (const b of brands) {
    if (!b.asin) {
      out.noAsin++
      continue
    }
    try {
      const res = await getRestrictions(b.asin)
      const restrictions = res.restrictions ?? []
      const reasons = restrictions.flatMap((r: any) => r.reasons ?? [])
      if (reasons.some((r: any) => r.reasonCode === 'ASIN_NOT_FOUND')) {
        out.noAsin++
        continue
      }
      out.checked++
      const status: ApprovalStatus = restrictions.length ? 'not_approved' : 'approved'
      if (b.source === 'manual') {
        out.manualKept++
        continue
      }
      const link = reasons.flatMap((r: any) => r.links ?? []).find((l: any) => l?.resource)?.resource ?? null
      const note = reasons.map((r: any) => r.message).filter(Boolean).join(' ').slice(0, 500) || null
      await query(
        `INSERT INTO channel_brand_approvals (channel, brand_id, status, source, note, approval_url, checked_at, updated_by, updated_at)
         VALUES ('amazon', $1, $2, 'amazon_restrictions', $3, $4, now(), 'amazon', now())
         ON CONFLICT (channel, brand_id) DO UPDATE SET status = EXCLUDED.status, source = EXCLUDED.source, note = EXCLUDED.note,
           approval_url = EXCLUDED.approval_url, checked_at = now(), updated_by = 'amazon', updated_at = now()
         WHERE channel_brand_approvals.source <> 'manual'`,
        [b.brand_id, status, note, link]
      )
      if (status === 'approved') out.approved++
      else out.notApproved++
    } catch (e: any) {
      out.errors.push({ brand: b.brand_name, error: String(e?.message || e).slice(0, 200) })
    }
  }
  return out
}
