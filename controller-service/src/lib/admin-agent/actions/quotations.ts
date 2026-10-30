import { documentUrl } from '@/lib/shared/customer-links'
import { sendQuotationFinalizedEmail } from '@/lib/email'
import { queryOne } from '@/lib/shared/db'
import { openReplyContextSafe } from '@/lib/replies/context'
import { withReplyContext } from '@/lib/replies/scope'
import { callInternalApi, type AgentAction, type ActionResult } from './shared'

// Same endpoint, validation and pricing as the quotation editor, under the approving admin's session.
export async function createQuotation(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const { total: _total, subtotal: _s, cgst: _c, sgst: _g, ...body } = action.payload as Record<string, any>
  if (!Array.isArray(body.items) || body.items.length === 0) return { result: null, error: 'items missing' }
  const res = await callInternalApi(cookieHeader, 'POST', '/api/admin/quotations', body)
  if (!res.ok) return { result: null, error: apiError(res.data, `Quotation create failed (${res.status})`) }
  const q = res.data?.quotation ?? {}
  return {
    result: { quotationId: q.id, quoteNumber: q.quote_number, total: Number(q.total_amount), viewToken: q.view_token },
    error: null,
  }
}

function apiError(data: any, fallback: string): string {
  const fields = data?.fields ? Object.entries(data.fields).map(([k, v]) => `${k}: ${v}`).join('; ') : ''
  return [typeof data?.error === 'string' ? data.error : fallback, fields].filter(Boolean).join(' — ')
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
    const viewUrl = await documentUrl('quotation', viewToken)
    // The customer can answer by replying (lib/replies): accept, decline or ask for changes.
    const q = await queryOne<{ id: string; consignee_phone: string | null; user_id: string | null }>(
      `SELECT q.id, q.consignee_phone, COALESCE(b.user_id, u.id) AS user_id FROM quotations q
         LEFT JOIN business_rfqs b ON b.converted_quotation_id = q.id
         LEFT JOIN users u ON lower(u.email) = lower($2)
        WHERE q.quote_number = $1 LIMIT 1`,
      [quoteNumber, toEmail]
    )
    const opened = q ? await openReplyContextSafe({ scenario: 'quotation', entityType: 'quotations', entityId: q.id, userId: q.user_id, email: toEmail.toLowerCase(), phone: q.consignee_phone }) : null
    await withReplyContext(opened && q ? { contextId: opened.context.id, replyTo: opened.replyTo, entityType: 'quotations', entityId: q.id } : null, () =>
      sendQuotationFinalizedEmail(toEmail, consigneeName || '', quoteNumber, Number(totalAmount), viewUrl)
    )
    return { result: { sentTo: toEmail, quoteNumber }, error: null }
  } catch (err: any) {
    return { result: null, error: String(err?.message || 'Send failed') }
  }
}
