# Sales artifacts — approve-route cases

Add the following cases to the `switch (action.kind)` block in
`src/app/api/admin/agent/actions/[id]/approve/route.ts`. They cover the four
new mutating `kind`s emitted by `src/lib/admin-agent/tools/sales.ts`.

You will also need these imports near the top of the file:

```ts
import { withTransaction } from '@/lib/db'
import { sendQuotationFinalizedEmail } from '@/lib/email'
```

(`query`, `queryMany`, `queryOne`, and `VARIANT_MIN_PRICE_SQL` are already
imported.)

---

## `case 'create_quotation'`

Creates a draft quotation row + `quotation_items`, generating the next
`QT/<FY>/<MON>/<seq>` number in the same way as
`POST /api/admin/quotations`. Mirrors that route's totals math
(half of CGST+SGST = `amount * gst_rate / 200`).

```ts
case 'create_quotation': {
  const { customerEmail, consigneeName, notes, items } = action.payload as {
    customerEmail: string; consigneeName: string; notes: string | null;
    items: { productId: string; name: string; sku: string; hsnCode: string | null;
             gstRate: number; quantity: number; unitPrice: number; lineAmount: number }[]
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { result: null, error: 'items missing' }
  }
  const subtotal = items.reduce((s, i) => s + i.lineAmount, 0)
  const cgst = items.reduce((s, i) => s + i.lineAmount * i.gstRate / 200, 0)
  const sgst = cgst
  const total = Math.round(subtotal + cgst + sgst)

  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month]
  const prefix = `QT/${fy}/${mon}/`

  try {
    const out = await withTransaction(async (client) => {
      const seqRow = await client.query<{ max_seq: string | null }>(
        `SELECT MAX(CAST(split_part(quote_number, '/', 4) AS INTEGER)) AS max_seq
           FROM quotations WHERE quote_number LIKE $1`,
        [prefix + '%']
      )
      const seq = (parseInt(seqRow.rows[0]?.max_seq || '0') || 0) + 1
      const quoteNumber = `${prefix}${seq}`

      const qt = await client.query<{ id: string; quote_number: string; view_token: string }>(
        `INSERT INTO quotations (
          quote_number, quote_date, status,
          consignee_name, consignee_addr1, consignee_state,
          consignee_email, buyer_same, notes,
          subtotal, cgst_amount, sgst_amount, total_amount, created_by
        ) VALUES ($1,$2,'draft',$3,'','Chhattisgarh',$4,TRUE,$5,$6,$7,$8,$9,$10)
        RETURNING id::text, quote_number, view_token::text`,
        [
          quoteNumber,
          now.toISOString().slice(0, 10),
          consigneeName || customerEmail,
          customerEmail,
          notes,
          subtotal, cgst, sgst, total,
          action.admin_id,
        ]
      )
      const qid = qt.rows[0].id

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx]
        await client.query(
          `INSERT INTO quotation_items (
            quotation_id, position, description, hsn_code, gst_rate,
            quantity, unit, rate, discount_pct, amount, product_id
          ) VALUES ($1,$2,$3,$4,$5,$6,'PCS',$7,0,$8,$9::uuid)`,
          [qid, idx, it.name, it.hsnCode, it.gstRate,
           it.quantity, it.unitPrice, it.lineAmount, it.productId]
        )
      }
      return { id: qid, quote_number: qt.rows[0].quote_number, view_token: qt.rows[0].view_token }
    })
    return { result: { quotationId: out.id, quoteNumber: out.quote_number, total, viewToken: out.view_token }, error: null }
  } catch (err: any) {
    return { result: null, error: String(err?.message || 'Quotation create failed') }
  }
}
```

---

## `case 'send_quotation_email'`

Calls the same `sendQuotationFinalizedEmail` helper used by the existing
resend-email route. Uses the public-quotation domain pattern from
`src/app/api/admin/quotations/[id]/resend-email/route.ts`.

```ts
case 'send_quotation_email': {
  const { quoteNumber, toEmail, consigneeName, totalAmount, viewToken } = action.payload as {
    quotationId: string; quoteNumber: string; toEmail: string;
    consigneeName: string; totalAmount: number; viewToken: string
  }
  if (!toEmail || !quoteNumber) return { result: null, error: 'Missing recipient or quote number' }
  try {
    const viewUrl = `https://quotation.jeffistores.in/${viewToken}`
    await sendQuotationFinalizedEmail(toEmail, consigneeName || '', quoteNumber, Number(totalAmount), viewUrl)
    return { result: { sentTo: toEmail, quoteNumber }, error: null }
  } catch (err: any) {
    return { result: null, error: String(err?.message || 'Send failed') }
  }
}
```

---

## `case 'mark_invoice_paid'`

Updates `orders.payment_status='paid'` for an order that already has an
`invoice_number`. If `paidAt` is supplied we shift `invoice_date`
to that day so finance reports line up; if omitted, only payment status
changes. We do not touch `cash_sales` because those are paid-on-creation by
design (`payment_status` defaults to `'paid'` per the schema).

```ts
case 'mark_invoice_paid': {
  const { orderId, paymentMode, paidAt } = action.payload as {
    orderId: string; invoiceNumber: string; paymentMode: string;
    paidAt: string | null; amount: number; customerName: string
  }
  const updated = await queryOne<{ id: string; invoice_number: string; payment_status: string; invoice_date: string | null }>(
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
```

> Note: I deliberately did NOT insert a row into the `payments` table — that
> table requires `transaction_id` semantics and is owned by the gateway/webhook
> path. The agent only flips the order's payment_status and writes a one-line
> note. If you want a richer audit trail, add an admin-side `manual_payments`
> insert here.

---

## `case 'update_order_status'`

Generalisation of `mark_order_shipped` that supports the full
pending → confirmed → processing → shipped → delivered → cancelled flow,
plus regressions when `isRegression` is true (the agent surfaces a warning
callout but the admin's approval is the gate). Sets the matching
`*_at` timestamp where applicable.

```ts
case 'update_order_status': {
  const { orderId, newStatus, awbNumber } = action.payload as {
    orderId: string; orderNumber: string; fromStatus: string;
    newStatus: string; awbNumber: string | null; isRegression: boolean
  }
  const ALLOWED = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
  if (!ALLOWED.includes(newStatus)) return { result: null, error: 'Invalid status' }

  const tsCol =
    newStatus === 'confirmed' ? 'confirmed_at' :
    newStatus === 'shipped'   ? 'shipped_at'   :
    newStatus === 'delivered' ? 'delivered_at' :
    newStatus === 'cancelled' ? 'cancelled_at' : null

  const setParts = [`status = $2`, `updated_at = NOW()`]
  const params: any[] = [orderId, newStatus]
  if (tsCol) setParts.push(`${tsCol} = COALESCE(${tsCol}, NOW())`)
  if (newStatus === 'shipped' && awbNumber) {
    params.push(awbNumber)
    setParts.push(`awb_number = COALESCE(awb_number, $${params.length})`)
  }

  const updated = await queryOne(
    `UPDATE orders SET ${setParts.join(', ')}
       WHERE id = $1::uuid
       RETURNING id::text, order_number, status, awb_number`,
    params
  )
  if (!updated) return { result: null, error: 'Order not found' }
  return { result: updated, error: null }
}
```
