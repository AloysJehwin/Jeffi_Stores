import { withTransaction } from '@/lib/db'
import { sendQuotationFinalizedEmail } from '@/lib/email'
import type { AgentAction, ActionResult } from './shared'

export async function createQuotation(action: AgentAction): Promise<ActionResult> {
  const p = action.payload as {
    consignee_email: string
    consignee_name: string
    consignee_phone: string | null
    consignee_addr1: string
    consignee_addr2: string | null
    consignee_city: string
    consignee_state: string
    consignee_gstin: string | null
    consignee_pincode: string | null
    buyer_same: boolean
    buyer_name: string | null
    buyer_addr1: string | null
    buyer_addr2: string | null
    buyer_city: string | null
    buyer_state: string | null
    buyer_gstin: string | null
    buyer_phone: string | null
    buyer_pincode: string | null
    buyer_email: string | null
    notes: string | null
    quote_date: string | null
    items: {
      description: string
      quantity: number
      rate: number
      discount_pct: number
      hsn_code: string | null
      gst_rate: number
      unit: string
      buy_unit: string | null
      product_id: string
      variant_id: string | null
      sub_variant_id: string | null
      amount: number
    }[]
  }
  if (!Array.isArray(p.items) || p.items.length === 0) return { result: null, error: 'items missing' }
  const subtotal = p.items.reduce((s, i) => s + i.amount, 0)
  const cgst = p.items.reduce((s, i) => s + (i.amount * i.gst_rate) / 200, 0)
  const sgst = cgst
  const total = Math.round(subtotal + cgst + sgst)
  const now = new Date()
  const m = now.getMonth(),
    y = now.getFullYear()
  const fyStart = m >= 3 ? y : y - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m]
  const prefix = `QT/${fy}/${mon}/`
  try {
    const out = await withTransaction(async client => {
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
           consignee_name, consignee_addr1, consignee_addr2, consignee_city, consignee_state,
           consignee_gstin, consignee_phone, consignee_pincode, consignee_email,
           buyer_same, buyer_name, buyer_addr1, buyer_addr2, buyer_city, buyer_state,
           buyer_gstin, buyer_phone, buyer_pincode, buyer_email,
           notes, subtotal, cgst_amount, sgst_amount, total_amount, created_by
         ) VALUES (
           $1,$2,'draft',
           $3,$4,$5,$6,$7,
           $8,$9,$10,$11,
           $12,$13,$14,$15,$16,$17,
           $18,$19,$20,$21,
           $22,$23,$24,$25,$26,$27::uuid
         ) RETURNING id::text, quote_number, view_token::text`,
        [
          quoteNumber,
          p.quote_date || now.toISOString().slice(0, 10),
          p.consignee_name || p.consignee_email,
          p.consignee_addr1 || '',
          p.consignee_addr2 || null,
          p.consignee_city || '',
          p.consignee_state || 'Chhattisgarh',
          p.consignee_gstin || null,
          p.consignee_phone || null,
          p.consignee_pincode || null,
          p.consignee_email,
          p.buyer_same !== false,
          p.buyer_name || null,
          p.buyer_addr1 || null,
          p.buyer_addr2 || null,
          p.buyer_city || null,
          p.buyer_state || null,
          p.buyer_gstin || null,
          p.buyer_phone || null,
          p.buyer_pincode || null,
          p.buyer_email || null,
          p.notes || null,
          subtotal,
          cgst,
          sgst,
          total,
          action.admin_id,
        ]
      )
      const qid = qt.rows[0].id
      for (let idx = 0; idx < p.items.length; idx++) {
        const it = p.items[idx]
        await client.query(
          `INSERT INTO quotation_items (
             quotation_id, position, description, hsn_code, gst_rate,
             quantity, unit, buy_unit, rate, discount_pct, amount,
             product_id, variant_id, sub_variant_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13,$14)`,
          [
            qid,
            idx,
            it.description,
            it.hsn_code || null,
            it.gst_rate || 18,
            it.quantity,
            it.unit || 'PCS',
            it.buy_unit || null,
            it.rate,
            it.discount_pct || 0,
            it.amount,
            it.product_id,
            it.variant_id ? it.variant_id : null,
            it.sub_variant_id ? it.sub_variant_id : null,
          ]
        )
      }
      return { id: qid, quote_number: qt.rows[0].quote_number, view_token: qt.rows[0].view_token }
    })
    return {
      result: { quotationId: out.id, quoteNumber: out.quote_number, total, viewToken: out.view_token },
      error: null,
    }
  } catch (err: any) {
    return { result: null, error: String(err?.message || 'Quotation create failed') }
  }
}

export async function sendQuotationEmail(action: AgentAction): Promise<ActionResult> {
  const { quoteNumber, toEmail, consigneeName, totalAmount, viewToken } = action.payload as {
    quoteNumber: string
    toEmail: string
    consigneeName: string
    totalAmount: number
    viewToken: string
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
