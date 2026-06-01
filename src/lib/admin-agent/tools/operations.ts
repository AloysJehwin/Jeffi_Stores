import { queryMany, queryOne } from '@/lib/db'
import type { ToolDef } from '../tools'

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

function fmtAmount(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n || '0'))
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
}

function monthBounds(month?: string): { from: string; to: string; label: string } {
  const now = new Date()
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [yy, mm] = month.split('-').map(Number)
    y = yy; m = mm
  }
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const label = `${y}-${String(m).padStart(2, '0')}`
  return { from, to, label }
}

const PICKUP_EXCLUDE_STATUSES = ['shipped', 'delivered', 'cancelled', 'returned', 'return_requested', 'return_approved', 'return_received', 'return_rejected']

export const OPERATIONS_TOOLS: ToolDef[] = [
  {
    name: 'list_pending_pickups',
    description: 'Orders that are paid, have an AWB assigned, and have NOT yet been added to a pending/picked-up Delhivery pickup request. Use to see what is ready to be handed to a courier.',
    inputSchema: {
      type: 'object',
      properties: {
        daysBack: { type: 'integer', default: 14, minimum: 1, maximum: 90 },
        limit: { type: 'integer', default: 25, minimum: 1, maximum: 100 },
      },
    },
    mutating: false,
    handler: async ({ daysBack, limit }) => {
      const d = clamp(typeof daysBack === 'number' ? daysBack : 14, 1, 90)
      const lim = clamp(typeof limit === 'number' ? limit : 25, 1, 100)
      const rows = await queryMany(
        `SELECT o.id::text, o.order_number, o.awb_number, o.status, o.created_at,
                o.customer_name, o.total_amount::text,
                sa.city, sa.state
         FROM orders o
         LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
         WHERE o.awb_number IS NOT NULL
           AND o.payment_status = 'paid'
           AND o.status NOT IN (${PICKUP_EXCLUDE_STATUSES.map((_, i) => `$${i + 2}`).join(',')})
           AND o.created_at > NOW() - ($1 || ' days')::interval
           AND o.awb_number NOT IN (
             SELECT UNNEST(awbs) FROM delhivery_pickup_requests
             WHERE pickup_status IN ('pending', 'picked_up')
           )
         ORDER BY o.created_at DESC
         LIMIT ${lim}`,
        [d, ...PICKUP_EXCLUDE_STATUSES]
      )
      return { orders: rows, count: rows.length, window_days: d, truncated: rows.length === lim }
    },
  },
  {
    name: 'list_recent_pickups',
    description: 'Recent Delhivery pickup requests with their statuses (pending, picked_up, failed). Useful to confirm what was scheduled and the courier outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        daysBack: { type: 'integer', default: 30, minimum: 1, maximum: 180 },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
    },
    mutating: false,
    handler: async ({ daysBack, limit }) => {
      const d = clamp(typeof daysBack === 'number' ? daysBack : 30, 1, 180)
      const lim = clamp(typeof limit === 'number' ? limit : 20, 1, 100)
      const rows = await queryMany(
        `SELECT id::text, pickup_id, pickup_date::text, awb_count, awbs, pickup_status, created_at
         FROM delhivery_pickup_requests
         WHERE created_at > NOW() - ($1 || ' days')::interval
         ORDER BY created_at DESC
         LIMIT ${lim}`,
        [d]
      )
      return { pickups: rows, count: rows.length, window_days: d }
    },
  },
  {
    name: 'list_payables',
    description: 'Vendor payables (expenses) that are unpaid or partially paid. Filter by status (unpaid|partial|paid|all) or due-window in days.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'unpaid | partial | paid | all (default: not paid)' },
        dueWithinDays: { type: 'integer', description: 'Only show payables with due_date within N days from today.', minimum: 1, maximum: 365 },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
      },
    },
    mutating: false,
    handler: async ({ status, dueWithinDays, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 50, 1, 200)
      const conds: string[] = []
      const params: unknown[] = []
      let i = 1
      const s = String(status || '').toLowerCase()
      if (s && s !== 'all') {
        conds.push(`e.status = $${i++}`); params.push(s)
      } else if (!s) {
        conds.push(`e.status != 'paid'`)
      }
      if (typeof dueWithinDays === 'number' && dueWithinDays > 0) {
        conds.push(`e.due_date IS NOT NULL AND e.due_date <= CURRENT_DATE + ($${i++}::int)`); params.push(clamp(dueWithinDays, 1, 365))
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
      const rows = await queryMany(
        `SELECT e.id::text, e.expense_number, e.supplier_name, e.supplier_gstin,
                e.description, e.amount::text, e.tax_amount::text, e.total_amount::text,
                e.expense_date::text, e.due_date::text, e.status,
                CASE WHEN e.due_date < CURRENT_DATE THEN EXTRACT(DAY FROM NOW() - e.due_date)::int ELSE NULL END AS days_overdue,
                COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0)::text AS paid_amount
         FROM expenses e
         ${where}
         ORDER BY e.due_date ASC NULLS LAST, e.expense_date DESC
         LIMIT ${lim}`,
        params
      )
      let total_payable = 0, overdue = 0
      for (const r of rows) {
        const remaining = parseFloat(r.total_amount as string) - parseFloat(r.paid_amount as string)
        total_payable += remaining
        if (r.days_overdue && (r.days_overdue as number) > 0) overdue += remaining
      }
      return {
        payables: rows,
        count: rows.length,
        summary: { total_payable: Math.round(total_payable * 100) / 100, overdue: Math.round(overdue * 100) / 100 },
        truncated: rows.length === lim,
      }
    },
  },
  {
    name: 'list_receivables',
    description: 'Outstanding customer receivables (orders with payment_status unpaid or partial), aged by days outstanding. Flag the over-30 and over-60 buckets.',
    inputSchema: {
      type: 'object',
      properties: {
        daysOverdue: { type: 'integer', description: 'Only include orders aged >= N days. Omit for all outstanding.', minimum: 0, maximum: 365 },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
      },
    },
    mutating: false,
    handler: async ({ daysOverdue, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 50, 1, 200)
      const minDays = typeof daysOverdue === 'number' ? clamp(daysOverdue, 0, 365) : 0
      const rows = await queryMany(
        `SELECT o.id::text AS order_id, o.order_number, o.invoice_number,
                o.customer_name, o.customer_phone,
                COALESCE(o.invoice_date, o.created_at)::date::text AS invoice_date,
                o.total_amount::text, o.payment_status,
                EXTRACT(DAY FROM NOW() - COALESCE(o.invoice_date, o.created_at))::int AS days_outstanding,
                CASE
                  WHEN EXTRACT(DAY FROM NOW() - COALESCE(o.invoice_date, o.created_at)) <= 30 THEN '0-30'
                  WHEN EXTRACT(DAY FROM NOW() - COALESCE(o.invoice_date, o.created_at)) <= 60 THEN '31-60'
                  ELSE '60+'
                END AS aging_bucket
         FROM orders o
         WHERE o.payment_status IN ('unpaid','partial')
           AND o.status NOT IN ('draft','cancelled','cancel_rejected','returned')
           AND EXTRACT(DAY FROM NOW() - COALESCE(o.invoice_date, o.created_at)) >= $1
         ORDER BY days_outstanding DESC
         LIMIT ${lim}`,
        [minDays]
      )
      let total = 0, b0_30 = 0, b31_60 = 0, b60p = 0
      for (const r of rows) {
        const amt = parseFloat(r.total_amount as string)
        total += amt
        if (r.aging_bucket === '0-30') b0_30 += amt
        else if (r.aging_bucket === '31-60') b31_60 += amt
        else b60p += amt
      }
      return {
        receivables: rows,
        count: rows.length,
        summary: {
          total: Math.round(total * 100) / 100,
          bucket_0_30: Math.round(b0_30 * 100) / 100,
          bucket_31_60: Math.round(b31_60 * 100) / 100,
          bucket_60plus: Math.round(b60p * 100) / 100,
        },
        truncated: rows.length === lim,
      }
    },
  },
  {
    name: 'get_cashflow_summary',
    description: 'Receipts (paid orders + cash sales) vs payments (vendor payouts) over a daysBack window. Returns daily and aggregate totals.',
    inputSchema: {
      type: 'object',
      properties: {
        daysBack: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      },
    },
    mutating: false,
    handler: async ({ daysBack }) => {
      const d = clamp(typeof daysBack === 'number' ? daysBack : 30, 1, 365)
      const inflow = await queryOne<{ amt: string; cnt: number }>(
        `SELECT COALESCE(SUM(amt), 0)::text AS amt, COUNT(*)::int AS cnt FROM (
           SELECT total_amount AS amt FROM orders WHERE payment_status = 'paid' AND created_at > NOW() - ($1 || ' days')::interval
           UNION ALL
           SELECT total_amount AS amt FROM cash_sales WHERE payment_status = 'paid' AND created_at > NOW() - ($1 || ' days')::interval
         ) src`,
        [d]
      )
      const outflow = await queryOne<{ amt: string; cnt: number }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS amt, COUNT(*)::int AS cnt
         FROM expense_payments WHERE payment_date::timestamp > NOW() - ($1 || ' days')::interval`,
        [d]
      )
      const inAmt = parseFloat(inflow?.amt || '0')
      const outAmt = parseFloat(outflow?.amt || '0')
      return {
        window_days: d,
        receipts: { total: Math.round(inAmt * 100) / 100, count: inflow?.cnt || 0 },
        payments: { total: Math.round(outAmt * 100) / 100, count: outflow?.cnt || 0 },
        net: Math.round((inAmt - outAmt) * 100) / 100,
      }
    },
  },
  {
    name: 'get_pl_summary',
    description: 'Profit-and-loss for a single calendar month. Revenue (paid orders + cash sales), COGS, gross profit, gross margin %, tax collected. Defaults to current month.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM. Omit for current month.' },
      },
    },
    mutating: false,
    handler: async ({ month }) => {
      const { from, to, label } = monthBounds(typeof month === 'string' ? month : undefined)
      const row = await queryOne<{ revenue: string; cogs: string; tax: string; orders: number }>(
        `SELECT COALESCE(SUM(total_amount), 0)::text AS revenue,
                COALESCE(SUM(cogs), 0)::text         AS cogs,
                COALESCE(SUM(tax_amount), 0)::text   AS tax,
                COUNT(*)::int                        AS orders
         FROM (
           SELECT o.total_amount, o.tax_amount,
                  (SELECT COALESCE(SUM(oi.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
                   FROM order_items oi
                   JOIN products p ON p.id = oi.product_id
                   LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                   WHERE oi.order_id = o.id) AS cogs
             FROM orders o
            WHERE o.payment_status = 'paid'
              AND o.created_at >= $1 AND o.created_at <= ($2 || ' 23:59:59')::timestamptz
           UNION ALL
           SELECT cs.total_amount, cs.tax_amount, 0 AS cogs
             FROM cash_sales cs
            WHERE cs.payment_status = 'paid'
              AND cs.created_at >= $1 AND cs.created_at <= ($2 || ' 23:59:59')::timestamptz
         ) src`,
        [from, to]
      )
      const revenue = parseFloat(row?.revenue || '0')
      const cogs = parseFloat(row?.cogs || '0')
      const gross = revenue - cogs
      return {
        month: label,
        from, to,
        revenue: Math.round(revenue * 100) / 100,
        cogs: Math.round(cogs * 100) / 100,
        gross_profit: Math.round(gross * 100) / 100,
        gross_margin_pct: revenue > 0 ? Math.round((gross / revenue) * 10000) / 100 : 0,
        tax_collected: Math.round(parseFloat(row?.tax || '0') * 100) / 100,
        order_count: row?.orders || 0,
      }
    },
  },
  {
    name: 'get_gst_summary',
    description: 'GST output (sales) and input (purchase ITC) totals for a calendar month. Use as a quick sanity check before exporting GSTR-1 / GSTR-3B. Defaults to current month.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM. Omit for current month.' },
      },
    },
    mutating: false,
    handler: async ({ month }) => {
      const { from, to, label } = monthBounds(typeof month === 'string' ? month : undefined)
      const out = await queryOne<{ taxable: string; cgst: string; sgst: string; igst: string; invoices: number }>(
        `SELECT COALESCE(SUM(taxable_amount),0)::text AS taxable,
                COALESCE(SUM(cgst_amount),0)::text   AS cgst,
                COALESCE(SUM(sgst_amount),0)::text   AS sgst,
                COALESCE(SUM(igst_amount),0)::text   AS igst,
                COUNT(*)::int                        AS invoices
         FROM orders
         WHERE invoice_date >= $1 AND invoice_date < ($2::date + interval '1 day')
           AND invoice_number IS NOT NULL AND payment_status = 'paid'`,
        [from, to]
      )
      const itc = await queryOne<{ taxable: string; tax: string; lines: number }>(
        `SELECT COALESCE(SUM(poi.quantity * poi.unit_cost), 0)::text AS taxable,
                COALESCE(SUM(poi.quantity * poi.unit_cost * COALESCE(poi.tax_rate, 0) / 100), 0)::text AS tax,
                COUNT(*)::int AS lines
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.po_id
         WHERE po.order_date >= $1 AND po.order_date < ($2::date + interval '1 day')
           AND po.status IN ('received','partial')`,
        [from, to]
      )
      const totalOutTax = parseFloat(out?.cgst || '0') + parseFloat(out?.sgst || '0') + parseFloat(out?.igst || '0')
      const itcTax = parseFloat(itc?.tax || '0')
      return {
        month: label,
        from, to,
        output: {
          taxable: Math.round(parseFloat(out?.taxable || '0') * 100) / 100,
          cgst: Math.round(parseFloat(out?.cgst || '0') * 100) / 100,
          sgst: Math.round(parseFloat(out?.sgst || '0') * 100) / 100,
          igst: Math.round(parseFloat(out?.igst || '0') * 100) / 100,
          total_tax: Math.round(totalOutTax * 100) / 100,
          invoice_count: out?.invoices || 0,
        },
        input_itc: {
          taxable: Math.round(parseFloat(itc?.taxable || '0') * 100) / 100,
          tax: Math.round(itcTax * 100) / 100,
          line_count: itc?.lines || 0,
        },
        net_tax_payable: Math.round((totalOutTax - itcTax) * 100) / 100,
      }
    },
  },
  {
    name: 'list_recent_transactions',
    description: 'Most recent financial transactions across paid orders, cash sales, and vendor payouts. Sorted by date desc.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
    },
    mutating: false,
    handler: async ({ limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 20, 1, 100)
      const rows = await queryMany(
        `SELECT * FROM (
           SELECT 'inflow'  AS direction, o.id::text AS id, o.created_at AS ts,
                  o.total_amount::text AS amount, o.customer_name AS party,
                  COALESCE(o.invoice_number, o.order_number) AS reference, 'order' AS kind
             FROM orders o WHERE o.payment_status = 'paid'
           UNION ALL
           SELECT 'inflow'  AS direction, cs.id::text AS id, cs.created_at AS ts,
                  cs.total_amount::text AS amount, cs.customer_name AS party,
                  COALESCE(cs.invoice_number, cs.sale_number) AS reference, 'cash_sale' AS kind
             FROM cash_sales cs WHERE cs.payment_status = 'paid'
           UNION ALL
           SELECT 'outflow' AS direction, ep.id::text AS id, ep.payment_date::timestamp AS ts,
                  ep.amount::text AS amount, e.supplier_name AS party,
                  e.expense_number AS reference, 'payable' AS kind
             FROM expense_payments ep JOIN expenses e ON e.id = ep.expense_id
         ) txn
         ORDER BY ts DESC
         LIMIT ${lim}`,
        []
      )
      return { transactions: rows, count: rows.length }
    },
  },

  {
    name: 'propose_create_pickup_request',
    description: 'Propose a Delhivery pickup request for one or more shipped orders. The actual Delhivery API call happens AFTER admin approval. Pass a list of order UUIDs (use list_pending_pickups to find them).',
    inputSchema: {
      type: 'object',
      properties: {
        orderIds: { type: 'array', description: 'Order UUIDs (1-50). Each order must be paid, have an AWB, and not already be in an active pickup.' },
        pickupDate: { type: 'string', description: 'YYYY-MM-DD. Defaults to tomorrow.' },
      },
      required: ['orderIds'],
    },
    mutating: true,
    handler: async ({ orderIds, pickupDate }) => {
      const ids = Array.isArray(orderIds) ? orderIds.map(String).filter(Boolean) : []
      if (ids.length < 1 || ids.length > 50) throw new Error('Provide 1-50 orderIds')
      let dateStr = String(pickupDate || '').trim()
      if (!dateStr) {
        const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
        dateStr = tomorrow.toISOString().slice(0, 10)
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('pickupDate must be YYYY-MM-DD')

      const eligible = await queryMany<{
        id: string; order_number: string; awb_number: string; customer_name: string;
        total_amount: string; status: string
      }>(
        `SELECT o.id::text, o.order_number, o.awb_number,
                COALESCE(o.customer_name, '') AS customer_name,
                o.total_amount::text, o.status
         FROM orders o
         WHERE o.id = ANY($1::uuid[])
           AND o.awb_number IS NOT NULL
           AND o.payment_status = 'paid'
           AND o.status NOT IN (${PICKUP_EXCLUDE_STATUSES.map((_, i) => `$${i + 2}`).join(',')})
           AND o.awb_number NOT IN (
             SELECT UNNEST(awbs) FROM delhivery_pickup_requests
             WHERE pickup_status IN ('pending','picked_up')
           )`,
        [ids, ...PICKUP_EXCLUDE_STATUSES]
      )
      if (eligible.length === 0) {
        return { proposed: false, info: 'No eligible orders found (must be paid, have AWB, not already in a pending/picked-up pickup, not shipped/delivered/cancelled).' }
      }
      if (eligible.length !== ids.length) {
        return { proposed: false, info: `Only ${eligible.length} of ${ids.length} orders are eligible. Re-check ids.`, eligibleCount: eligible.length }
      }

      const totalAmt = eligible.reduce((s, o) => s + parseFloat(o.total_amount || '0'), 0)

      return {
        proposed: true,
        kind: 'create_pickup_request',
        payload: {
          orderIds: eligible.map(o => o.id),
          awbs: eligible.map(o => o.awb_number),
          pickupDate: dateStr,
          orderCount: eligible.length,
        },
        confirmation: `Schedule a Delhivery pickup on ${dateStr} for ${eligible.length} order${eligible.length === 1 ? '' : 's'} (₹${fmtAmount(totalAmt)} total)?`,
        ui_blocks: [
          { type: 'heading', value: 'Pickup request', level: 2 },
          { type: 'kv_pairs', pairs: [
            { key: 'Pickup date', value: dateStr },
            { key: 'Orders', value: String(eligible.length) },
            { key: 'Total invoice value', value: `₹${fmtAmount(totalAmt)}` },
          ]},
          { type: 'table',
            headers: ['Order #', 'Customer', 'AWB', 'Amount'],
            rows: eligible.map(o => [
              o.order_number,
              o.customer_name || '-',
              o.awb_number,
              `₹${fmtAmount(o.total_amount)}`,
            ])
          },
        ],
      }
    },
  },
  {
    name: 'propose_sync_delhivery_statuses',
    description: 'Propose a manual sync of all open AWBs against the Delhivery tracking API. The job updates order.status, shipped_at, delivered_at and may trigger customer status emails. Long-running (30-60s).',
    inputSchema: { type: 'object', properties: {} },
    mutating: true,
    handler: async () => {
      const open = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM orders
         WHERE awb_number IS NOT NULL
           AND status IN ('processing','confirmed','pending','shipped','out_for_delivery')`
      )
      const rvp = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM return_requests
         WHERE rvp_awb_number IS NOT NULL AND status = 'approved' AND received_at IS NULL`
      ).catch(() => ({ n: 0 } as any))
      const total = (open?.n || 0) + (rvp?.n || 0)
      if (total === 0) {
        return { proposed: false, info: 'No open AWBs or RVP shipments to sync.' }
      }
      return {
        proposed: true,
        kind: 'sync_delhivery_statuses',
        payload: { openAwbCount: open?.n || 0, rvpCount: rvp?.n || 0 },
        confirmation: `Run Delhivery status sync against ${open?.n || 0} forward AWB${open?.n === 1 ? '' : 's'} and ${rvp?.n || 0} RVP shipment${rvp?.n === 1 ? '' : 's'}?`,
        ui_blocks: [
          { type: 'heading', value: 'Delhivery status sync', level: 2 },
          { type: 'kv_pairs', pairs: [
            { key: 'Forward AWBs', value: String(open?.n || 0) },
            { key: 'Return AWBs', value: String(rvp?.n || 0) },
          ]},
          { type: 'callout', tone: 'warn', title: 'Heads up',
            message: 'This will hit the Delhivery tracking API and update status_codes on every open AWB. Customer status-update emails may also be sent. Expect 30-60 seconds.' },
        ],
      }
    },
  },
  {
    name: 'propose_pay_payable',
    description: 'Propose recording a vendor payment against a payable (expense). Creates an expense_payment row and updates expense status. Does NOT actually move money — it is a bookkeeping record. Requires payableId.',
    inputSchema: {
      type: 'object',
      properties: {
        payableId: { type: 'string', description: 'expenses.id (UUID).' },
        paymentMode: { type: 'string', description: 'cash | upi | bank_transfer | cheque | other' },
        paidAt: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        transactionRef: { type: 'string', description: 'Optional UTR / cheque no / UPI ref.' },
        amount: { type: 'string', description: 'Optional. Defaults to remaining outstanding on the expense.' },
      },
      required: ['payableId', 'paymentMode'],
    },
    mutating: true,
    handler: async ({ payableId, paymentMode, paidAt, transactionRef, amount }) => {
      const id = String(payableId || '').trim()
      if (!id) throw new Error('payableId is required')
      const mode = String(paymentMode || '').toLowerCase().trim()
      if (!['cash', 'upi', 'bank_transfer', 'cheque', 'other'].includes(mode)) {
        throw new Error('paymentMode must be one of: cash, upi, bank_transfer, cheque, other')
      }
      let payDate = String(paidAt || '').trim()
      if (!payDate) payDate = new Date().toISOString().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) throw new Error('paidAt must be YYYY-MM-DD')

      const exp = await queryOne<{
        id: string; expense_number: string; supplier_name: string;
        total_amount: string; status: string;
        paid_amount: string;
      }>(
        `SELECT e.id::text, e.expense_number, e.supplier_name, e.total_amount::text, e.status,
                COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0)::text AS paid_amount
         FROM expenses e WHERE e.id = $1::uuid`,
        [id]
      )
      if (!exp) throw new Error(`Expense not found: ${id}`)
      if (exp.status === 'paid') {
        return { proposed: false, info: `Payable ${exp.expense_number} is already fully paid.` }
      }
      const remaining = parseFloat(exp.total_amount) - parseFloat(exp.paid_amount)
      let payAmt = remaining
      if (typeof amount === 'string' && amount.trim()) {
        const a = parseFloat(amount)
        if (!Number.isFinite(a) || a <= 0) throw new Error('amount must be a positive number')
        if (a > remaining + 0.01) throw new Error(`amount ${a} exceeds remaining ${remaining}`)
        payAmt = a
      }
      const ref = String(transactionRef || '').trim() || null
      const isHighValue = payAmt > 50000

      const blocks: unknown[] = [
        { type: 'heading', value: `Pay ${exp.expense_number}`, level: 2 },
        { type: 'kv_pairs', pairs: [
          { key: 'Vendor', value: exp.supplier_name },
          { key: 'Expense', value: exp.expense_number },
          { key: 'Amount', value: `₹${fmtAmount(payAmt)}` },
          { key: 'Mode', value: mode },
          { key: 'Date', value: payDate },
          ...(ref ? [{ key: 'Reference', value: ref }] : []),
          { key: 'Remaining after this', value: `₹${fmtAmount(remaining - payAmt)}` },
        ]},
      ]
      if (isHighValue) {
        blocks.push({
          type: 'callout', tone: 'warn', title: 'High-value payout',
          message: `This records a payment of ₹${fmtAmount(payAmt)} (over the ₹50,000 threshold). Double-check the vendor bank details and reference before approving.`,
        })
      }

      return {
        proposed: true,
        kind: 'pay_payable',
        payload: {
          payableId: exp.id,
          expenseNumber: exp.expense_number,
          supplierName: exp.supplier_name,
          amount: Math.round(payAmt * 100) / 100,
          paymentMode: mode,
          paidAt: payDate,
          transactionRef: ref,
        },
        confirmation: `Record ₹${fmtAmount(payAmt)} payment to ${exp.supplier_name} (${exp.expense_number}) via ${mode}${ref ? ` ref ${ref}` : ''}?`,
        ui_blocks: blocks,
      }
    },
  },
  {
    name: 'propose_export_gstr1',
    description: 'Propose an export of GSTR-1 outward-supplies data for a calendar month, in JSON or CSV. Downloads the export from the existing /api/admin/gst/gstr1 endpoint after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM. Defaults to previous calendar month (typical filing window).' },
        format: { type: 'string', description: 'json | csv (default csv)' },
      },
    },
    mutating: true,
    handler: async ({ month, format }) => {
      let monthStr = typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? month : ''
      if (!monthStr) {
        const now = new Date()
        const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
        monthStr = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`
      }
      const fmt = String(format || 'csv').toLowerCase()
      if (!['json', 'csv'].includes(fmt)) throw new Error('format must be json or csv')
      const { from, to } = monthBounds(monthStr)

      const counts = await queryOne<{ rows: number; b2b: number; b2c: number; total: string }>(
        `SELECT COUNT(*)::int AS rows,
                COUNT(*) FILTER (WHERE buyer_gstin IS NOT NULL)::int AS b2b,
                COUNT(*) FILTER (WHERE buyer_gstin IS NULL)::int     AS b2c,
                COALESCE(SUM(total_amount), 0)::text                 AS total
         FROM orders
         WHERE invoice_date >= $1
           AND invoice_date < ($2::date + interval '1 day')
           AND invoice_number IS NOT NULL
           AND payment_status = 'paid'`,
        [from, to]
      )
      if (!counts || counts.rows === 0) {
        return { proposed: false, info: `No invoices found for ${monthStr}. Nothing to export.` }
      }

      return {
        proposed: true,
        kind: 'export_gstr1',
        payload: {
          month: monthStr, from, to, format: fmt,
          rowCount: counts.rows, b2bCount: counts.b2b, b2cCount: counts.b2c,
        },
        confirmation: `Export GSTR-1 for ${monthStr} (${counts.rows} invoice${counts.rows === 1 ? '' : 's'}, ${fmt.toUpperCase()})?`,
        ui_blocks: [
          { type: 'heading', value: `GSTR-1 export · ${monthStr}`, level: 2 },
          { type: 'kv_pairs', pairs: [
            { key: 'Period', value: `${from} → ${to}` },
            { key: 'Format', value: fmt.toUpperCase() },
            { key: 'Invoices', value: String(counts.rows) },
            { key: 'B2B', value: String(counts.b2b) },
            { key: 'B2C', value: String(counts.b2c) },
            { key: 'Invoice value', value: `₹${fmtAmount(counts.total)}` },
          ]},
          { type: 'callout', tone: 'info',
            message: 'Read-only export — no rows are mutated. The file will be available after approval.' },
        ],
      }
    },
  },
]
