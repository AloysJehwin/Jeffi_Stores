import { queryMany, queryOne } from './db'
import { aiChat, AiClientError } from './ai-client'

export interface OrderSummary {
  count: number
  paid_count: number
  cancelled_count: number
  pending_count: number
  revenue: number
  avg_order_value: number
}

export interface TopProduct {
  product_id: string
  product_name: string
  qty: number
  revenue: number
}

export interface LowStockProduct {
  id: string
  name: string
  sku: string | null
  inventory_quantity: number
}

export interface StuckShipment {
  order_number: string
  awb_number: string | null
  shipped_at: string
  customer_name: string | null
  total_amount: number
  days_since_shipped: number
}

export interface CampaignPerf {
  campaign_kind: string
  sent: number
  opened: number
  clicked: number
  converted: number
}

export interface BriefingData {
  briefing_date: string
  yesterday: OrderSummary
  delta_vs_avg: { revenue_pct: number; orders_pct: number }
  top_products: TopProduct[]
  low_stock: LowStockProduct[]
  stuck_shipments: StuckShipment[]
  abandoned_checkouts_24h: number
  campaign_perf_24h: CampaignPerf[]
}

const STUCK_DAYS = 3

export async function collectBriefingData(): Promise<BriefingData> {
  const [
    yesterday,
    sevenDayAvg,
    topProducts,
    lowStock,
    stuckShipments,
    abandonedCheckouts,
    campaignPerf,
  ] = await Promise.all([
    queryOne<{
      count: string; paid_count: string; cancelled_count: string; pending_count: string
      revenue: string; avg_order_value: string
    }>(`
      WITH bounds AS (
        SELECT
          (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata' AS lo,
           date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata')                    AT TIME ZONE 'Asia/Kolkata' AS hi
      )
      SELECT
        COUNT(*)::text AS count,
        COUNT(*) FILTER (WHERE payment_status = 'paid')::text AS paid_count,
        COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled_count,
        COUNT(*) FILTER (WHERE status = 'pending' AND payment_status != 'paid')::text AS pending_count,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0)::text AS revenue,
        COALESCE(AVG(total_amount) FILTER (WHERE payment_status = 'paid'), 0)::text AS avg_order_value
      FROM orders, bounds
      WHERE created_at >= bounds.lo AND created_at < bounds.hi
    `, []),
    queryOne<{ avg_revenue: string; avg_orders: string }>(`
      WITH bounds AS (
        SELECT
          (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '8 days') AT TIME ZONE 'Asia/Kolkata' AS lo,
          (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day')  AT TIME ZONE 'Asia/Kolkata' AS hi
      ),
      daily AS (
        SELECT
          ((created_at AT TIME ZONE 'Asia/Kolkata')::date) AS d,
          SUM(total_amount) FILTER (WHERE payment_status = 'paid') AS revenue,
          COUNT(*) AS orders
        FROM orders, bounds
        WHERE created_at >= bounds.lo AND created_at < bounds.hi
        GROUP BY 1
      )
      SELECT
        COALESCE(AVG(revenue), 0)::text AS avg_revenue,
        COALESCE(AVG(orders),  0)::text AS avg_orders
      FROM daily
    `, []),
    queryMany<{ product_id: string; product_name: string; qty: string; revenue: string }>(`
      WITH bounds AS (
        SELECT
          (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata' AS lo,
           date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata')                    AT TIME ZONE 'Asia/Kolkata' AS hi
      )
      SELECT
        oi.product_id::text,
        oi.product_name,
        SUM(oi.quantity)::text AS qty,
        SUM(oi.total_price)::text AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id, bounds
      WHERE o.payment_status = 'paid'
        AND o.created_at >= bounds.lo AND o.created_at < bounds.hi
      GROUP BY oi.product_id, oi.product_name
      ORDER BY SUM(oi.total_price) DESC
      LIMIT 5
    `, []),
    queryMany<LowStockProduct>(`
      SELECT id::text, name, sku, inventory_quantity
      FROM products
      WHERE is_active = TRUE AND inventory_quantity <= 10
      ORDER BY inventory_quantity ASC, name ASC
      LIMIT 15
    `, []),
    queryMany<{
      order_number: string; awb_number: string | null; shipped_at: string
      customer_name: string | null; total_amount: string; days_since_shipped: string
    }>(`
      SELECT
        order_number,
        awb_number,
        shipped_at::text,
        customer_name,
        total_amount::text,
        EXTRACT(DAY FROM NOW() - shipped_at)::text AS days_since_shipped
      FROM orders
      WHERE status = 'shipped'
        AND shipped_at IS NOT NULL
        AND shipped_at < NOW() - INTERVAL '${STUCK_DAYS} days'
        AND delivered_at IS NULL
        AND status != 'cancelled'
      ORDER BY shipped_at ASC
      LIMIT 20
    `, []),
    queryOne<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM orders
      WHERE status = 'cancelled' AND payment_status = 'cancelled'
        AND updated_at >= NOW() - INTERVAL '24 hours'
    `, []),
    queryMany<{ campaign_kind: string; sent: string; opened: string; clicked: string; converted: string }>(`
      SELECT
        campaign_kind,
        COUNT(*)::text AS sent,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::text AS opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::text AS clicked,
        COUNT(*) FILTER (WHERE converted_at IS NOT NULL)::text AS converted
      FROM email_campaigns_sent
      WHERE sent_at >= NOW() - INTERVAL '24 hours'
      GROUP BY campaign_kind
      ORDER BY COUNT(*) DESC
    `, []),
  ])

  const y = yesterday || { count: '0', paid_count: '0', cancelled_count: '0', pending_count: '0', revenue: '0', avg_order_value: '0' }
  const avg = sevenDayAvg || { avg_revenue: '0', avg_orders: '0' }

  const yesterdayRevenue = parseFloat(y.revenue) || 0
  const yesterdayOrders = parseInt(y.count, 10) || 0
  const avgRevenue = parseFloat(avg.avg_revenue) || 0
  const avgOrders = parseFloat(avg.avg_orders) || 0

  const revenuePctDelta = avgRevenue > 0 ? Math.round(((yesterdayRevenue - avgRevenue) / avgRevenue) * 100) : 0
  const ordersPctDelta = avgOrders > 0 ? Math.round(((yesterdayOrders - avgOrders) / avgOrders) * 100) : 0

  const istYesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)

  return {
    briefing_date: istYesterday,
    yesterday: {
      count: yesterdayOrders,
      paid_count: parseInt(y.paid_count, 10) || 0,
      cancelled_count: parseInt(y.cancelled_count, 10) || 0,
      pending_count: parseInt(y.pending_count, 10) || 0,
      revenue: yesterdayRevenue,
      avg_order_value: parseFloat(y.avg_order_value) || 0,
    },
    delta_vs_avg: { revenue_pct: revenuePctDelta, orders_pct: ordersPctDelta },
    top_products: topProducts.map(p => ({
      product_id: p.product_id,
      product_name: p.product_name,
      qty: parseFloat(p.qty),
      revenue: parseFloat(p.revenue),
    })),
    low_stock: lowStock,
    stuck_shipments: stuckShipments.map(s => ({
      order_number: s.order_number,
      awb_number: s.awb_number,
      shipped_at: s.shipped_at,
      customer_name: s.customer_name,
      total_amount: parseFloat(s.total_amount),
      days_since_shipped: parseInt(s.days_since_shipped, 10) || 0,
    })),
    abandoned_checkouts_24h: parseInt(abandonedCheckouts?.count || '0', 10),
    campaign_perf_24h: campaignPerf.map(c => ({
      campaign_kind: c.campaign_kind,
      sent: parseInt(c.sent, 10),
      opened: parseInt(c.opened, 10),
      clicked: parseInt(c.clicked, 10),
      converted: parseInt(c.converted, 10),
    })),
  }
}

export async function narrate(data: BriefingData): Promise<string> {
  const summary = {
    yesterday_revenue: Math.round(data.yesterday.revenue),
    yesterday_orders: data.yesterday.count,
    revenue_vs_7day_avg_pct: data.delta_vs_avg.revenue_pct,
    orders_vs_7day_avg_pct: data.delta_vs_avg.orders_pct,
    cancelled_orders: data.yesterday.cancelled_count,
    abandoned_checkouts: data.abandoned_checkouts_24h,
    low_stock_items: data.low_stock.length,
    stuck_shipments: data.stuck_shipments.length,
    top_product: data.top_products[0]?.product_name ?? 'none',
  }

  try {
    const r = await aiChat({
      modelHint: 'copy',
      jsonMode: false,
      temperature: 0.3,
      maxTokens: 220,
      messages: [
        {
          role: 'system',
          content: `You are a no-fluff business analyst writing the headline for a daily ops briefing. Given the numbers, write 2-3 short sentences highlighting the most important thing. Specific and concrete. No marketing speak, no encouragement, no "great work team" filler. If revenue is below average, say so. If stuck shipments need action, say so. If everything is normal, say "Numbers in line with the 7-day average." Plain text only, no markdown.`,
        },
        { role: 'user', content: `Yesterday's data: ${JSON.stringify(summary)}` },
      ],
    })
    return r.content.trim().slice(0, 600)
  } catch (err) {
    if (err instanceof AiClientError) return ''
    return ''
  }
}

const FROM = `"Jeffi Store's Ops" <${process.env.SES_FROM_EMAIL || 'ops@jeffistores.in'}>`
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'
const ADMIN_URL = process.env.ADMIN_BASE_URL || 'https://admin.jeffistores.in'

function fmtINR(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function deltaBadge(pct: number): string {
  if (pct === 0) return ''
  const positive = pct > 0
  const color = positive ? '#16a34a' : '#dc2626'
  const arrow = positive ? '▲' : '▼'
  return `<span style="color:${color};font-size:13px;font-weight:600;margin-left:8px;">${arrow} ${Math.abs(pct)}%</span>`
}

export function renderBriefingEmail(data: BriefingData, narration: string): { subject: string; html: string } {
  const subject = `Ops briefing — ${data.briefing_date} — ${data.yesterday.count} orders, ${fmtINR(data.yesterday.revenue)}`

  const stuckRows = data.stuck_shipments.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:13px;">${s.order_number}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${s.customer_name || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#dc2626;">${s.days_since_shipped}d</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${fmtINR(s.total_amount)}</td>
    </tr>`).join('')

  const topProductRows = data.top_products.map((p, i) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:24px;">${i + 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${p.product_name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:#6b7280;">${p.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600;">${fmtINR(p.revenue)}</td>
    </tr>`).join('')

  const lowStockRows = data.low_stock.map(p => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${p.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;font-family:ui-monospace,monospace;color:#6b7280;">${p.sku || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:${p.inventory_quantity === 0 ? '#dc2626' : '#ea580c'};font-weight:600;">${p.inventory_quantity}</td>
    </tr>`).join('')

  const campaignRows = data.campaign_perf_24h.map(c => {
    const openRate = c.sent > 0 ? Math.round((c.opened / c.sent) * 100) : 0
    const clickRate = c.sent > 0 ? Math.round((c.clicked / c.sent) * 100) : 0
    return `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${c.campaign_kind}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${c.sent}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:#6b7280;">${openRate}%</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:#6b7280;">${clickRate}%</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:#16a34a;">${c.converted}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
      <tr><td style="background:#1a3a4a;padding:18px 28px;border-radius:8px 8px 0 0;">
        <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.5px;">JEFFI STORE'S — DAILY OPS BRIEFING</span>
        <span style="color:#9ca3af;font-size:13px;float:right;">${data.briefing_date}</span>
      </td></tr>

      ${narration ? `
      <tr><td style="background:#fff7ed;padding:14px 28px;border-left:3px solid #e07b3f;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:#1f2937;">${narration}</p>
      </td></tr>` : ''}

      <tr><td style="background:#ffffff;padding:24px 28px;">
        <h2 style="margin:0 0 14px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Yesterday</h2>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:0 12px 0 0;width:50%;">
              <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Revenue</div>
              <div style="font-size:28px;font-weight:700;color:#111827;">${fmtINR(data.yesterday.revenue)}${deltaBadge(data.delta_vs_avg.revenue_pct)}</div>
            </td>
            <td style="padding:0 0 0 12px;width:50%;">
              <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Orders</div>
              <div style="font-size:28px;font-weight:700;color:#111827;">${data.yesterday.count}${deltaBadge(data.delta_vs_avg.orders_pct)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 12px 0 0;font-size:13px;color:#6b7280;">
              <span style="color:#16a34a;font-weight:600;">${data.yesterday.paid_count} paid</span> ·
              <span style="color:#dc2626;">${data.yesterday.cancelled_count} cancelled</span> ·
              <span>${data.yesterday.pending_count} pending</span>
            </td>
            <td style="padding:14px 0 0 12px;font-size:13px;color:#6b7280;">
              AOV: <span style="font-weight:600;color:#111827;">${fmtINR(data.yesterday.avg_order_value)}</span>
            </td>
          </tr>
        </table>
      </td></tr>

      ${data.stuck_shipments.length > 0 ? `
      <tr><td style="background:#ffffff;padding:0 28px 24px;">
        <h2 style="margin:0 0 10px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#dc2626;">Stuck shipments (${data.stuck_shipments.length})</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <tr style="background:#f9fafb;"><th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Order</th><th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Customer</th><th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Stuck</th><th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Total</th></tr>
          ${stuckRows}
        </table>
      </td></tr>` : ''}

      ${data.top_products.length > 0 ? `
      <tr><td style="background:#ffffff;padding:0 28px 24px;">
        <h2 style="margin:0 0 10px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Top products yesterday</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <tr style="background:#f9fafb;"><th style="padding:8px 12px;font-size:11px;color:#6b7280;font-weight:600;width:24px;"></th><th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Product</th><th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Qty</th><th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Revenue</th></tr>
          ${topProductRows}
        </table>
      </td></tr>` : ''}

      ${data.low_stock.length > 0 ? `
      <tr><td style="background:#ffffff;padding:0 28px 24px;">
        <h2 style="margin:0 0 10px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#ea580c;">Low stock (${data.low_stock.length})</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <tr style="background:#f9fafb;"><th style="padding:6px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Product</th><th style="padding:6px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">SKU</th><th style="padding:6px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Stock</th></tr>
          ${lowStockRows}
        </table>
      </td></tr>` : ''}

      ${data.campaign_perf_24h.length > 0 ? `
      <tr><td style="background:#ffffff;padding:0 28px 24px;">
        <h2 style="margin:0 0 10px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Campaigns (last 24h)</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <tr style="background:#f9fafb;"><th style="padding:6px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Campaign</th><th style="padding:6px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Sent</th><th style="padding:6px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Open%</th><th style="padding:6px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Click%</th><th style="padding:6px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;">Conv</th></tr>
          ${campaignRows}
        </table>
      </td></tr>` : ''}

      <tr><td style="background:#ffffff;padding:0 28px 24px;border-radius:0 0 8px 8px;">
        <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
          Abandoned checkouts (24h): <span style="color:#1f2937;font-weight:600;">${data.abandoned_checkouts_24h}</span>
          &nbsp;·&nbsp;
          <a href="${ADMIN_URL}/admin" style="color:#e07b3f;text-decoration:none;">Open admin →</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`

  return { subject, html }
}

export { FROM as BRIEFING_FROM }
