# Operations approve-route cases

These switch-case bodies should be added to `executeAction` in
`src/app/api/admin/agent/actions/[id]/approve/route.ts`. They follow the same
shape as the existing cases (return `{ result, error }`).

The `cookieHeader` parameter already in scope is reused to call our own
internal admin APIs as the approving admin (mirrors `call_admin_api`).

```ts
const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`

async function callInternal(
  cookieHeader: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; ok: boolean; data: any }> {
  const res = await fetch(new URL(path, ORIGIN).toString(), {
    method,
    headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any
  try { data = await res.json() } catch { data = await res.text().catch(() => null) }
  return { status: res.status, ok: res.ok, data }
}
```

## case 'create_pickup_request'

Calls the existing `/api/admin/delhivery/pickup-request` POST endpoint. That
route is already wired to validate eligibility, hit the Delhivery API, insert
the `delhivery_pickup_requests` row, and bump order status to `processing`.

```ts
case 'create_pickup_request': {
  const { orderIds, pickupDate, orderCount } = action.payload as {
    orderIds: string[]; pickupDate: string; orderCount: number
  }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return { result: null, error: 'orderIds missing' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pickupDate || ''))) {
    return { result: null, error: 'invalid pickupDate' }
  }
  const r = await callInternal(cookieHeader, 'POST', '/api/admin/delhivery/pickup-request', {
    orderIds, pickupDate,
  })
  if (!r.ok) {
    return {
      result: null,
      error: r.data?.error || `Delhivery pickup-request failed (HTTP ${r.status})`,
    }
  }
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
```

## case 'sync_delhivery_statuses'

The sync endpoint at `/api/admin/delhivery/sync-statuses` is gated by
`CRON_SECRET` (it expects `Authorization: Bearer <CRON_SECRET>`), so we call it
with that bearer token rather than admin cookies. This is intentional — the
endpoint is the same job the cron runs.

```ts
case 'sync_delhivery_statuses': {
  const cron = process.env.CRON_SECRET
  if (!cron) return { result: null, error: 'CRON_SECRET not configured' }
  const url = new URL('/api/admin/delhivery/sync-statuses', ORIGIN).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cron}`, 'Content-Type': 'application/json' },
  })
  let data: any
  try { data = await res.json() } catch { data = null }
  if (!res.ok) {
    return { result: null, error: data?.error || `Sync failed (HTTP ${res.status})` }
  }
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
```

## case 'pay_payable'

Reuses `/api/admin/financial/payables/[id]/pay` POST. That endpoint inserts an
`expense_payments` row and recomputes the parent `expenses.status`.

```ts
case 'pay_payable': {
  const {
    payableId, expenseNumber, supplierName,
    amount, paymentMode, paidAt, transactionRef,
  } = action.payload as {
    payableId: string; expenseNumber: string; supplierName: string
    amount: number; paymentMode: string; paidAt: string; transactionRef: string | null
  }
  if (!payableId || typeof amount !== 'number' || amount <= 0) {
    return { result: null, error: 'invalid payableId/amount in payload' }
  }
  const r = await callInternal(
    cookieHeader, 'POST',
    `/api/admin/financial/payables/${encodeURIComponent(payableId)}/pay`,
    {
      amount,
      payment_date: paidAt,
      payment_method: paymentMode,
      reference: transactionRef || null,
      notes: `Paid via admin agent (${expenseNumber} – ${supplierName})`,
    }
  )
  if (!r.ok) {
    return { result: null, error: r.data?.error || `Pay payable failed (HTTP ${r.status})` }
  }
  return {
    result: {
      payableId, expenseNumber, supplierName,
      amount, paymentMode, paidAt,
      newStatus: r.data?.new_status,
      totalPaid: r.data?.total_paid,
    },
    error: null,
  }
}
```

## case 'export_gstr1'

GSTR-1 export is a read-only generation against `/api/admin/gst/gstr1`. The
approve handler calls that route with the date window, captures the body, and
hands it back as the action `result` (the chat UI can offer it as a download
or display the JSON summary).

The endpoint requires `super_admin` — the cookie of the approving admin is
forwarded, so a non-super-admin approval will surface the upstream 401.

```ts
case 'export_gstr1': {
  const { month, from, to, format, rowCount } = action.payload as {
    month: string; from: string; to: string; format: 'json' | 'csv'; rowCount: number
  }
  if (!from || !to) return { result: null, error: 'from/to missing in payload' }
  const fmt = format === 'csv' ? 'csv' : 'json'
  const url = `/api/admin/gst/gstr1?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${fmt}`
  const res = await fetch(new URL(url, ORIGIN).toString(), {
    method: 'GET', headers: { Cookie: cookieHeader },
  })
  if (!res.ok) {
    let err: any = null
    try { err = await res.json() } catch {}
    return { result: null, error: err?.error || `GSTR-1 export failed (HTTP ${res.status})` }
  }
  if (fmt === 'csv') {
    const csv = await res.text()
    return {
      result: {
        month, format: 'csv', rowCount,
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
      month, format: 'json', rowCount,
      summary: data?.summary, b2bCount: data?.b2b?.length || 0, b2cCount: data?.b2c?.length || 0,
      hsnSummary: data?.hsnSummary,
    },
    error: null,
  }
}
```

## Notes for the integrator

- The `executeAction` switch already handles `call_admin_api`, so the four new
  cases above slot in beside it before the `default`.
- All four cases return the existing `{ result, error }` contract; no changes
  to the outer route handler are needed.
- The Delhivery sync uses `CRON_SECRET` because the underlying endpoint is
  cron-gated. If the secret is missing, the case fails loudly rather than
  silently doing nothing.
- For `export_gstr1` we wrap the CSV in base64 inside the action `result` so
  the chat UI can offer it as a downloadable blob — the approve route's
  response shape is preserved.
