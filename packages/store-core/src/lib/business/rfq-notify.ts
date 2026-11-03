import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { sendAuditedMail, mailShell, escapeHtml } from '@/lib/email/shared'
import { businessBaseUrlAsync, currentBrandNameAsync, customerMailFromAsync } from '@/lib/catalog/brand'
import { openReplyContextSafe } from '@/lib/replies/context'
import { withReplyContext } from '@/lib/replies/scope'

// Our reply on a quote request (an offer or a message) reaches the customer by email; they can
// answer in the portal or just reply to the email.

const rupees = (n: number) => `&#8377;${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function notifyRfqReply(rfqId: string, messageId: string): Promise<void> {
  const r = await queryOne<any>(
    `SELECT b.id, b.rfq_number, b.user_id, u.email, u.phone, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS name
       FROM business_rfqs b JOIN users u ON u.id = b.user_id WHERE b.id = $1`,
    [rfqId]
  )
  const m = await queryOne<{ message: string; counter_items: any }>(`SELECT message, counter_items FROM rfq_messages WHERE id = $1`, [messageId])
  if (!r?.email || !m) return

  const ci: Array<{ rfq_item_id: string; offered_price: number }> = m.counter_items ? (Array.isArray(m.counter_items) ? m.counter_items : JSON.parse(m.counter_items)) : []
  const items = ci.length ? await queryMany<any>(`SELECT id, description, quantity, unit FROM business_rfq_items WHERE rfq_id = $1`, [rfqId]) : []
  const rows = ci
    .map(c => {
      const it = items.find(i => i.id === c.rfq_item_id)
      return `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(it?.description ?? 'Item')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${it?.quantity ?? ''} ${escapeHtml(it?.unit ?? '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${rupees(Number(c.offered_price))}</td></tr>`
    })
    .join('')
  const [brand, portal, from] = await Promise.all([currentBrandNameAsync(), businessBaseUrlAsync(), customerMailFromAsync()])
  const offer = !!rows
  const html = mailShell({
    brand,
    kicker: `Quote request ${r.rfq_number}`,
    title: offer ? 'We have an offer for you' : 'A reply to your quote request',
    content: `
      <p>Hi ${escapeHtml(r.name || 'there')},</p>
      <p style="white-space:pre-wrap;">${escapeHtml(m.message)}</p>
      ${offer ? `<table style="width:100%;border-collapse:collapse;margin:12px 0"><tr><th style="text-align:left;padding:6px 8px">Item</th><th style="text-align:right;padding:6px 8px">Qty</th><th style="text-align:right;padding:6px 8px">Price each</th></tr>${rows}</table>` : ''}
      <div class="cta"><a href="${portal}/quotes/${encodeURIComponent(rfqId)}" class="button">View in your account</a></div>
      <p class="muted" style="text-align:center;">${offer ? 'You can accept it there, or simply reply to this email: "accepted", or your counter-offer.' : 'You can reply to this email.'}</p>`,
  })

  // One open question per RFQ: it always reads our latest message and offer.
  const opened = await openReplyContextSafe({ scenario: 'rfq_offer', entityType: 'business_rfqs', entityId: rfqId, userId: r.user_id, email: r.email, phone: r.phone })
  const scope = opened ? { contextId: opened.context.id, replyTo: opened.replyTo, entityType: 'business_rfqs', entityId: rfqId } : null
  await withReplyContext(scope, () =>
    sendAuditedMail({
      to: r.email,
      from,
      subject: offer ? `Our offer on your quote request ${r.rfq_number}` : `Re: your quote request ${r.rfq_number}`,
      html,
      kind: 'business',
      templateName: offer ? 'rfq_offer' : 'rfq_message',
      entityType: 'business_rfqs',
      entityId: rfqId,
      userId: r.user_id,
    })
  )
}
