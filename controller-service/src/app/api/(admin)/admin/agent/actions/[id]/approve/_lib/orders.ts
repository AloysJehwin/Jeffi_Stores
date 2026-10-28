import { dedicatedOrderTool } from '@/lib/admin-agent/permissions'
import { callInternalApi, type AgentAction, type ActionResult } from './shared'

// Order, payment, refund and cancel actions run through the same endpoints as the admin UI, with
// the approving admin's session, so those endpoints' scope/role checks, rules and side effects apply.

const failure = (r: { status: number; data: any }) =>
  (r.data && typeof r.data === 'object' && r.data.error) ||
  (typeof r.data === 'string' && r.data.trim()) ||
  `Request failed (${r.status})`

async function patchOrderStatus(
  cookieHeader: string,
  p: {
    orderId: string
    orderNumber?: string
    newStatus?: string | null
    paymentStatus?: string | null
    awbNumber?: string | null
    override?: boolean
    overrideReason?: string | null
  }
): Promise<ActionResult> {
  if (!p?.orderId) return { result: null, error: 'orderId missing' }
  // The AWB first, so the shipped notification carries the tracking number.
  if (p.awbNumber && p.newStatus === 'shipped') {
    const a = await callInternalApi(cookieHeader, 'PATCH', `/api/admin/orders/${encodeURIComponent(p.orderId)}`, {
      awb_number: p.awbNumber,
    })
    if (!a.ok) return { result: null, error: `Could not save the AWB: ${failure(a)}` }
  }
  const body: Record<string, unknown> = {}
  if (p.newStatus) body.status = p.newStatus
  if (p.paymentStatus) body.payment_status = p.paymentStatus
  if (p.override) {
    body.override = true
    body.override_reason = p.overrideReason
  }
  const r = await callInternalApi(cookieHeader, 'PATCH', `/api/orders/${encodeURIComponent(p.orderId)}`, body)
  if (!r.ok) return { result: null, error: failure(r) }
  return {
    result: {
      id: p.orderId,
      order_number: p.orderNumber ?? null,
      ...(p.newStatus ? { status: p.newStatus } : {}),
      ...(p.paymentStatus ? { payment_status: p.paymentStatus } : {}),
      ...(p.awbNumber ? { awb_number: p.awbNumber } : {}),
      ...(p.override ? { override: true } : {}),
    },
    error: null,
  }
}

export async function updateOrderStatus(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  return patchOrderStatus(cookieHeader, action.payload)
}

export async function markOrderShipped(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  return patchOrderStatus(cookieHeader, { ...action.payload, newStatus: 'shipped', paymentStatus: null, override: false })
}

export async function setPaymentStatus(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  if (!action.payload?.paymentStatus) return { result: null, error: 'paymentStatus missing' }
  return patchOrderStatus(cookieHeader, { ...action.payload, newStatus: null, awbNumber: null })
}

export async function cancelOrder(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const p = action.payload ?? {}
  if (!p.orderId) return { result: null, error: 'orderId missing' }
  if (p.source === 'offline') {
    const r = await callInternalApi(cookieHeader, 'POST', `/api/admin/orders/${encodeURIComponent(p.orderId)}/cancel`)
    if (!r.ok) return { result: null, error: failure(r) }
    return { result: { id: p.orderId, order_number: p.orderNumber ?? null, status: 'cancelled', ...r.data }, error: null }
  }
  return patchOrderStatus(cookieHeader, { ...p, newStatus: 'cancelled', paymentStatus: null })
}

// Receivables "Mark paid": the payment-status route.
export async function markInvoicePaid(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const { orderId, invoiceNumber, paymentMode, paidAt } = action.payload as {
    orderId: string
    invoiceNumber?: string
    paymentMode: string
    paidAt: string | null
  }
  if (!orderId) return { result: null, error: 'orderId missing' }
  const on = paidAt || new Date().toISOString().slice(0, 10)
  const r = await callInternalApi(cookieHeader, 'PATCH', `/api/admin/orders/${encodeURIComponent(orderId)}/payment-status`, {
    payment_status: 'paid',
    payment_mode: paymentMode,
    note: `Marked paid via ${paymentMode} on ${on} (admin agent)`,
  })
  if (!r.ok) return { result: null, error: failure(r) }
  return { result: { id: orderId, invoice_number: invoiceNumber ?? null, payment_status: 'paid', paymentMode }, error: null }
}

// Order refunds: /api/orders/[id]/refund. Refunds owed for approved changes: the adjustment refund route.
export async function refundOrder(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const p = action.payload ?? {}
  if (!p.orderId || !p.method) return { result: null, error: 'orderId and method are required' }
  const external = p.method === 'razorpay' ? null : { method: p.method, reference: p.reference ?? '', note: [p.reason, p.notes].filter(Boolean).join(' — ') }
  const orderPath = encodeURIComponent(p.orderId)
  const r = p.adjustmentId
    ? await callInternalApi(
        cookieHeader,
        'POST',
        `/api/admin/orders/${orderPath}/adjustments/${encodeURIComponent(p.adjustmentId)}/refund${p.legacy ? '?legacy=1' : ''}`,
        external ? { external } : {}
      )
    : await callInternalApi(
        cookieHeader,
        'POST',
        `/api/orders/${orderPath}/refund`,
        external
          ? { external, amount: p.amount, notify: p.notify !== false, reason: p.reason }
          : { reason: p.reason }
      )
  if (!r.ok) return { result: null, error: failure(r) }
  return { result: { id: p.orderId, order_number: p.orderNumber ?? null, method: p.method, ...r.data }, error: null }
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
  const dedicated = dedicatedOrderTool(method, path, body)
  if (dedicated) {
    return { result: null, error: `Order changes go through ${dedicated}, not the generic admin API. Ask the agent to use that tool.` }
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
