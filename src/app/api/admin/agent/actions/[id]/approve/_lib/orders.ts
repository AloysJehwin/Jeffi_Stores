import { queryOne } from '@/lib/db'
import type { AgentAction, ActionResult } from './shared'

export async function markOrderShipped(action: AgentAction): Promise<ActionResult> {
  const { orderId, awbNumber } = action.payload
  const updated = await queryOne(
    `UPDATE orders
       SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW()),
           awb_number = COALESCE($2, awb_number), updated_at = NOW()
       WHERE id = $1::uuid AND status NOT IN ('shipped','delivered','cancelled')
       RETURNING id::text, order_number, status, awb_number`,
    [orderId, awbNumber || null]
  )
  if (!updated) return { result: null, error: 'Order not found or already shipped/delivered/cancelled' }
  return { result: updated, error: null }
}

export async function callAdminApi(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const { method, path, body } = action.payload as { method: string; path: string; body: string | null }
  const FORBIDDEN_PATH_RE = /^\/api\/admin\/(agent\/|team\b|admins\b|auth\b|settings\/admins)/
  if (!path?.startsWith('/api/admin/') || FORBIDDEN_PATH_RE.test(path)) {
    return { result: null, error: 'Path not permitted at execution time' }
  }
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return { result: null, error: 'Method not permitted at execution time' }
  }
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`
  const url = new URL(path, origin).toString()
  try {
    const res = await fetch(url, {
      method,
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      body: body || undefined,
    })
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      parsed = await res.text().catch(() => null)
    }
    return {
      result: { method, path, status: res.status, ok: res.ok, body: parsed },
      error: res.ok ? null : `Upstream returned ${res.status}`,
    }
  } catch (err: any) {
    return { result: null, error: String(err?.message || 'API call failed') }
  }
}

export async function markInvoicePaid(action: AgentAction): Promise<ActionResult> {
  const { orderId, paymentMode, paidAt } = action.payload as {
    orderId: string
    paymentMode: string
    paidAt: string | null
  }
  const updated = await queryOne<{
    id: string
    invoice_number: string
    payment_status: string
    invoice_date: string | null
  }>(
    `UPDATE orders
        SET payment_status = 'paid',
            invoice_date = COALESCE($2::date, invoice_date),
            notes = COALESCE(notes, '') ||
                    CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END ||
                    'Marked paid via ' || $3 || ' on ' || COALESCE($2::text, CURRENT_DATE::text),
            updated_at = NOW()
      WHERE id = $1::uuid AND invoice_number IS NOT NULL
        AND payment_status NOT IN ('paid','refunded')
      RETURNING id::text, invoice_number, payment_status, invoice_date`,
    [orderId, paidAt || null, paymentMode]
  )
  if (!updated) return { result: null, error: 'Invoice not found, already paid, or refunded' }
  return { result: { ...updated, paymentMode }, error: null }
}

export async function updateOrderStatus(action: AgentAction): Promise<ActionResult> {
  const { orderId, newStatus, awbNumber } = action.payload as {
    orderId: string
    newStatus: string
    awbNumber: string | null
  }
  const ALLOWED = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
  if (!ALLOWED.includes(newStatus)) return { result: null, error: 'Invalid status' }
  const tsCol =
    newStatus === 'confirmed'
      ? 'confirmed_at'
      : newStatus === 'shipped'
        ? 'shipped_at'
        : newStatus === 'delivered'
          ? 'delivered_at'
          : newStatus === 'cancelled'
            ? 'cancelled_at'
            : null
  const setParts = [`status = $2`, `updated_at = NOW()`]
  const params: any[] = [orderId, newStatus]
  if (tsCol) setParts.push(`${tsCol} = COALESCE(${tsCol}, NOW())`)
  if (newStatus === 'shipped' && awbNumber) {
    params.push(awbNumber)
    setParts.push(`awb_number = COALESCE(awb_number, $${params.length})`)
  }
  const updated = await queryOne(
    `UPDATE orders SET ${setParts.join(', ')} WHERE id = $1::uuid RETURNING id::text, order_number, status, awb_number`,
    params
  )
  if (!updated) return { result: null, error: 'Order not found' }
  return { result: updated, error: null }
}
