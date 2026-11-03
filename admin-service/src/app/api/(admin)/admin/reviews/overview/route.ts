import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery, type ScopeSql } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { istDate } from '@/lib/channels/report-store'
import { parsePeriod, previousPeriod } from '@/lib/reviews/overview-period'
import { REVIEWS_ENTITY } from '@/lib/filters/entities/reviews'

// IST day bounds: $1 previous-period start, $2 current start, $3 current end (inclusive day).
const BOUNDS = `b AS (
  SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS p0,
         ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c0,
         ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c1)`

const MIN_PRODUCT_REVIEWS = 3

export interface PeriodStats {
  reviews: number
  avgRating: number | null
  positive: number
  negative: number
  withPhotos: number
  verified: number
  approved: number
}

// All reviews up to period end, products with at least MIN_PRODUCT_REVIEWS.
function productRanking(args: string[], dir: 'ASC' | 'DESC', scope: ScopeSql) {
  return queryMany<Record<string, unknown>>(
    `WITH ${BOUNDS}
     SELECT p.id, p.name, p.slug, COUNT(*) AS reviews,
            ROUND(AVG(pr.rating)::numeric, 2) AS avg_rating,
            COUNT(*) FILTER (WHERE pr.created_at >= b.c0) AS new_reviews
     FROM product_reviews pr JOIN products p ON p.id = pr.product_id, b
     WHERE pr.created_at < b.c1${scope.sql}
     GROUP BY p.id
     HAVING COUNT(*) >= ${MIN_PRODUCT_REVIEWS}
     ORDER BY AVG(pr.rating) ${dir}, COUNT(*) DESC
     LIMIT 6`,
    [...args, ...scope.params]
  )
}

const n = (v: unknown) => (v == null ? 0 : Number(v))
const nn = (v: unknown) => (v == null ? null : Number(v))

function stats(row: Record<string, unknown> | undefined): PeriodStats {
  return {
    reviews: n(row?.reviews),
    avgRating: nn(row?.avg_rating),
    positive: n(row?.positive),
    negative: n(row?.negative),
    withPhotos: n(row?.with_photos),
    verified: n(row?.verified),
    approved: n(row?.approved),
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'reviews:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const today = istDate()
  const period = parsePeriod(sp.get('from'), sp.get('to'), today)
  const previous = previousPeriod(period)
  const args = [previous.from, period.from, period.to]
  const withForms = hasScope(admin.role, admin.scopes, 'review_forms:read')
  // The list's filters (not its date: the period owns from / to), after each query's own args.
  // Its Pending / Approved switch stays on the list: the overview splits by it.
  const scope = filterScope(REVIEWS_ENTITY, normalizeQuery(REVIEWS_ENTITY, sp), { omit: ['created', 'approval'] })
  const s4 = scope.and(args.length + 1)
  const own = scope.inIds('id', 1)
  const a4 = [...args, ...s4.params]

  try {
    const [kpiRows, pending, allTime, dist, trend, top, lowest, negatives, drops, recentNegative, funnel, forms] =
      await Promise.all([
        queryMany<Record<string, unknown>>(
          `WITH ${BOUNDS}
           SELECT CASE WHEN pr.created_at >= b.c0 THEN 'cur' ELSE 'prev' END AS period,
                  COUNT(*) AS reviews,
                  ROUND(AVG(pr.rating)::numeric, 2) AS avg_rating,
                  COUNT(*) FILTER (WHERE pr.rating >= 4) AS positive,
                  COUNT(*) FILTER (WHERE pr.rating <= 2) AS negative,
                  COUNT(*) FILTER (WHERE cardinality(pr.image_urls) > 0) AS with_photos,
                  COUNT(*) FILTER (WHERE pr.is_verified_purchase) AS verified,
                  COUNT(*) FILTER (WHERE pr.is_approved) AS approved
           FROM product_reviews pr, b
           WHERE pr.created_at >= b.p0 AND pr.created_at < b.c1${s4.sql}
           GROUP BY 1`,
          a4
        ),
        queryOne<Record<string, unknown>>(
          `SELECT COUNT(*) AS count,
                  COUNT(*) FILTER (WHERE rating <= 2) AS negative,
                  MIN(created_at) AS oldest
           FROM product_reviews WHERE is_approved = false${own.sql}`,
          ...(scope.empty ? [] : [own.params])
        ),
        queryOne<Record<string, unknown>>(
          `SELECT COUNT(*) AS reviews, ROUND(AVG(rating)::numeric, 2) AS avg_rating
           FROM product_reviews WHERE is_approved = true${own.sql}`,
          ...(scope.empty ? [] : [own.params])
        ),
        queryMany<Record<string, unknown>>(
          `WITH ${BOUNDS}
           SELECT s.r AS rating, COUNT(pr.id) AS count
           FROM generate_series(1, 5) s(r)
           CROSS JOIN b
           LEFT JOIN product_reviews pr ON pr.rating = s.r AND pr.created_at >= b.c0 AND pr.created_at < b.c1${s4.sql}
           GROUP BY s.r ORDER BY s.r`,
          a4
        ),
        queryMany<Record<string, unknown>>(
          `WITH ${BOUNDS}
           SELECT d::date::text AS day,
                  COUNT(pr.id) AS reviews,
                  COUNT(pr.id) FILTER (WHERE pr.rating <= 2) AS negative,
                  ROUND(AVG(pr.rating)::numeric, 2) AS avg_rating
           FROM generate_series($2::date, $3::date, interval '1 day') d
           LEFT JOIN product_reviews pr
             ON (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date = d::date${s4.sql}
           GROUP BY d ORDER BY d`,
          a4
        ),
        productRanking(args, 'DESC', s4),
        productRanking(args, 'ASC', s4),
        queryMany<Record<string, unknown>>(
          `WITH ${BOUNDS}
           SELECT p.id, p.name, p.slug,
                  COUNT(*) FILTER (WHERE pr.rating <= 2) AS negative,
                  COUNT(*) AS reviews,
                  ROUND(AVG(pr.rating)::numeric, 2) AS avg_rating
           FROM product_reviews pr JOIN products p ON p.id = pr.product_id, b
           WHERE pr.created_at >= b.c0 AND pr.created_at < b.c1${s4.sql}
           GROUP BY p.id
           HAVING COUNT(*) FILTER (WHERE pr.rating <= 2) > 0
           ORDER BY negative DESC, avg_rating ASC
           LIMIT 8`,
          a4
        ),
        // Cumulative rating at period start vs at period end, for products reviewed in the period.
        queryMany<Record<string, unknown>>(
          `WITH ${BOUNDS},
           agg AS (
             SELECT pr.product_id,
                    AVG(pr.rating) FILTER (WHERE pr.created_at < b.c0) AS before_avg,
                    COUNT(*) FILTER (WHERE pr.created_at < b.c0) AS before_count,
                    AVG(pr.rating) AS after_avg,
                    COUNT(*) FILTER (WHERE pr.created_at >= b.c0) AS new_count,
                    AVG(pr.rating) FILTER (WHERE pr.created_at >= b.c0) AS new_avg
             FROM product_reviews pr, b
             WHERE pr.created_at < b.c1${s4.sql}
             GROUP BY pr.product_id
           )
           SELECT p.id, p.name, p.slug,
                  ROUND(agg.before_avg::numeric, 2) AS before_avg,
                  ROUND(agg.after_avg::numeric, 2) AS after_avg,
                  ROUND(agg.new_avg::numeric, 2) AS new_avg,
                  agg.new_count, agg.before_count
           FROM agg JOIN products p ON p.id = agg.product_id
           WHERE agg.new_count > 0 AND agg.before_count >= 2 AND agg.after_avg <= agg.before_avg - 0.2
           ORDER BY agg.after_avg - agg.before_avg ASC
           LIMIT 8`,
          a4
        ),
        queryMany<Record<string, unknown>>(
          `WITH ${BOUNDS}
           SELECT pr.id, pr.rating, pr.title, LEFT(pr.comment, 200) AS comment, pr.created_at, pr.is_approved,
                  pr.is_verified_purchase, p.id AS product_id, p.name AS product_name, p.slug AS product_slug,
                  NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS customer
           FROM product_reviews pr
           CROSS JOIN b
           LEFT JOIN products p ON p.id = pr.product_id
           LEFT JOIN users u ON u.id = pr.user_id
           WHERE pr.rating <= 2 AND pr.created_at >= b.c0 AND pr.created_at < b.c1${s4.sql}
           ORDER BY pr.created_at DESC
           LIMIT 10`,
          a4
        ),
        // Review request / reminder messages; an order counts as reviewed once its buyer reviews one of its items after the send.
        queryMany<Record<string, unknown>>(
          `WITH ${BOUNDS},
           sent AS (
             SELECT ecs.*, CASE WHEN ecs.sent_at >= b.c0 THEN 'cur' ELSE 'prev' END AS period
             FROM email_campaigns_sent ecs
             JOIN campaigns c ON c.kind = ecs.campaign_kind, b
             WHERE COALESCE(c.scenario_kind, c.kind) IN ('review_request', 'review_reminder')
               AND ecs.sent_at >= b.p0 AND ecs.sent_at < b.c1
           ),
           orders_req AS (
             SELECT period, reference_id, user_id, MIN(sent_at) AS first_sent,
                    bool_or(opened_at IS NOT NULL) AS opened, bool_or(clicked_at IS NOT NULL) AS clicked
             FROM sent WHERE reference_id IS NOT NULL
             GROUP BY period, reference_id, user_id
           )
           SELECT s.period,
                  (SELECT COUNT(*) FROM sent x WHERE x.period = s.period) AS messages,
                  (SELECT COUNT(*) FROM sent x WHERE x.period = s.period AND x.channel = 'email') AS emails,
                  (SELECT COUNT(*) FROM sent x WHERE x.period = s.period AND x.channel <> 'email') AS other_channels,
                  COUNT(*) AS orders,
                  COUNT(*) FILTER (WHERE s.opened) AS opened,
                  COUNT(*) FILTER (WHERE s.clicked) AS clicked,
                  COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM product_reviews pr
                    JOIN order_items oi ON oi.product_id = pr.product_id
                    WHERE oi.order_id::text = s.reference_id AND pr.user_id = s.user_id
                      AND pr.created_at >= s.first_sent)) AS reviewed
           FROM orders_req s
           GROUP BY s.period`,
          args
        ),
        withForms
          ? queryMany<Record<string, unknown>>(
              `WITH ${BOUNDS}
               SELECT CASE WHEN s.submitted_at >= b.c0 THEN 'cur' ELSE 'prev' END AS period,
                      COUNT(*) AS submissions,
                      COUNT(*) FILTER (WHERE s.coupon_code IS NOT NULL) AS coupons,
                      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending
               FROM review_form_submissions s, b
               WHERE s.submitted_at >= b.p0 AND s.submitted_at < b.c1
               GROUP BY 1`,
              args
            )
          : Promise.resolve(null),
      ])

    const formsPending = withForms
      ? await queryMany<Record<string, unknown>>(
          `SELECT f.id, f.title, COUNT(*) AS pending
           FROM review_form_submissions s JOIN review_forms f ON f.id = s.form_id
           WHERE s.status = 'pending'
           GROUP BY f.id ORDER BY pending DESC LIMIT 5`
        )
      : []

    const byPeriod = <T,>(rows: Record<string, unknown>[] | null, map: (r: Record<string, unknown> | undefined) => T) => ({
      current: map(rows?.find(r => r.period === 'cur')),
      previous: map(rows?.find(r => r.period === 'prev')),
    })
    const product = (r: Record<string, unknown>) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      slug: (r.slug as string) ?? null,
      reviews: n(r.reviews),
      avgRating: nn(r.avg_rating),
      newReviews: n(r.new_reviews),
    })

    return NextResponse.json({
      period,
      previous,
      kpis: byPeriod(kpiRows, stats),
      pending: { count: n(pending?.count), negative: n(pending?.negative), oldest: pending?.oldest ?? null },
      allTime: { reviews: n(allTime?.reviews), avgRating: nn(allTime?.avg_rating) },
      distribution: dist.map(r => ({ rating: n(r.rating), count: n(r.count) })),
      trend: trend.map(r => ({ day: String(r.day), reviews: n(r.reviews), negative: n(r.negative), avgRating: nn(r.avg_rating) })),
      products: {
        minReviews: MIN_PRODUCT_REVIEWS,
        top: top.map(product),
        lowest: lowest.map(product),
        mostNegative: negatives.map(r => ({ ...product(r), negative: n(r.negative) })),
        ratingDrops: drops.map(r => ({
          id: String(r.id),
          name: String(r.name ?? ''),
          slug: (r.slug as string) ?? null,
          beforeAvg: nn(r.before_avg),
          afterAvg: nn(r.after_avg),
          newAvg: nn(r.new_avg),
          newReviews: n(r.new_count),
        })),
      },
      recentNegative: recentNegative.map(r => ({
        id: String(r.id),
        rating: n(r.rating),
        title: (r.title as string) ?? null,
        comment: String(r.comment ?? ''),
        createdAt: r.created_at,
        isApproved: !!r.is_approved,
        verified: !!r.is_verified_purchase,
        productId: (r.product_id as string) ?? null,
        productName: (r.product_name as string) ?? null,
        productSlug: (r.product_slug as string) ?? null,
        customer: (r.customer as string) ?? null,
      })),
      funnel: byPeriod(funnel, r => ({
        messages: n(r?.messages),
        emails: n(r?.emails),
        otherChannels: n(r?.other_channels),
        orders: n(r?.orders),
        opened: n(r?.opened),
        clicked: n(r?.clicked),
        reviewed: n(r?.reviewed),
      })),
      filtered: !scope.empty,
      forms: withForms
        ? {
            ...byPeriod(forms, r => ({ submissions: n(r?.submissions), coupons: n(r?.coupons), pending: n(r?.pending) })),
            pendingByForm: formsPending.map(r => ({ id: String(r.id), title: String(r.title ?? ''), pending: n(r.pending) })),
          }
        : null,
    })
  } catch (err) {
    console.error('[reviews/overview]', err)
    return NextResponse.json({ error: 'Failed to load reviews overview' }, { status: 500 })
  }
}
