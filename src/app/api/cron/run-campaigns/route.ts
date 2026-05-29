import { NextRequest, NextResponse } from 'next/server'
import { queryMany, query, queryOne } from '@/lib/db'
import {
  sendAbandonedCartEmail,
  sendAbandonedCheckoutEmail,
  sendPostPurchaseEmail,
  sendReviewReminderEmail,
  sendWinbackEmail,
  sendRestockEmail,
  sendPriceDropEmail,
} from '@/lib/automation-emails'
import { getCampaign, type CampaignKind } from '@/lib/marketing'

export const dynamic = 'force-dynamic'

interface SweepResult {
  campaign: CampaignKind
  attempted: number
  sent: number
  skipped: number
}

async function sweepAbandonedCart(): Promise<SweepResult> {
  const campaign = await getCampaign('abandoned_cart')
  if (!campaign?.enabled) return { campaign: 'abandoned_cart', attempted: 0, sent: 0, skipped: 0 }

  const rows = await queryMany<{ user_id: string }>(`
    SELECT DISTINCT ci.user_id
    FROM cart_items ci
    JOIN users u ON u.id = ci.user_id
    WHERE ci.saved_for_later = FALSE
      AND ci.updated_at < NOW() - INTERVAL '${campaign.delay_hours} hours'
      AND ci.updated_at > NOW() - INTERVAL '7 days'
      AND u.is_active = TRUE
      AND u.is_guest = FALSE
      AND u.marketing_opt_out = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = 'abandoned_cart'
          AND ecs.user_id = ci.user_id
          AND ecs.sent_at > NOW() - INTERVAL '7 days'
      )
    LIMIT 50
  `)

  let sent = 0, skipped = 0
  for (const row of rows) {
    const items = await queryMany<{ name: string; quantity: number; price: number }>(`
      SELECT p.name,
             ci.quantity::float AS quantity,
             COALESCE(pv.price, p.base_price)::float AS price
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.user_id = $1 AND ci.saved_for_later = FALSE
      LIMIT 5
    `, [row.user_id])
    if (items.length === 0) { skipped++; continue }
    const result = await sendAbandonedCartEmail(row.user_id, items)
    if (result.ok) sent++; else skipped++
  }
  return { campaign: 'abandoned_cart', attempted: rows.length, sent, skipped }
}

async function sweepAbandonedCheckout(): Promise<SweepResult> {
  const campaign = await getCampaign('abandoned_checkout')
  if (!campaign?.enabled) return { campaign: 'abandoned_checkout', attempted: 0, sent: 0, skipped: 0 }

  const orders = await queryMany<{ id: string; user_id: string; order_number: string; total_amount: string }>(`
    SELECT o.id, o.user_id, o.order_number, o.total_amount::text
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.status = 'cancelled' AND o.payment_status = 'cancelled'
      AND o.updated_at > NOW() - INTERVAL '${campaign.delay_hours} hours'
      AND o.updated_at < NOW() - INTERVAL '15 minutes'
      AND u.is_active = TRUE AND u.marketing_opt_out = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = 'abandoned_checkout'
          AND ecs.user_id = o.user_id
          AND ecs.reference_id = o.id::text
      )
    LIMIT 50
  `)

  let sent = 0, skipped = 0
  for (const order of orders) {
    const result = await sendAbandonedCheckoutEmail(order.user_id, order)
    if (result.ok) sent++; else skipped++
  }
  return { campaign: 'abandoned_checkout', attempted: orders.length, sent, skipped }
}

async function sweepPostPurchase(): Promise<SweepResult> {
  const campaign = await getCampaign('post_purchase')
  if (!campaign?.enabled) return { campaign: 'post_purchase', attempted: 0, sent: 0, skipped: 0 }

  const orders = await queryMany<{ id: string; user_id: string; order_number: string }>(`
    SELECT o.id, o.user_id, o.order_number
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.status = 'delivered'
      AND o.delivered_at < NOW() - INTERVAL '${campaign.delay_hours} hours'
      AND o.delivered_at > NOW() - INTERVAL '7 days'
      AND u.marketing_opt_out = FALSE AND u.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = 'post_purchase'
          AND ecs.reference_id = o.id::text
      )
    LIMIT 50
  `)

  let sent = 0, skipped = 0
  for (const order of orders) {
    const result = await sendPostPurchaseEmail(order.user_id, order)
    if (result.ok) sent++; else skipped++
  }
  return { campaign: 'post_purchase', attempted: orders.length, sent, skipped }
}

async function sweepReviewReminder(): Promise<SweepResult> {
  const campaign = await getCampaign('review_reminder')
  if (!campaign?.enabled) return { campaign: 'review_reminder', attempted: 0, sent: 0, skipped: 0 }

  const orders = await queryMany<{ id: string; user_id: string; order_number: string }>(`
    SELECT o.id, o.user_id, o.order_number
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.status = 'delivered'
      AND o.delivered_at < NOW() - INTERVAL '${campaign.delay_hours} hours'
      AND o.delivered_at > NOW() - INTERVAL '30 days'
      AND u.marketing_opt_out = FALSE AND u.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM product_reviews pr
        JOIN order_items oi ON oi.product_id = pr.product_id
        WHERE oi.order_id = o.id AND pr.user_id = o.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = 'review_reminder'
          AND ecs.reference_id = o.id::text
      )
    LIMIT 50
  `)

  let sent = 0, skipped = 0
  for (const order of orders) {
    const result = await sendReviewReminderEmail(order.user_id, order)
    if (result.ok) sent++; else skipped++
  }
  return { campaign: 'review_reminder', attempted: orders.length, sent, skipped }
}

async function sweepWinback(kind: 'winback_90' | 'winback_180', minDays: number, maxDays: number, scoreMin: number, scoreMax: number): Promise<SweepResult> {
  const campaign = await getCampaign(kind)
  if (!campaign?.enabled) return { campaign: kind, attempted: 0, sent: 0, skipped: 0 }

  const users = await queryMany<{ id: string }>(`
    SELECT u.id
    FROM users u
    LEFT JOIN customer_health ch ON ch.user_id = u.id
    WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.marketing_opt_out = FALSE
      AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.user_id = u.id AND o.payment_status = 'paid'
        GROUP BY o.user_id
        HAVING MAX(o.created_at) BETWEEN NOW() - INTERVAL '${maxDays} days' AND NOW() - INTERVAL '${minDays} days'
      )
      AND (ch.score IS NULL OR (ch.score >= $2 AND ch.score < $3))
      AND NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = $1
          AND ecs.user_id = u.id
          AND ecs.sent_at > NOW() - INTERVAL '60 days'
      )
    LIMIT 50
  `, [kind, scoreMin, scoreMax])

  let sent = 0, skipped = 0
  for (const user of users) {
    const result = await sendWinbackEmail(user.id, kind)
    if (result.ok) sent++; else skipped++
  }
  return { campaign: kind, attempted: users.length, sent, skipped }
}

async function sweepRestockAndPriceDrop(): Promise<{ restock: SweepResult; priceDrop: SweepResult }> {
  const restockCampaign = await getCampaign('restock')
  const priceDropCampaign = await getCampaign('price_drop')

  const restockResult: SweepResult = { campaign: 'restock', attempted: 0, sent: 0, skipped: 0 }
  const priceDropResult: SweepResult = { campaign: 'price_drop', attempted: 0, sent: 0, skipped: 0 }

  if (!restockCampaign?.enabled && !priceDropCampaign?.enabled) {
    return { restock: restockResult, priceDrop: priceDropResult }
  }

  const watches = await queryMany<{
    user_id: string; product_id: string; product_name: string; product_slug: string
    snapshot_price: string | null; snapshot_in_stock: boolean | null
    current_price: string; current_in_stock: boolean
  }>(`
    SELECT wi.user_id, wi.product_id, p.name AS product_name, p.slug AS product_slug,
           wi.snapshot_price::text AS snapshot_price,
           wi.snapshot_in_stock,
           p.base_price::text AS current_price,
           (p.inventory_quantity > 0) AS current_in_stock
    FROM wishlist_items wi
    JOIN products p ON p.id = wi.product_id
    JOIN users u ON u.id = wi.user_id
    WHERE u.marketing_opt_out = FALSE AND u.is_active = TRUE AND u.is_guest = FALSE
      AND wi.snapshot_taken_at IS NOT NULL
      AND (
        (wi.snapshot_in_stock = FALSE AND p.inventory_quantity > 0)
        OR (wi.snapshot_price IS NOT NULL AND p.base_price < wi.snapshot_price * 0.95)
      )
    LIMIT 100
  `)

  for (const w of watches) {
    const oldPrice = w.snapshot_price ? parseFloat(w.snapshot_price) : 0
    const newPrice = parseFloat(w.current_price)
    const wasOutOfStock = w.snapshot_in_stock === false
    const isInStockNow = w.current_in_stock
    const product = { id: w.product_id, name: w.product_name, slug: w.product_slug }

    if (wasOutOfStock && isInStockNow && restockCampaign?.enabled) {
      restockResult.attempted++
      const result = await sendRestockEmail(w.user_id, product)
      if (result.ok) restockResult.sent++; else restockResult.skipped++
    } else if (oldPrice > 0 && newPrice < oldPrice * 0.95 && priceDropCampaign?.enabled) {
      priceDropResult.attempted++
      const result = await sendPriceDropEmail(w.user_id, product, oldPrice, newPrice)
      if (result.ok) priceDropResult.sent++; else priceDropResult.skipped++
    }

    await query(
      `UPDATE wishlist_items
       SET snapshot_price = $1, snapshot_in_stock = $2, snapshot_taken_at = NOW()
       WHERE user_id = $3 AND product_id = $4`,
      [newPrice, isInStockNow, w.user_id, w.product_id]
    ).catch(() => {})
  }

  return { restock: restockResult, priceDrop: priceDropResult }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const onlyKind = req.nextUrl.searchParams.get('kind')
  const results: SweepResult[] = []

  const wantsRun = (k: string) => !onlyKind || onlyKind === k

  try {
    if (wantsRun('abandoned_cart'))     results.push(await sweepAbandonedCart())
    if (wantsRun('abandoned_checkout')) results.push(await sweepAbandonedCheckout())
    if (wantsRun('post_purchase'))      results.push(await sweepPostPurchase())
    if (wantsRun('review_reminder'))    results.push(await sweepReviewReminder())
    if (wantsRun('winback_90'))         results.push(await sweepWinback('winback_90', 60, 150, 25, 50))
    if (wantsRun('winback_180'))        results.push(await sweepWinback('winback_180', 150, 365, 0, 25))
    if (wantsRun('restock') || wantsRun('price_drop')) {
      const both = await sweepRestockAndPriceDrop()
      results.push(both.restock, both.priceDrop)
    }

    for (const r of results) {
      if (r.attempted > 0) {
        await query(
          `UPDATE campaigns SET last_run_at = NOW() WHERE kind = $1`,
          [r.campaign]
        ).catch(() => {})
      }
    }

    const totalSent = results.reduce((s, r) => s + r.sent, 0)
    return NextResponse.json({ success: true, totalSent, results })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Sweep failed' }, { status: 500 })
  }
}
