import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { sendAuditedMail, mailShell, escapeHtml } from '@/lib/email/shared'
import { currentBrandNameAsync, customerMailFromAsync } from '@/lib/catalog/brand'
import { orderUrlById } from '@/lib/shared/customer-links'
import { askAboutOrder } from '@/lib/replies/ask'
import { whatsappTemplateApproved } from '@/lib/messaging/library'
import { sendItemUnavailableWhatsApp } from '@/lib/shared/whatsapp'

// One item in an order can't be supplied: ask the customer what they'd like, by email and (once Meta has
// approved the template) WhatsApp. Their reply (refund it, an alternative, wait, cancel) is read against
// the order as an out_of_stock question.

type Channel = 'email' | 'whatsapp'

export async function askAboutUnavailableItem(
  orderId: string,
  itemId: string
): Promise<{ ok: true; channels: Channel[] } | { ok: false; error: string; status: number }> {
  const o = await queryOne<any>(
    `SELECT o.id, o.order_number, o.status, o.user_id, COALESCE(NULLIF(u.email, ''), o.customer_email) AS email,
            COALESCE(NULLIF(u.phone, ''), o.customer_phone) AS phone,
            COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), o.customer_name) AS name,
            oi.product_name, oi.variant_name, oi.quantity
       FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.id = $2 LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1`,
    [orderId, itemId]
  )
  if (!o) return { ok: false, error: 'Item not found', status: 404 }
  if (!['pending', 'confirmed', 'processing'].includes(o.status)) return { ok: false, error: 'This order has already shipped or closed', status: 400 }
  const whatsapp = !!o.phone && (await whatsappTemplateApproved('order/out-of-stock'))
  if (!o.email && !whatsapp) return { ok: false, error: 'No customer email or WhatsApp number for this order', status: 400 }

  const item = `${o.product_name}${o.variant_name ? ` (${o.variant_name})` : ''}`
  const [brand, from, link] = await Promise.all([currentBrandNameAsync(), customerMailFromAsync(), orderUrlById(orderId)])
  const html = mailShell({
    brand,
    kicker: `Order ${o.order_number}`,
    title: 'One item is temporarily unavailable',
    content: `
      <p>Hi ${escapeHtml(o.name || 'there')},</p>
      <p>We're sorry: <strong>${escapeHtml(item)}</strong> × ${Number(o.quantity)} in your order <strong>${escapeHtml(o.order_number)}</strong> is temporarily out of stock.</p>
      <p>What would you like us to do? Simply reply to this email, for example:</p>
      <ul>
        <li><strong>"Refund it"</strong>: we remove it, refund it and send the rest of your order</li>
        <li><strong>"Send an alternative"</strong>: tell us what would work for you</li>
        <li><strong>"I'll wait"</strong>: we send it as soon as it's back</li>
      </ul>
      ${link ? `<div class="cta"><a href="${link}" class="button">View your order</a></div>` : ''}`,
  })
  const sends: Array<[Channel, () => Promise<unknown>]> = []
  if (o.email)
    sends.push([
      'email',
      () =>
        sendAuditedMail({
          to: o.email,
          from,
          subject: `An item in your order ${o.order_number} is unavailable`,
          html,
          kind: 'order',
          templateName: 'order_item_unavailable',
          entityType: 'orders',
          entityId: orderId,
          userId: o.user_id,
        }),
    ])
  if (whatsapp)
    sends.push([
      'whatsapp',
      async () => {
        if (!(await sendItemUnavailableWhatsApp({ phone: o.phone, orderNumber: o.order_number, item: `${item} × ${Number(o.quantity)}` })))
          throw new Error('WhatsApp not sent')
      },
    ])
  const results = await askAboutOrder('out_of_stock', orderId, () => Promise.allSettled(sends.map(([, send]) => send())), { refId: itemId })
  const channels = sends.filter((_, i) => results[i].status === 'fulfilled').map(([c]) => c)
  if (!channels.length) {
    const err = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    return { ok: false, error: err?.reason instanceof Error ? err.reason.message : 'Could not ask the customer', status: 502 }
  }
  return { ok: true, channels }
}
