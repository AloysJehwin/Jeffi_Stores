import { documentUrl } from '@/lib/shared/customer-links'
import { sendQuotationFinalizedEmail } from '@/lib/email'
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
    await sendQuotationFinalizedEmail(toEmail, consigneeName || '', quoteNumber, Number(totalAmount), viewUrl)
    return { result: { sentTo: toEmail, quoteNumber }, error: null }
  } catch (err: any) {
    return { result: null, error: String(err?.message || 'Send failed') }
  }
}
