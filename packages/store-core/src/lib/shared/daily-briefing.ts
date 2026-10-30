import { queryMany, queryOne } from '@/lib/shared/db'
import { aiChat, AiClientError } from '@/lib/shared/ai-client'
import { mailShell, escapeHtml } from '@/lib/shared/mail-template'
import { NEEDS_SHIP_SQL } from '@/lib/overviews/orders'
import { defaultOpsEmail, OPS_SECTIONS, sectionOn, type OpsEmailConfig, type OpsSection } from '@/lib/shared/ops-email-config'

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

export interface WaitingOrder {
  id: string
  order_number: string
  customer_name: string | null
  age_days: number
  total_amount: number
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
  /** Confirmed / packing orders not shipped yet, oldest first (up to 100, for the attachments). */
  to_ship?: { count: number; late: number; late_days: number; orders: WaitingOrder[] }
  pending_payments?: WaitingOrder[]
  support?: { open: number; awaiting_admin: number }
}

const DAY_MS = 24 * 3600 * 1000
const istDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
/** Today's date in India, YYYY-MM-DD. */
export const istToday = (now = new Date()) => istDate(now)
/** The hour (0-23) in India. */
export const istHour = (now = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now))

const none = <T,>(v: T) => Promise.resolve(v)

/** The numbers for the sections that are on (yesterday's totals always, for the subject and headline). */
export async function collectBriefingData(cfg: OpsEmailConfig = defaultOpsEmail(true)): Promise<BriefingData> {
  const top = sectionOn(cfg, 'top_products')
  const low = sectionOn(cfg, 'low_stock')
  const stuck = sectionOn(cfg, 'stuck')
  const toShip = sectionOn(cfg, 'to_ship')
  const pending = sectionOn(cfg, 'pending_payments')
  const lateDays = toShip?.days ?? 2
  const [yesterday, sevenDayAvg, abandonedCheckouts, topProducts, lowStock, stuckShipments, campaignPerf, shipRows, pendingRows, support] =
    await Promise.all([
      queryOne<{
        count: string
        paid_count: string
        cancelled_count: string
        pending_count: string
        revenue: string
        avg_order_value: string
      }>(
        `
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
    `,
        []
      ),
      queryOne<{ avg_revenue: string; avg_orders: string }>(
        `
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
    `,
        []
      ),
      sectionOn(cfg, 'abandoned')
        ? queryOne<{ count: string }>(
            `
      SELECT COUNT(*)::text AS count
      FROM orders
      WHERE status = 'cancelled' AND payment_status = 'cancelled'
        AND updated_at >= NOW() - INTERVAL '24 hours'
    `,
            []
          )
        : none(null),
      top
        ? queryMany<{ product_id: string; product_name: string; qty: string; revenue: string }>(
            `
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
      LIMIT $1
    `,
            [top.limit ?? 5]
          )
        : none([]),
      low
        ? queryMany<LowStockProduct>(
            `
      SELECT id::text, name, sku, inventory_quantity
      FROM products
      WHERE is_active = TRUE AND is_digital = FALSE AND inventory_quantity <= $1
      ORDER BY inventory_quantity ASC, name ASC
      LIMIT $2
    `,
            [low.threshold ?? 10, low.limit ?? 15]
          )
        : none([]),
      stuck
        ? queryMany<{
            order_number: string
            awb_number: string | null
            shipped_at: string
            customer_name: string | null
            total_amount: string
            days_since_shipped: string
          }>(
            `
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
        AND shipped_at < NOW() - make_interval(days => $1::int)
        AND delivered_at IS NULL
      ORDER BY shipped_at ASC
      LIMIT 20
    `,
            [stuck.days ?? 3]
          )
        : none([]),
      sectionOn(cfg, 'campaigns')
        ? queryMany<{ campaign_kind: string; sent: string; opened: string; clicked: string; converted: string }>(
            `
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
    `,
            []
          )
        : none([]),
      toShip || cfg.attachments.labels || cfg.attachments.slips || cfg.attachments.invoices
        ? queryMany<{ id: string; order_number: string; customer_name: string | null; age_days: string; total_amount: string; total: string; late: string }>(
            `
      SELECT o.id::text, o.order_number, o.customer_name, o.total_amount::text,
             EXTRACT(DAY FROM NOW() - COALESCE(o.confirmed_at, o.created_at))::text AS age_days,
             COUNT(*) OVER ()::text AS total,
             COUNT(*) FILTER (WHERE COALESCE(o.confirmed_at, o.created_at) < NOW() - make_interval(days => $1::int)) OVER ()::text AS late
      FROM orders o
      WHERE o.status IN ('confirmed', 'processing') AND o.shipped_at IS NULL AND ${NEEDS_SHIP_SQL}
      ORDER BY COALESCE(o.confirmed_at, o.created_at) ASC
      LIMIT 100
    `,
            [lateDays]
          )
        : none([]),
      pending
        ? queryMany<{ id: string; order_number: string; customer_name: string | null; age_days: string; total_amount: string }>(
            `
      SELECT id::text, order_number, customer_name, total_amount::text, EXTRACT(DAY FROM NOW() - created_at)::text AS age_days
      FROM orders
      WHERE COALESCE(payment_status, 'pending') IN ('pending', 'failed') AND status NOT IN ('cancelled', 'draft')
        AND created_at >= NOW() - make_interval(days => $1::int)
      ORDER BY created_at DESC
      LIMIT 20
    `,
            [pending.days ?? 3]
          )
        : none([]),
      sectionOn(cfg, 'support')
        ? queryOne<{ open: string; awaiting_admin: string }>(
            `
      SELECT (SELECT COUNT(*) FROM support_sessions WHERE status = 'open')::text AS open,
             (SELECT COUNT(*) FROM support_ai_actions WHERE status = 'pending' AND awaiting = 'admin')::text AS awaiting_admin
    `,
            []
          )
        : none(null),
    ])

  const y = yesterday || {
    count: '0',
    paid_count: '0',
    cancelled_count: '0',
    pending_count: '0',
    revenue: '0',
    avg_order_value: '0',
  }
  const avg = sevenDayAvg || { avg_revenue: '0', avg_orders: '0' }

  const yesterdayRevenue = parseFloat(y.revenue) || 0
  const yesterdayOrders = parseInt(y.count, 10) || 0
  const avgRevenue = parseFloat(avg.avg_revenue) || 0
  const avgOrders = parseFloat(avg.avg_orders) || 0

  const revenuePctDelta = avgRevenue > 0 ? Math.round(((yesterdayRevenue - avgRevenue) / avgRevenue) * 100) : 0
  const ordersPctDelta = avgOrders > 0 ? Math.round(((yesterdayOrders - avgOrders) / avgOrders) * 100) : 0
  const waiting = (r: { id: string; order_number: string; customer_name: string | null; age_days: string; total_amount: string }): WaitingOrder => ({
    id: r.id,
    order_number: r.order_number,
    customer_name: r.customer_name,
    age_days: parseInt(r.age_days, 10) || 0,
    total_amount: parseFloat(r.total_amount) || 0,
  })

  return {
    briefing_date: istDate(new Date(Date.now() - DAY_MS)),
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
    to_ship: {
      count: parseInt(shipRows[0]?.total ?? '0', 10) || 0,
      late: parseInt(shipRows[0]?.late ?? '0', 10) || 0,
      late_days: lateDays,
      orders: shipRows.map(waiting),
    },
    pending_payments: pendingRows.map(waiting),
    support: support ? { open: parseInt(support.open, 10) || 0, awaiting_admin: parseInt(support.awaiting_admin, 10) || 0 } : undefined,
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
    ...(data.to_ship ? { orders_to_ship: data.to_ship.count, orders_late_to_ship: data.to_ship.late } : {}),
    ...(data.pending_payments?.length ? { unpaid_orders: data.pending_payments.length } : {}),
    ...(data.support ? { open_support_chats: data.support.open, replies_waiting_for_admin: data.support.awaiting_admin } : {}),
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
          content: `You are a no-fluff business analyst writing the headline for a daily ops briefing. Given the numbers, write 2-3 short sentences highlighting the most important thing. Specific and concrete. No marketing speak, no encouragement, no "great work team" filler. If revenue is below average, say so. If stuck shipments or late orders to ship need action, say so. If everything is normal, say "Numbers in line with the 7-day average." Plain text only, no markdown.`,
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

const BRIEFING_CSS = `
  .section { margin: 24px 0 10px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; }
  .kpi-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .kpi-value { font-size: 28px; font-weight: 700; color: #111827; }
  .kpi-note { font-size: 13px; color: #6b7280; }
  table.rows th { font-size: 11px; }
  table.rows td { font-size: 13px; }
  table.rows .num { text-align: right; }
  .grey { color: #6b7280; }
  .red { color: #dc2626; }
  .green { color: #16a34a; }
`

function fmtINR(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

const e = (v: unknown) => escapeHtml(v ?? '')

function deltaBadge(pct: number): string {
  if (pct === 0) return ''
  const positive = pct > 0
  const color = positive ? '#16a34a' : '#dc2626'
  const arrow = positive ? '▲' : '▼'
  return `<span style="color:${color};font-size:13px;font-weight:600;margin-left:8px;">${arrow} ${Math.abs(pct)}%</span>`
}

export interface BriefingContext {
  cfg?: OpsEmailConfig
  brand?: string
  /** The admin panel's base URL, for links. */
  adminUrl?: string
  /** A line about the attached documents, or why they were left out. */
  attachmentNote?: string
}

/** Fills {store} {date} {orders} {revenue} in the configured subject. */
export function briefingSubject(template: string, data: BriefingData, brand: string): string {
  const v: Record<string, string> = { store: brand, date: data.briefing_date, orders: String(data.yesterday.count), revenue: fmtINR(data.yesterday.revenue) }
  return template.replace(/\{(store|date|orders|revenue)\}/g, (_, k: string) => v[k]).replace(/\s+/g, ' ').trim()
}

const table = (head: string, rows: string) => `<table class="rows"><tr>${head}</tr>${rows}</table>`
const heading = (text: string, color?: string) => `<h3 class="section"${color ? ` style="color:${color};"` : ''}>${text}</h3>`

function section(s: OpsSection, data: BriefingData, narration: string, link: (path: string) => string): string {
  switch (s.id) {
    case 'ai_headline':
      return narration ? `<div class="info"><p style="margin:0;">${e(narration)}</p></div>` : ''
    case 'kpis':
      return `${heading('Yesterday')}
      <div class="card">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:0 12px 0 0;width:50%;">
              <div class="kpi-label">Revenue</div>
              <div class="kpi-value">${fmtINR(data.yesterday.revenue)}${deltaBadge(data.delta_vs_avg.revenue_pct)}</div>
            </td>
            <td style="padding:0 0 0 12px;width:50%;">
              <div class="kpi-label">Orders</div>
              <div class="kpi-value">${data.yesterday.count}${deltaBadge(data.delta_vs_avg.orders_pct)}</div>
            </td>
          </tr>
          <tr>
            <td class="kpi-note" style="padding:14px 12px 0 0;">
              <span style="color:#16a34a;font-weight:600;">${data.yesterday.paid_count} paid</span> ·
              <span style="color:#dc2626;">${data.yesterday.cancelled_count} cancelled</span> ·
              <span>${data.yesterday.pending_count} pending</span>
            </td>
            <td class="kpi-note" style="padding:14px 0 0 12px;">
              AOV: <span style="font-weight:600;color:#111827;">${fmtINR(data.yesterday.avg_order_value)}</span>
            </td>
          </tr>
        </table>
      </div>`
    case 'to_ship': {
      const t = data.to_ship
      if (!t?.count) return ''
      const rows = t.orders
        .slice(0, 20)
        .map(o => `<tr><td class="mono">${e(o.order_number)}</td><td>${e(o.customer_name || '—')}</td><td class="${o.age_days >= t.late_days ? 'red' : 'grey'}">${o.age_days}d</td><td class="num">${fmtINR(o.total_amount)}</td></tr>`)
        .join('')
      const more = t.count > 20 ? `<p class="muted">and ${t.count - 20} more. <a href="${link('/packing-slips')}">Open Packing slips</a></p>` : ''
      return `${heading(`To ship (${t.count}${t.late ? `, ${t.late} late` : ''})`, t.late ? '#dc2626' : undefined)}${table('<th>Order</th><th>Customer</th><th>Waiting</th><th class="num">Total</th>', rows)}${more}`
    }
    case 'stuck': {
      if (!data.stuck_shipments.length) return ''
      const rows = data.stuck_shipments
        .map(x => `<tr><td class="mono">${e(x.order_number)}</td><td>${e(x.customer_name || '—')}</td><td class="red">${x.days_since_shipped}d</td><td class="num">${fmtINR(x.total_amount)}</td></tr>`)
        .join('')
      return `${heading(`Stuck shipments (${data.stuck_shipments.length})`, '#dc2626')}${table('<th>Order</th><th>Customer</th><th>Stuck</th><th class="num">Total</th>', rows)}`
    }
    case 'pending_payments': {
      const p = data.pending_payments ?? []
      if (!p.length) return ''
      const rows = p.map(o => `<tr><td class="mono">${e(o.order_number)}</td><td>${e(o.customer_name || '—')}</td><td class="grey">${o.age_days}d</td><td class="num">${fmtINR(o.total_amount)}</td></tr>`).join('')
      return `${heading(`Pending payments (${p.length})`, '#ea580c')}${table('<th>Order</th><th>Customer</th><th>Age</th><th class="num">Total</th>', rows)}`
    }
    case 'top_products': {
      if (!data.top_products.length) return ''
      const rows = data.top_products
        .map((p, i) => `<tr><td class="grey" style="width:24px;">${i + 1}</td><td>${e(p.product_name)}</td><td class="num grey">${p.qty}</td><td class="num" style="font-weight:600;">${fmtINR(p.revenue)}</td></tr>`)
        .join('')
      return `${heading('Top products yesterday')}${table('<th style="width:24px;"></th><th>Product</th><th class="num">Qty</th><th class="num">Revenue</th>', rows)}`
    }
    case 'low_stock': {
      if (!data.low_stock.length) return ''
      const rows = data.low_stock
        .map(p => `<tr><td>${e(p.name)}</td><td class="mono grey" style="font-size:12px;">${e(p.sku || '—')}</td><td class="num" style="color:${p.inventory_quantity === 0 ? '#dc2626' : '#ea580c'};font-weight:600;">${p.inventory_quantity}</td></tr>`)
        .join('')
      return `${heading(`Low stock (${data.low_stock.length})`, '#ea580c')}${table('<th>Product</th><th>SKU</th><th class="num">Stock</th>', rows)}`
    }
    case 'abandoned':
      return `<p class="muted">Abandoned checkouts (24h): <span style="color:#1f2937;font-weight:600;">${data.abandoned_checkouts_24h}</span></p>`
    case 'campaigns': {
      if (!data.campaign_perf_24h.length) return ''
      const rows = data.campaign_perf_24h
        .map(c => {
          const openRate = c.sent > 0 ? Math.round((c.opened / c.sent) * 100) : 0
          const clickRate = c.sent > 0 ? Math.round((c.clicked / c.sent) * 100) : 0
          return `<tr><td>${e(c.campaign_kind)}</td><td class="num">${c.sent}</td><td class="num grey">${openRate}%</td><td class="num grey">${clickRate}%</td><td class="num green">${c.converted}</td></tr>`
        })
        .join('')
      return `${heading('Campaigns (last 24h)')}${table('<th>Campaign</th><th class="num">Sent</th><th class="num">Open%</th><th class="num">Click%</th><th class="num">Conv</th>', rows)}`
    }
    case 'support': {
      const s2 = data.support
      if (!s2 || (!s2.open && !s2.awaiting_admin)) return ''
      return `${heading('Support')}<p>${s2.open} open chat${s2.open === 1 ? '' : 's'} · ${s2.awaiting_admin} customer repl${s2.awaiting_admin === 1 ? 'y' : 'ies'} waiting for an admin. <a href="${link('/support')}">Open Support</a></p>`
    }
  }
}

export function renderBriefingEmail(data: BriefingData, narration: string, ctx: BriefingContext = {}): { subject: string; html: string } {
  const cfg = ctx.cfg ?? defaultOpsEmail(true)
  const brand = ctx.brand || 'Store'
  // The admin host serves its pages at the root, so a base ending in /admin must lose it.
  const base = (ctx.adminUrl || '').replace(/\/admin\/?$/, '').replace(/\/$/, '')
  const link = (path: string) => e(`${base}${path}`)
  const subject = briefingSubject(cfg.subject, data, brand)
  const body = cfg.sections
    .filter(s => s.on && s.id in OPS_SECTIONS)
    .map(s => section(s, data, narration, link))
    .filter(Boolean)
    .join('\n')

  const html = mailShell({
    brand,
    kicker: 'Daily Ops Briefing',
    title: data.briefing_date,
    documentTitle: subject,
    extraCss: BRIEFING_CSS,
    content: `
      ${cfg.intro ? `<p>${e(cfg.intro).replace(/\n/g, '<br>')}</p>` : ''}
      ${body}
      ${ctx.attachmentNote ? `<p class="muted">${e(ctx.attachmentNote)}</p>` : ''}
      ${base ? `<p class="muted" style="text-align:center;margin-top:24px;"><a href="${link('/')}" style="color:#2563eb;text-decoration:none;">Open admin →</a></p>` : ''}`,
  })

  return { subject, html }
}

export async function briefingFromAsync(): Promise<string> {
  const { currentBrandNameAsync } = await import('@/lib/catalog/brand')
  const brand = await currentBrandNameAsync()
  return `"${brand.replace(/"/g, '')} Ops" <${process.env.SES_FROM_EMAIL || 'ops@jeffistores.in'}>`
}
