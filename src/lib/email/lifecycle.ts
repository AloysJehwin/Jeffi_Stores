import 'server-only'
import {
  sendAuditedMail,
  mailShell,
  storeName,
  escapeHtml,
  createAdminNotification,
  getAdminNotificationEmails,
  customerMailFromAsync,
  adminMailFrom,
  currentBrandNameAsync,
  currentAdminBaseUrl,
  platformAdminEmail,
  storeContactLine,
  storeBaseUrlAsync,
  type AnnouncementProduct,
} from './shared'

export async function sendOrderAutoCancelledEmail(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderId: string,
  orderType: string,
  orderTotal: number,
  redirectPath: string
) {
  const contactLine = await storeContactLine()
  const baseUrl = await storeBaseUrlAsync()
  const brand = await currentBrandNameAsync()
  const isDirect = orderType === 'direct'
  const ctaLabel = isDirect ? 'Place Order Again' : 'Return to Cart'
  const bodyMessage = isDirect
    ? 'Your order was automatically cancelled because payment was not completed within the 10-minute window. You can place the order again from the product page below.'
    : 'Your order was automatically cancelled because payment was not completed within the 10-minute window. The items have been returned to your cart so you can try again.'

  const mailOptions = {
    from: await customerMailFromAsync(),
    to: customerEmail,
    subject: `Order Cancelled - ${orderNumber}`,
    html: mailShell({
      brand,
      kicker: 'Order Update',
      title: 'Order Cancelled',
      extraCss: `
        .badge { background-color: #ef4444; color: white; font-size: 18px; font-weight: bold; text-align: center; padding: 15px 20px; border-radius: 8px; margin: 20px 0; text-transform: uppercase; }
        .amount-box { background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .amount { font-size: 28px; font-weight: bold; color: #2563eb; }
      `,
      content: `
        <p>Dear ${customerName},</p>
        <div class="badge">Order Auto-Cancelled</div>
        <p>${bodyMessage}</p>
        <div class="amount-box">
          <p style="margin:0;color:#666;">Order Number</p>
          <div style="font-size:18px;font-weight:bold;">${orderNumber}</div>
          <p style="margin:10px 0 0;color:#666;">Amount</p>
          <div class="amount">₹${orderTotal.toFixed(2)}</div>
        </div>
        <div class="warning">
          <strong>What happened?</strong><br>
          Payment for this order was not received within 10 minutes of placing it, so the order was automatically cancelled and stock was released.
        </div>
        <div class="cta">
          <a href="${baseUrl}${redirectPath}" class="button" style="color:#ffffff;">${ctaLabel}</a>
        </div>
        <p style="margin-top:25px;">If you completed the payment but still received this email, please contact us so we can reconcile your transaction.</p>
      `,
      footerLines: [contactLine || 'Need help? Reply to this email.', `&copy; ${new Date().getFullYear()} ${brand}`],
    }),
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'order',
      templateName: 'order_auto_cancelled',
      entityType: 'orders',
      entityId: orderId ?? null,
      metadata: { orderNumber, orderType, orderTotal },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderAutoCancelledAdminNotification(order: any, redirectPath: string) {
  const adminEmail = await getAdminNotificationEmails()
  createAdminNotification({
    type: 'order_auto_cancelled',
    category: 'orders',
    title: `Auto-cancelled — ${order.order_number}`,
    message: `Payment window expired for ${order.customer_name || 'customer'}`,
    link: `/admin/orders/${order.id}`,
    entityType: 'order',
    entityId: String(order.id),
    severity: 'warning',
    scope: 'orders:read',
  }).catch(() => {})
  const baseUrl = currentAdminBaseUrl()
  const total = parseFloat(order.total_amount || 0)
  const brand = await currentBrandNameAsync()

  const mailOptions = {
    from: adminMailFrom(),
    to: adminEmail,
    subject: `[Auto-Cancelled] Order ${order.order_number}`,
    html: mailShell({
      brand,
      kicker: 'Admin Notification',
      title: 'Order Auto-Cancelled (Payment Timeout)',
      extraCss: `
        .badge { background-color: #ef4444; color: white; font-size: 16px; font-weight: bold; text-align: center; padding: 12px; border-radius: 8px; margin: 15px 0; }
        td.label { color: #666; width: 40%; }
      `,
      content: `
        <div class="badge">10-MINUTE PAYMENT WINDOW EXPIRED</div>
        <p>An order was automatically cancelled because the customer did not complete payment within 10 minutes.</p>
        <table class="rows">
          <tr><td class="label">Order Number</td><td><strong>${order.order_number}</strong></td></tr>
          <tr><td class="label">Customer</td><td>${order.customer_name || ''} &lt;${order.customer_email || ''}&gt;</td></tr>
          <tr><td class="label">Order Type</td><td>${order.order_type || 'cart'}</td></tr>
          <tr><td class="label">Amount</td><td>₹${total.toFixed(2)}</td></tr>
          <tr><td class="label">Customer Redirected To</td><td>${redirectPath}</td></tr>
        </table>
        <p>Stock has been released. ${order.order_type === 'direct' ? 'Items were not restored to a cart (direct order).' : 'Items were restored to the customer cart.'}</p>
        <div class="cta">
          <a href="${baseUrl}/admin/orders/${order.id}" class="button" style="color:#ffffff;">View Order in Admin</a>
        </div>
      `,
    }),
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'order_auto_cancelled_admin',
      entityType: 'orders',
      entityId: order?.id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderDelayNotification(args: {
  toEmail: string
  customerName: string
  orderNumber: string
  delayDays: number
  reason: string
}) {
  const { toEmail, customerName, orderNumber, delayDays, reason } = args
  const dayLabel = delayDays === 1 ? 'day' : 'days'
  const brand = await currentBrandNameAsync()
  const subject = `Update on your ${brand} order ${orderNumber}`
  const html = mailShell({
    brand,
    kicker: 'Order Update',
    title: subject,
    content: `
      <p>Hi ${customerName},</p>
      <p>We're writing to let you know that your order <strong>${orderNumber}</strong> will be delayed by approximately <strong>${delayDays} ${dayLabel}</strong>.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>We're sorry for the inconvenience. We'll send you another update as soon as the situation changes, and your order is on its way.</p>
      <p>If you have any questions, just reply to this email and we'll get back to you.</p>
      <p style="margin:24px 0 0;color:#475569;">Thank you for your patience,<br>The ${brand} team</p>
    `,
    footerLines: [
      `This is an automated update about order ${orderNumber}. Please do not reply with sensitive information.`,
    ],
  })
  const text = `Hi ${customerName},

Your order ${orderNumber} will be delayed by approximately ${delayDays} ${dayLabel}.

Reason: ${reason}

We're sorry for the inconvenience. We'll send another update as soon as the situation changes.

If you have any questions, just reply to this email.

— The ${brand} team`

  try {
    const info = await sendAuditedMail({
      from: await customerMailFromAsync(),
      to: toEmail,
      subject,
      html,
      text,
      kind: 'order',
      templateName: 'order_delay',
      entityType: 'orders',
      entityId: null,
      metadata: { orderNumber, delayDays, reason },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendProductAnnouncementEmail(args: {
  toEmail: string
  customerName?: string
  subject: string
  intro: string
  products: AnnouncementProduct[]
}) {
  const { toEmail, customerName, subject, intro, products } = args
  const siteUrl = await storeBaseUrlAsync()
  const brand = await currentBrandNameAsync()
  const cleanIntro = intro
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\(https?:[^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const cards = products
    .map(
      p => `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff;">
      <tr>
        ${p.primary_image_url ? `<td width="120" style="vertical-align:top;padding:12px;"><img src="${escapeHtml(p.primary_image_url)}" alt="" width="100" height="100" style="display:block;border-radius:6px;object-fit:cover;"></td>` : ''}
        <td style="padding:14px 16px 14px ${p.primary_image_url ? '0' : '16px'};vertical-align:top;">
          <a href="${siteUrl}/products/${escapeHtml(p.slug)}" style="text-decoration:none;color:#1a3a4a;font-weight:600;font-size:15px;">${escapeHtml(p.name)}</a>
          ${p.short_description ? `<p style="margin:4px 0 6px;color:#475569;font-size:13px;line-height:1.4;">${escapeHtml(p.short_description.slice(0, 140))}</p>` : ''}
          <p style="margin:6px 0 0;font-weight:600;color:#0f172a;font-size:14px;">₹${escapeHtml(p.price)}</p>
        </td>
      </tr>
    </table>`
    )
    .join('')

  const html = mailShell({
    brand,
    kicker: 'Product Updates',
    title: subject,
    content: `
      <p style="margin:0 0 12px;font-size:15px;">Hi ${escapeHtml(customerName || 'there')},</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#334155;">${escapeHtml(cleanIntro)}</p>
      ${cards}
      <p class="muted">Visit <a href="${siteUrl}" style="color:#2563eb;">${escapeHtml(brand)}</a> for the full catalogue.</p>
    `,
    footerLines: [
      `You are receiving this because you opted in to product updates from ${escapeHtml(brand)}. To stop receiving these, reply to this email with "unsubscribe".`,
    ],
  })

  const textProducts = products.map(p => `• ${p.name} — ₹${p.price}\n  ${siteUrl}/products/${p.slug}`).join('\n\n')
  const text = `Hi ${customerName || 'there'},\n\n${cleanIntro}\n\n${textProducts}\n\nVisit ${siteUrl} for the full catalogue.\n\n— ${brand}`

  try {
    const info = await sendAuditedMail({
      from: await customerMailFromAsync(),
      to: toEmail,
      subject,
      html,
      text,
      kind: 'campaign',
      templateName: 'product_announcement',
      metadata: { productCount: products.length, productIds: products.map(p => p.id) },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

// Admin-initiated post-order variant/sub-variant change awaiting customer approval.
// Shows old → new variant, the price difference (refund owed / extra due /
// COD-adjusted total), and a link to confirm on the order page.
export async function sendVariantChangeRequestedEmail(params: {
  customerEmail: string
  customerName: string
  orderNumber: string
  orderId: string
  oldVariantName: string | null
  newVariantName: string | null
  priceDiff: number
  settlementType: 'refund' | 'collect' | 'cod_adjust' | 'none'
  newTotal: number
}): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const orderUrl = `${await storeBaseUrlAsync()}/account/orders/${params.orderId}`
  const absDiff = Math.abs(params.priceDiff)
  const diffLine =
    params.settlementType === 'refund'
      ? `We'll <strong>refund &#8377;${absDiff.toFixed(2)}</strong> to your original payment once you confirm.`
      : params.settlementType === 'collect'
        ? `An additional <strong>&#8377;${absDiff.toFixed(2)}</strong> is payable — you'll be asked to pay it securely when you confirm.`
        : params.settlementType === 'cod_adjust'
          ? `Your order total will be updated to <strong>&#8377;${params.newTotal.toFixed(2)}</strong> (payable on delivery).`
          : `There is no change to your total.`

  const subject = `Action needed: variant change on order ${params.orderNumber}`
  const html = mailShell({
    brand,
    kicker: 'Order Update',
    title: 'Variant change requested',
    content: `
      <p>Hi ${params.customerName || 'there'},</p>
      <p>For your order <strong>${params.orderNumber}</strong>, we'd like to substitute an item with a near-equivalent variant. Please review and confirm:</p>
      <div class="card">
        <p style="margin:0 0 6px;"><span style="color:#6b7280;">Current:</span> ${params.oldVariantName || '&#8212;'}</p>
        <p style="margin:0;"><span style="color:#6b7280;">Proposed:</span> <strong>${params.newVariantName || '&#8212;'}</strong></p>
      </div>
      <p>${diffLine}</p>
      <div class="cta">
        <a href="${orderUrl}" class="button">Review &amp; Confirm</a>
      </div>
      <p class="muted" style="text-align:center;">The change is applied only after you confirm. You can also decline it.</p>
    `,
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: params.customerEmail,
      subject,
      html,
      kind: 'variant_change_requested',
      templateName: 'variant_change_requested',
      entityType: 'orders',
      entityId: params.orderId,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

/**
 * Operational report for background jobs (marketplace syncs and similar).
 *
 * These used to build their own nodemailer transport and send bare <h2>/<ul> HTML, so they
 * looked nothing like the rest of the system's mail and — because they bypassed the audited
 * sender — never appeared in /admin/audit?tab=mail_log. Services should not send mail
 * themselves; they describe what happened and the email service renders and records it.
 */
export async function sendOperationalReport(opts: {
  title: string
  startedAt?: string
  finishedAt?: string
  stats?: Record<string, string | number>
  errors?: { sku: string; error: string }[]
  kind?: string
}): Promise<void> {
  const { sendAuditedMail } = await import('../mail-audit')
  const esc = (t: unknown) =>
    String(t ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const errs = opts.errors ?? []
  const shown = errs.slice(0, 20)
  const rows = Object.entries(opts.stats ?? {})
    .map(
      ([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280">${esc(k)}</td>
        <td style="padding:4px 0;font-weight:bold;color:#111827">${esc(v)}</td></tr>`
    )
    .join('')

  const errorBlock = shown.length
    ? `<h3 style="margin:22px 0 8px;font-size:14px;color:#111827">Errors</h3>
       <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.7">
         ${shown.map(e => `<li><strong>${esc(e.sku)}</strong>: ${esc(e.error)}</li>`).join('')}
       </ul>
       ${errs.length > shown.length ? `<p style="color:#6b7280;font-size:12px">…and ${errs.length - shown.length} more.</p>` : ''}`
    : `<p style="color:#059669;font-size:13px;margin:18px 0 0">No errors.</p>`

  await sendAuditedMail({
    to: (await import('../brand')).platformAdminEmail(),
    from: adminMailFrom(),
    subject: `[${storeName()}] ${opts.title}${errs.length ? ` — ${errs.length} error(s)` : ''}`,
    kind: opts.kind ?? 'operational_report',
    html: mailShell({
      brand: storeName(),
      kicker: 'Operational Report',
      title: opts.title,
      content: `
        <table style="border-collapse:collapse;font-size:13px">
          ${opts.startedAt ? `<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Started</td><td style="padding:4px 0;color:#111827">${esc(opts.startedAt)}</td></tr>` : ''}
          ${opts.finishedAt ? `<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Finished</td><td style="padding:4px 0;color:#111827">${esc(opts.finishedAt)}</td></tr>` : ''}
          ${rows}
        </table>
        ${errorBlock}
      `,
      footerLines: [`Automated report from ${esc(storeName())}.`],
    }),
  })
}
