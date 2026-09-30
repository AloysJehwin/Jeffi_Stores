import { callInternalApi, APPROVE_ORIGIN } from './shared'
import type { AgentAction, ActionResult } from './shared'

export async function createPickupRequest(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const { orderIds, pickupDate, orderCount } = action.payload as {
    orderIds: string[]
    pickupDate: string
    orderCount: number
  }
  if (!Array.isArray(orderIds) || orderIds.length === 0) return { result: null, error: 'orderIds missing' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pickupDate || ''))) return { result: null, error: 'invalid pickupDate' }
  const r = await callInternalApi(cookieHeader, 'POST', '/api/admin/delhivery/pickup-request', {
    orderIds,
    pickupDate,
  })
  if (!r.ok) return { result: null, error: r.data?.error || `Delhivery pickup-request failed (HTTP ${r.status})` }
  return {
    result: {
      pickupId: r.data?.pickupId,
      pickupDate: r.data?.pickupDate,
      orderCount: r.data?.orderCount ?? orderCount,
      awbs: r.data?.awbs || [],
    },
    error: null,
  }
}

export async function syncDelhiveryStatuses(): Promise<ActionResult> {
  const cron = process.env.CRON_SECRET
  if (!cron) return { result: null, error: 'CRON_SECRET not configured' }
  const url = new URL('/api/admin/delhivery/sync-statuses', APPROVE_ORIGIN).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cron}`, 'Content-Type': 'application/json' },
  })
  let data: any
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) return { result: null, error: data?.error || `Sync failed (HTTP ${res.status})` }
  return {
    result: {
      total: data?.total ?? 0,
      synced: data?.synced ?? 0,
      errors: data?.errors?.length ?? 0,
      rvpReceived: data?.rvp?.received ?? 0,
    },
    error: null,
  }
}

export async function payPayable(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const { payableId, expenseNumber, supplierName, amount, paymentMode, paidAt, transactionRef } = action.payload as {
    payableId: string
    expenseNumber: string
    supplierName: string
    amount: number
    paymentMode: string
    paidAt: string
    transactionRef: string | null
  }
  if (!payableId || typeof amount !== 'number' || amount <= 0)
    return { result: null, error: 'invalid payableId/amount in payload' }
  const r = await callInternalApi(
    cookieHeader,
    'POST',
    `/api/admin/financial/payables/${encodeURIComponent(payableId)}/pay`,
    {
      amount,
      payment_date: paidAt,
      payment_method: paymentMode,
      reference: transactionRef || null,
      notes: `Paid via admin agent (${expenseNumber} – ${supplierName})`,
    }
  )
  if (!r.ok) return { result: null, error: r.data?.error || `Pay payable failed (HTTP ${r.status})` }
  return {
    result: {
      payableId,
      expenseNumber,
      supplierName,
      amount,
      paymentMode,
      paidAt,
      newStatus: r.data?.new_status,
      totalPaid: r.data?.total_paid,
    },
    error: null,
  }
}

export async function exportGstr1(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const { month, from, to, format, rowCount } = action.payload as {
    month: string
    from: string
    to: string
    format: 'json' | 'csv'
    rowCount: number
  }
  if (!from || !to) return { result: null, error: 'from/to missing in payload' }
  const fmt = format === 'csv' ? 'csv' : 'json'
  const url = `/api/admin/gst/gstr1?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${fmt}`
  const res = await fetch(new URL(url, APPROVE_ORIGIN).toString(), {
    method: 'GET',
    headers: { Cookie: cookieHeader },
  })
  if (!res.ok) {
    let err: any = null
    try {
      err = await res.json()
    } catch {}
    return { result: null, error: err?.error || `GSTR-1 export failed (HTTP ${res.status})` }
  }
  if (fmt === 'csv') {
    const csv = await res.text()
    return {
      result: {
        month,
        format: 'csv',
        rowCount,
        filename: `GSTR1_${from}_to_${to}.csv`,
        contentType: 'text/csv',
        contentBase64: Buffer.from(csv, 'utf8').toString('base64'),
        sizeBytes: Buffer.byteLength(csv, 'utf8'),
      },
      error: null,
    }
  }
  const data = await res.json()
  return {
    result: {
      month,
      format: 'json',
      rowCount,
      summary: data?.summary,
      b2bCount: data?.b2b?.length || 0,
      b2cCount: data?.b2c?.length || 0,
      hsnSummary: data?.hsnSummary,
    },
    error: null,
  }
}
