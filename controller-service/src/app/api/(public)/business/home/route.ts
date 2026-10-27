import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { getProductCardsByIds, cardPropsFor } from '@/lib/catalog/product-cards'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getHomepagePlan } from '@/lib/catalog/homepage-plan'
import { businessOffersConfig, type HomepageSection } from '@/lib/catalog/homepage-sections'
import type { CardProps } from '@/lib/catalog/product-card-props'

export const dynamic = 'force-dynamic'

const OPEN_RFQ_STATUSES = ['pending', 'reviewed', 'negotiating', 'offer_accepted']
const MAX_PRODUCTS = 24

const intParam = (raw: string | null, fallback: number, max: number) => {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback
}

async function cardsFor(ids: string[], gstEnabled: boolean): Promise<CardProps[]> {
  if (ids.length === 0) return []
  const order = new Map(ids.map((id, i) => [id, i]))
  const cards = cardPropsFor(await getProductCardsByIds(ids, gstEnabled), gstEnabled)
  return cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

/**
 * GET /api/business/home — the signed-in business's own data for the business homepage's sections.
 * `sections` names what to load (reorder, quotes, offers, account); `offers` lists Business offers
 * section ids, whose settings come from the published section. 401 for visitors, who see each
 * section's visitor state instead.
 */
export async function GET(request: NextRequest) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.approvalStatus !== 'approved') return NextResponse.json({ error: 'Account pending approval' }, { status: 403 })
  if (!(await getHomepagePlan()).business) return NextResponse.json({ error: 'Not available' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const want = new Set((params.get('sections') ?? '').split(',').map(s => s.trim()))
  const offerIds = (params.get('offers') ?? '').split(',').filter(Boolean).slice(0, 6)
  const { gstEnabled } = await getFeatureFlags()
  const userId = user.userId
  const body: Record<string, unknown> = {}

  try {
    const company = await queryOne<{ company_name: string | null; gst_number: string | null }>(
      `SELECT company_name, gst_number FROM business_profiles WHERE user_id = $1`,
      [userId]
    )
    body.company = { name: company?.company_name ?? null, gstNumber: company?.gst_number ?? null }

    const jobs: Promise<void>[] = []

    if (want.has('reorder')) {
      const limit = intParam(params.get('reorderLimit'), 8, MAX_PRODUCTS)
      jobs.push(
        (async () => {
          // Most-ordered first: how many orders a product was on, then how recently.
          const rows = await queryMany<{ product_id: string }>(
            `SELECT oi.product_id
               FROM order_items oi
               JOIN orders o ON o.id = oi.order_id
               JOIN products p ON p.id = oi.product_id AND p.is_active = true
              WHERE o.user_id = $1
                AND o.status NOT IN ('draft', 'cancelled', 'cancel_requested')
              GROUP BY oi.product_id
              ORDER BY COUNT(DISTINCT o.id) DESC, MAX(o.created_at) DESC, oi.product_id
              LIMIT $2`,
            [userId, limit]
          )
          body.reorder = await cardsFor(rows.map(r => r.product_id), gstEnabled)
        })()
      )
    }

    if (want.has('quotes') || want.has('account')) {
      const limit = intParam(params.get('quotesLimit'), 3, 10)
      jobs.push(
        (async () => {
          const [items, count] = await Promise.all([
            queryMany<{ id: string; rfq_number: string; status: string; item_count: number; created_at: string }>(
              `SELECT r.id, r.rfq_number, r.status, r.created_at,
                      (SELECT COUNT(*) FROM business_rfq_items ri WHERE ri.rfq_id = r.id)::int AS item_count
                 FROM business_rfqs r
                WHERE r.user_id = $1 AND r.status = ANY($2::text[])
                ORDER BY r.created_at DESC
                LIMIT $3`,
              [userId, OPEN_RFQ_STATUSES, limit]
            ),
            queryOne<{ n: number }>(
              `SELECT COUNT(*)::int AS n FROM business_rfqs WHERE user_id = $1 AND status = ANY($2::text[])`,
              [userId, OPEN_RFQ_STATUSES]
            ),
          ])
          body.quotes = {
            open: count?.n ?? 0,
            items: items.map(r => ({
              id: r.id,
              rfqNumber: r.rfq_number,
              status: r.status,
              itemCount: r.item_count,
              createdAt: r.created_at,
            })),
          }
        })()
      )
    }

    if (want.has('account')) {
      jobs.push(
        (async () => {
          const [recent, due] = await Promise.all([
            queryMany<{ id: string; order_number: string; status: string; total_amount: string; created_at: string }>(
              `SELECT id, order_number, status, total_amount, created_at
                 FROM orders
                WHERE user_id = $1 AND status <> 'draft'
                ORDER BY created_at DESC
                LIMIT 3`,
              [userId]
            ),
            queryOne<{ n: number; total: string | null }>(
              `SELECT COUNT(*)::int AS n, SUM(total_amount) AS total
                 FROM orders
                WHERE user_id = $1 AND payment_mode = 'manual' AND payment_status <> 'paid'
                  AND status NOT IN ('draft', 'cancelled', 'cancel_requested')`,
              [userId]
            ),
          ])
          body.account = {
            recentOrders: recent.map(o => ({
              id: o.id,
              orderNumber: o.order_number,
              status: o.status,
              total: Number(o.total_amount),
              createdAt: o.created_at,
            })),
            paymentsDue: { count: due?.n ?? 0, total: Number(due?.total ?? 0) },
          }
        })()
      )
    }

    if (want.has('offers') && offerIds.length > 0) {
      jobs.push(
        (async () => {
          const sections = await queryMany<Pick<HomepageSection, 'id' | 'type' | 'config'>>(
            `SELECT id, type, config FROM homepage_sections
              WHERE id = ANY($1::uuid[]) AND type = 'business_offers'`,
            [offerIds.filter(id => /^[0-9a-f-]{36}$/i.test(id))]
          )
          const offers: Record<string, CardProps[]> = {}
          for (const s of sections) {
            const { source, productIds, limit } = businessOffersConfig(s)
            if (source === 'picked') {
              offers[s.id] = await cardsFor(productIds.slice(0, limit), gstEnabled)
              continue
            }
            // Products in the categories this business has a discount on, biggest discount first.
            const rows = await queryMany<{ id: string }>(
              `SELECT p.id
                 FROM products p
                 JOIN business_discounts bd ON bd.category_id = p.category_id AND bd.user_id = $1
                WHERE p.is_active = true AND bd.discount_pct > 0
                ORDER BY bd.discount_pct DESC, p.is_featured DESC, p.created_at DESC
                LIMIT $2`,
              [userId, limit]
            )
            offers[s.id] = await cardsFor(rows.map(r => r.id), gstEnabled)
          }
          body.offers = offers
        })()
      )
    }

    await Promise.all(jobs)
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[business/home]', err)
    return NextResponse.json({ error: 'Failed to load your business home' }, { status: 500 })
  }
}
