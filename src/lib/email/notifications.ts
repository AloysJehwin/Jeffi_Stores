import 'server-only'
import {
  sendAuditedMail,
  mailShell,
  createAdminNotification,
  getAdminNotificationEmails,
  customerMailFromAsync,
  adminMailFrom,
  currentBrandNameAsync,
  currentAdminBaseUrl,
  platformAdminEmail,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
} from './shared'

export async function sendNewReviewNotification(review: any, user: any, product: any) {
  const adminEmail = await getAdminNotificationEmails()
  const brand = await currentBrandNameAsync()

  const mailOptions = {
    from: adminMailFrom(),
    to: adminEmail,
    subject: `New Review Pending Approval - ${product.name}`,
    html: mailShell({
      brand,
      kicker: 'Action Required: Pending Approval',
      title: 'New Review Submitted',
      extraCss: `
        .stars { color: #ffc107; font-size: 20px; margin: 10px 0; }
      `,
      content: `
        <div class="card">
          <h3 style="margin-top: 0;">Review Details</h3>

          <div class="info-row">
            <span class="info-label">Product:</span>
            <span>${product.name}</span>
          </div>

          <div class="info-row">
            <span class="info-label">Customer:</span>
            <span>${user.first_name} ${user.last_name}</span>
          </div>

          <div class="info-row">
            <span class="info-label">Email:</span>
            <span>${user.email}</span>
          </div>

          <div class="info-row">
            <span class="info-label">Rating:</span>
            <span class="stars">${review.rating}/5</span>
          </div>

          ${
            review.is_verified_purchase
              ? `
          <div class="info-row">
            <span class="info-label">Status:</span>
            <span style="color: #28a745; font-weight: bold;">Verified Purchase</span>
          </div>
          `
              : ''
          }

          <div class="info-row">
            <span class="info-label">Submitted:</span>
            <span>${new Date(review.created_at).toLocaleString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}</span>
          </div>

          ${
            review.title
              ? `
          <div style="margin-top: 20px;">
            <strong>Review Title:</strong>
            <p style="margin: 5px 0; font-size: 16px;">${review.title}</p>
          </div>
          `
              : ''
          }

          <div class="warning">
            <strong>Review Comment:</strong>
            <p style="margin: 10px 0 0 0; white-space: pre-wrap;">${review.comment}</p>
          </div>
        </div>

        <div class="cta">
          <a href="${currentAdminBaseUrl()}/reviews" class="button" style="color:#ffffff;">
            Approve / Reject Review
          </a>
        </div>
      `,
      footerLines: [
        `This is an automated notification from ${brand} Admin Panel`,
        'Please review and approve/reject this review from the admin dashboard',
      ],
    }),
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'new_review',
      entityType: 'product_reviews',
      entityId: review?.id ?? null,
      userId: user?.id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPaymentFailedAdminNotification(
  order: {
    order_number: string
    id: string
    customer_name: string
    customer_email: string
    total_amount: string | number
    customer_phone?: string
  },
  errorDescription?: string
) {
  const adminEmail = await getAdminNotificationEmails()

  createAdminNotification({
    type: 'payment_failed',
    category: 'orders',
    title: `Payment failed — ${order.order_number}`,
    message: errorDescription || `Payment failed for ${order.customer_name}`,
    link: `/admin/orders/${order.id}`,
    entityType: 'order',
    entityId: String(order.id),
    severity: 'warning',
    scope: 'orders:read',
  }).catch(() => {})

  const brand = await currentBrandNameAsync()
  const mailOptions = {
    from: adminMailFrom(),
    to: adminEmail,
    subject: `[Payment Failed] Order ${order.order_number}`,
    html: mailShell({
      brand,
      kicker: 'Admin Notification',
      title: 'Payment Failed',
      content: `
        <div class="danger">
          <p style="font-size: 18px; margin: 0;"><strong>Order #${order.order_number}</strong></p>
        </div>

        <div class="card">
          <h3>Customer Information</h3>
          <p><strong>Name:</strong> ${order.customer_name}</p>
          <p><strong>Email:</strong> ${order.customer_email}</p>
          ${order.customer_phone ? `<p><strong>Phone:</strong> ${order.customer_phone}</p>` : ''}
        </div>

        <div class="card">
          <h3>Payment Details</h3>
          <p><strong>Order Amount:</strong> ₹${parseFloat(String(order.total_amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          <p><strong>Status:</strong> <span style="color: #ef4444; font-weight: bold;">FAILED</span></p>
          ${errorDescription ? `<p><strong>Reason:</strong> ${errorDescription}</p>` : ''}
          <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</p>
        </div>

        <div class="warning">
          <h4 style="margin-top: 0;">Auto-Cancel in 10 Minutes</h4>
          <p>The customer has been notified and given a <strong>10-minute window</strong> to retry payment. If payment is not completed, the order will be automatically cancelled and stock restored.</p>
        </div>

        <div class="cta">
          <a href="${currentAdminBaseUrl()}/orders/${order.id}" class="button">
            View Order in Admin Panel
          </a>
        </div>
      `,
    }),
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'payment_failed_admin',
      entityType: 'orders',
      entityId: order?.id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminContactEmail(
  email: string,
  name: string,
  subject: string,
  message: string,
  opts: { isHtml?: boolean; entityType?: string; entityId?: string } = {}
) {
  const contactLine = await storeContactLine()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const messageHtml = opts.isHtml ? message : message.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const mailOptions = {
    from: await customerMailFromAsync(),
    to: email,
    subject,
    html: mailShell({
      brand,
      kicker: 'Message from our team',
      title: subject,
      extraCss: `
        .message-box { background-color: #fff; border-left: 4px solid #2563eb; padding: 20px; border-radius: 4px; margin: 20px 0;${opts.isHtml ? '' : ' white-space: pre-wrap;'} }
      `,
      content: `<div class="message-box">${messageHtml}</div>`,
      footerLines: [
        `This message was sent by the ${brand} team. Please do not reply directly to this email.`,
        address,
        contactLine,
      ],
    }),
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'admin_contact',
      ...(opts.entityType && opts.entityId ? { entityType: opts.entityType, entityId: opts.entityId } : {}),
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendSupportEscalationEmail(
  customerName: string,
  customerEmail: string,
  customerId: string,
  sessionId: string,
  adminEmails: string[]
): Promise<{ success: boolean; error?: unknown }> {
  // Three things were wrong here: the link went to the platform's admin panel, which a
  // tenant's certificate cannot open; the sender was the platform's; and the fallback
  // recipient was a personal Gmail, so a tenant's support request reached an individual.
  const chatLink = `${currentAdminBaseUrl()}/customers/${customerId}?chat=true`
  const recipients = adminEmails.length > 0 ? adminEmails : [platformAdminEmail()]
  const brand = await currentBrandNameAsync()

  const mailOptions = {
    from: await customerMailFromAsync(),
    to: recipients.join(', '),
    subject: `Support Request from ${customerName}`,
    html: mailShell({
      brand,
      kicker: 'Admin Notification',
      title: 'New Support Chat Request',
      content: `
        <p>A customer has requested to connect with a support agent.</p>
        <div class="info">
          <p style="margin:0 0 6px"><strong>Name:</strong> ${customerName}</p>
          <p style="margin:0 0 6px"><strong>Email:</strong> ${customerEmail}</p>
          <p style="margin:0"><strong>Session ID:</strong> ${sessionId}</p>
        </div>
        <p>Click below to open the customer profile and join the chat:</p>
        <div class="cta"><a href="${chatLink}" class="button">Open Support Chat</a></div>
      `,
      footerLines: [`${brand} Admin Notification — do not reply to this email.`],
    }),
  }

  try {
    await sendAuditedMail({
      ...mailOptions,
      kind: 'support',
      templateName: 'support_escalation',
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAgentConnectedEmail(
  customerName: string,
  customerEmail: string,
  agentName: string
): Promise<{ success: boolean; error?: unknown }> {
  const appUrl = await storeBaseUrlAsync()
  const chatLink = `${appUrl}/support`
  const brand = await currentBrandNameAsync()

  const mailOptions = {
    from: await customerMailFromAsync(),
    to: customerEmail,
    subject: `A support agent has joined your chat`,
    html: mailShell({
      brand,
      kicker: 'Support',
      title: `Hi ${customerName}, your support agent is here!`,
      content: `
        <p>A support agent has joined your chat and is ready to help you.</p>
        <div class="info">
          <p style="margin:0"><strong>Agent:</strong> ${agentName}</p>
        </div>
        <p>Click below to return to the chat:</p>
        <div class="cta"><a href="${chatLink}" class="button">Return to Chat</a></div>
        <p class="muted">If you no longer need assistance, you can close the chat from the support page.</p>
      `,
      footerLines: [`${brand} Support — do not reply to this email.`],
    }),
  }

  try {
    await sendAuditedMail({
      ...mailOptions,
      kind: 'support',
      templateName: 'agent_connected',
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}
