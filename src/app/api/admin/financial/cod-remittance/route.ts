import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, query } from '@/lib/shared/db'
import { generateOrderInvoice } from '@/lib/documents/invoice'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { recordCodSettlement } from '@/lib/payments/razorpay-route'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || 'cod_collected' // cod_pending | cod_collected | paid

  const [orders, allCod] = await Promise.all([
    queryMany(
      `SELECT o.id, o.order_number, o.customer_name, o.customer_email,
              o.total_amount, o.payment_status, o.payment_mode,
              o.delivered_at, o.cod_remitted_at, o.updated_at,
              o.status AS order_status
       FROM orders o
       WHERE o.payment_mode = 'cod'
         AND ($1 = 'all' OR o.payment_status = $1)
       ORDER BY o.delivered_at DESC NULLS LAST, o.updated_at DESC
       LIMIT 500`,
      [status]
    ),
    queryMany(
      `SELECT payment_status, total_amount
       FROM orders
       WHERE payment_mode = 'cod'`,
      []
    ),
  ])

  // Group cod_collected by delivery week
  const weeks: Record<string, { weekLabel: string; weekStart: string; orders: any[]; total: number }> = {}
  for (const o of orders) {
    if (o.payment_status === 'cod_collected' && o.delivered_at) {
      const d = new Date(o.delivered_at)
      // Monday of delivery week
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const mon = new Date(d.setDate(diff))
      const weekStart = mon.toISOString().slice(0, 10)
      if (!weeks[weekStart]) {
        weeks[weekStart] = {
          weekLabel: `Week of ${mon.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
          weekStart,
          orders: [],
          total: 0,
        }
      }
      weeks[weekStart].orders.push(o)
      weeks[weekStart].total += parseFloat(o.total_amount)
    }
  }

  const summary = {
    cod_pending: allCod.filter(o => o.payment_status === 'cod_pending').length,
    cod_collected: allCod.filter(o => o.payment_status === 'cod_collected').length,
    cod_collected_amount: allCod
      .filter(o => o.payment_status === 'cod_collected')
      .reduce((s, o) => s + parseFloat(o.total_amount), 0),
    total_collected_amount: allCod
      .filter(o => ['cod_collected', 'paid'].includes(o.payment_status))
      .reduce((s, o) => s + parseFloat(o.total_amount), 0),
  }

  return NextResponse.json({
    orders,
    weeks: Object.values(weeks).sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    summary,
  })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const { orderIds } = body

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds required' }, { status: 400 })
  }

  const remitted = await query<{ id: string }>(
    `UPDATE orders
     SET payment_status = 'paid', cod_remitted_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::uuid[]) AND payment_mode = 'cod' AND payment_status = 'cod_collected'
     RETURNING id`,
    [orderIds]
  )

  // Now that these COD orders are 'paid', render their invoice PDFs (the number
  // was assigned at processing; generateOrderInvoice was paid-gated until now).
  // Fire-and-forget so remittance never fails on PDF/S3 errors.
  for (const row of remitted.rows) {
    generateOrderInvoice(row.id).catch(() => {})
  }

  // For tenant stores (not the platform's own store), record a COD settlement in
  // the control-plane ledger so the tenant is credited (gross − commission − actual
  // Delhivery charge). Uses the reconciled delhivery_billed_amount when available.
  const tenant = await resolveTenant()
  if (tenant?.tenantId && remitted.rows.length > 0) {
    const { controlPlanePool } = await import('@/lib/tenant-registry')
    const cpRow = await controlPlanePool()
      .query(`SELECT daily_payout FROM tenants WHERE id=$1`, [tenant.tenantId])
      .catch(() => null)
    const dailyPayout = cpRow?.rows[0]?.daily_payout === true
    const settledOrders = await queryMany<{
      order_number: string
      total_amount: string
      delhivery_billed_amount: string | null
      shipping_amount: string | null
      delhivery_billed_at: string | null
    }>(
      `SELECT order_number, total_amount, delhivery_billed_amount, shipping_amount, delhivery_billed_at
       FROM orders WHERE id = ANY($1::uuid[])`,
      [remitted.rows.map(r => r.id)]
    ).catch(() => [])
    for (const o of settledOrders) {
      const actualDelhivery =
        o.delhivery_billed_amount != null ? parseFloat(o.delhivery_billed_amount) : parseFloat(o.shipping_amount ?? '0')
      // `delhivery_billed_at` is only stamped once the wallet debit is durable, so it is the
      // signal that shipping has already been charged. Deducting it here too billed the tenant
      // twice for the same AWB.
      recordCodSettlement({
        tenantId: tenant.tenantId,
        tenantSlug: tenant.slug ?? '',
        orderRef: o.order_number,
        grossAmountInr: parseFloat(o.total_amount),
        actualDelhiveryChargeInr: actualDelhivery,
        dailyPayout,
        walletBilled: o.delhivery_billed_at != null,
      }).catch(() => {})
    }
  }

  return NextResponse.json({ success: true, marked: remitted.rows.length })
}
