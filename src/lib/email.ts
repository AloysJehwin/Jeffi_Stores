import 'server-only'
import nodemailer from 'nodemailer'
import { queryMany } from './db'
import { sendAuditedMail } from './mail-audit'
import {
  customerMailFromAsync,
  adminMailFrom,
  currentBrandName,
  currentBrandNameAsync,
  currentAdminBaseUrl,
  platformAdminEmail,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
} from './brand'
import { createAdminNotification } from './admin-notify'
import { mailShell } from './mail-template'

/**
 * Store name for email bodies. Synchronous on purpose: templates are built inside string
 * literals, and currentBrandName reads the tenant from AsyncLocalStorage, so it resolves the
 * right store without making every template function await a lookup.
 */
const storeName = currentBrandName

export const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

async function getAdminNotificationEmails(): Promise<string> {
  try {
    // 'administrator' is the top role (scopes.ts SUPER_ROLES = ['administrator','super_admin'])
    // and was missing here, so the actual administrative mailbox — admin@jeffistores.in, whose
    // role IS 'administrator' — was excluded from every admin notification while a personal
    // gmail account received them instead.
    const rows = await queryMany<{ email: string }>(
      `SELECT u.email FROM admins a
       JOIN users u ON u.id = a.user_id
       WHERE a.is_active = TRUE
         AND a.role IN ('administrator', 'super_admin', 'admin')
         AND u.email IS NOT NULL
       ORDER BY a.role = 'administrator' DESC, a.role = 'super_admin' DESC`,
      []
    )
    if (rows.length > 0) return rows.map(r => r.email).join(', ')
  } catch {
    /* fall back to ADMIN_EMAIL below */
  }
  // Default is the administrative mailbox on the platform domain, not a personal address.
  return process.env.ADMIN_EMAIL || 'admin@jeffistores.in'
}

export async function sendOTPEmail(email: string, otp: string, name?: string) {
  const contactLine = await storeContactLine()
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const subject = `Your Verification Code - ${brand}`
  const html = mailShell({
    brand,
    kicker: 'Verification Code',
    title: 'Email Verification',
    preheader: `Your ${brand} OTP is ${otp} — valid for 10 minutes. Do not share.`,
    content: `
      <p>Hello ${name || 'Customer'},</p>
      <p>Thank you for registering. Please use the following One-Time Password (OTP) to verify your email address:</p>

      <div class="code-box">${otp}</div>

      <div class="warning">
        <strong>This OTP will expire in 10 minutes.</strong>
        <br>
        <small>Please do not share this code with anyone.</small>
      </div>

      <p>If you didn't request this verification code, please ignore this email or contact our support team.</p>
    `,
    footerLines: [address, contactLine],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      kind: 'otp',
      templateName: 'otp',
      redactBody: true,
      entityType: null,
      entityId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminOTPEmail(email: string, otp: string, name?: string) {
  const from = adminMailFrom()
  const brand = await currentBrandNameAsync()
  const subject = `Admin sign-in code — ${brand}`
  const html = mailShell({
    brand,
    kicker: 'Admin Access',
    title: 'Verify your admin sign-in',
    preheader: `${brand} admin sign-in code: ${otp} — valid for 10 minutes. If this wasn't you, do not share it.`,
    content: `
      <p>Hello ${name || 'Admin'},</p>
      <p>Use this one-time code to complete sign-in to the admin dashboard:</p>

      <div class="code-box mono">${otp}</div>

      <div class="danger">
        <strong>This code authorizes staff access. It expires in 10 minutes.</strong>
        <br>
        <small>If you didn't try to sign in, ignore this email and rotate your credentials.</small>
      </div>
    `,
    footerLines: [`${brand} — administrative access`, 'This is an automated security message. Do not reply.'],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      kind: 'otp',
      templateName: 'admin_otp',
      redactBody: true,
      entityType: null,
      entityId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendWelcomeEmail(email: string, name: string) {
  const baseUrl = await storeBaseUrlAsync()
  const contactLine = await storeContactLine()
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const subject = `Welcome to ${brand}!`
  const html = mailShell({
    brand,
    kicker: 'Your account is ready',
    title: `Welcome to ${brand}!`,
    preheader: `Welcome to ${brand}! Your account is ready.`,
    content: `
      <p>Hello ${name},</p>
      <p>Thank you for creating an account with us. We're excited to have you on board!</p>

      <p>With your account you can:</p>
      <ul>
        <li>Browse our full catalogue</li>
        <li>Track your orders</li>
        <li>Check out faster</li>
        <li>Get expert service and support</li>
      </ul>

      <div class="cta">
        <a href="${baseUrl}/products" class="button" style="color:#ffffff;">
          Start Shopping
        </a>
      </div>

      <p>If you have any questions or need assistance, feel free to reach out to our team.</p>
    `,
    footerLines: [address, contactLine],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      kind: 'welcome',
      templateName: 'welcome',
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderConfirmationEmail(email: string, order: any, orderItems: any[]) {
  const contactLine = await storeContactLine().then(c => (c ? `<p>${c}</p>` : ''))
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const subject = `Order Received - ${order.order_number}`
  const html = mailShell({
    brand,
    kicker: 'Order Confirmation',
    title: 'Order Received!',
    preheader: `Order confirmed! We've received your order and will keep you updated on dispatch.`,
    extraCss: `
      .order-box { background-color: #e3f2fd; border: 2px solid #2563eb; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .total { background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: right; }
    `,
    content: `
      <p>Hello ${order.customer_name},</p>
      <p>Thank you for your order! We've received your order and payment — our team is preparing it and will keep you updated on dispatch.</p>

      <div class="order-box">
        <h3 style="margin-top: 0;">Order Details</h3>
        <p><strong>Order Number:</strong> ${order.order_number}</p>
        <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}</p>
        <p><strong>Status:</strong> <span style="color: #16a34a; font-weight: bold;">CONFIRMED</span></p>
        ${
          order.taxable_amount > 0
            ? `
        <p><strong>GSTIN:</strong> 22AQFPJ2897M1ZG</p>
        `
            : ''
        }
      </div>

      <h3>Order Items</h3>
      <table class="rows">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          ${orderItems
            .map(
              item => `
            <tr>
              <td>${item.product_name}</td>
              <td>${item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : Math.round(Number(item.quantity))}</td>
              <td>₹${item.total_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>

      <div class="total">
        ${
          order.taxable_amount > 0
            ? `
        <p style="margin: 3px 0; font-size: 14px;">Taxable Amount: ₹${Number(order.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        ${
          order.is_igst
            ? `<p style="margin: 3px 0; font-size: 14px;">IGST: ₹${Number(order.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>`
            : `<p style="margin: 3px 0; font-size: 14px;">CGST: ₹${Number(order.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
             <p style="margin: 3px 0; font-size: 14px;">SGST: ₹${Number(order.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>`
        }
        <hr style="border: none; border-top: 1px solid #ccc; margin: 8px 0;">
        `
            : ''
        }
        <h3 style="margin: 0;">Total Amount: ₹${order.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h3>
      </div>

      <div class="success">
        <h4 style="margin-top: 0;">What happens next?</h4>
        <p style="margin: 5px 0;">Your payment has been received. We're now preparing your order for dispatch. You'll receive another email once your order is on its way.</p>
      </div>

      <p>If you have any questions, feel free to contact us:</p>
      ${contactLine}
    `,
    footerLines: [address],
  })
  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      attachments: [],
      kind: 'order',
      templateName: 'order_confirmation',
      entityType: 'orders',
      entityId: order?.id ?? null,
      userId: order?.user_id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendNewOrderNotification(order: any, orderItems: any[], _user: any) {
  const adminEmail = await getAdminNotificationEmails()

  createAdminNotification({
    type: 'order_paid',
    category: 'orders',
    title: `New order ${order.order_number}`,
    message: order.total_amount != null ? `Total ₹${order.total_amount}` : null,
    link: order.id ? `/admin/orders/${order.id}` : '/admin/orders',
    entityType: 'order',
    entityId: order.id ? String(order.id) : null,
    scope: 'orders:read',
  }).catch(() => {})

  const from = adminMailFrom()
  const brand = await currentBrandNameAsync()
  const subject = `New Order - ${order.order_number}`
  const html = mailShell({
    brand,
    kicker: 'Admin Notification',
    title: 'New Order Received!',
    content: `
      <div class="success">
        <p style="font-size: 18px; margin: 0;"><strong>Order #${order.order_number}</strong></p>
      </div>

      <div class="card">
        <h3>Customer Information</h3>
        <p><strong>Name:</strong> ${order.customer_name}</p>
        <p><strong>Email:</strong> ${order.customer_email}</p>
        <p><strong>Phone:</strong> ${order.customer_phone || 'Not provided'}</p>
      </div>

      <div class="card">
        <h3>Order Information</h3>
        <p><strong>Order Number:</strong> ${order.order_number}</p>
        <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleString('en-IN')}</p>
        <p><strong>Status:</strong> PENDING</p>
        ${order.notes ? `<p><strong>Customer Notes:</strong> ${order.notes}</p>` : ''}
      </div>

      <h3>Order Items</h3>
      <table class="rows">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${orderItems
            .map(
              item => `
            <tr>
              <td>${item.product_name}</td>
              <td>${item.product_sku}</td>
              <td>${item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : Math.round(Number(item.quantity))}</td>
              <td>₹${item.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td>₹${item.total_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          `
            )
            .join('')}
          <tr style="background-color: #fff3cd; font-weight: bold;">
            <td colspan="4" style="text-align: right;">Total:</td>
            <td>₹${order.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          </tr>
        </tbody>
      </table>

      <div class="warning">
        <h4 style="margin-top: 0;">Action Required</h4>
        <p>Please contact the customer within 24 hours to confirm the order and payment details.</p>
      </div>

      <div class="cta">
        <a href="${currentAdminBaseUrl()}/orders/${order.id}" class="button">
          View Order in Admin Panel
        </a>
      </div>
    `,
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: adminEmail,
      subject,
      html,
      kind: 'admin_notification',
      templateName: 'new_order_admin',
      entityType: 'orders',
      entityId: order?.id ?? null,
      userId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderStatusUpdate(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderId: string,
  newStatus: string,
  previousStatus?: string,
  invoicePdfBuffer?: Buffer | null,
  cancellationNote?: string
) {
  const baseUrl = await storeBaseUrlAsync()
  const contactLine = await storeContactLine()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const statusMessages: Record<string, { title: string; message: string; color: string }> = {
    pending: {
      title: 'Order Received',
      message: 'We have received your order and are preparing it for processing.',
      color: '#ffc107',
    },
    confirmed: {
      title: 'Order Confirmed',
      message: 'Your order has been confirmed and is being prepared for shipment.',
      color: '#2563eb',
    },
    processing: {
      title: 'Order Processing',
      message: 'Your order is currently being processed and will be shipped soon.',
      color: '#2563eb',
    },
    shipped: {
      title: 'Order Shipped',
      message: 'Great news! Your order has been shipped and is on its way to you.',
      color: '#8b5cf6',
    },
    out_for_delivery: {
      title: 'Out for Delivery',
      message: 'Your order is out for delivery today! Our delivery partner will arrive soon.',
      color: '#6366f1',
    },
    delivered: {
      title: 'Order Delivered',
      message: 'Your order has been successfully delivered. Thank you for shopping with us!',
      color: '#10b981',
    },
    cancelled: {
      title: 'Order Cancelled',
      message:
        'Your order has been cancelled. If you did not request this cancellation, please contact us immediately.',
      color: '#ef4444',
    },
    cancel_requested: {
      title: 'Cancellation Request Received',
      message:
        'We have received your cancellation request. Our team will review it and notify you once it is approved or rejected.',
      color: '#f97316',
    },
    cancel_rejected: {
      title: 'Cancellation Request Rejected',
      message: 'We were unable to process your cancellation request. Your order will continue as normal.',
      color: '#6b7280',
    },
  }

  const statusInfo = statusMessages[newStatus] || {
    title: 'Order Update',
    message: `Your order status has been updated to: ${newStatus}`,
    color: '#6b7280',
  }

  const from = await customerMailFromAsync()
  const subject = `${statusInfo.title} - Order ${orderNumber}`
  const html = mailShell({
    brand,
    kicker: 'Order Update',
    title: statusInfo.title,
    preheader: `${statusInfo.title} — Order #${orderNumber}. ${statusInfo.message}`,
    extraCss: `
      .status-badge { background-color: ${statusInfo.color}; color: white; font-size: 18px; font-weight: bold; text-align: center; padding: 15px 20px; border-radius: 8px; margin: 20px 0; text-transform: uppercase; }
    `,
    content: `
      <p>Hello ${customerName},</p>
      <p>${statusInfo.message}</p>

      ${
        cancellationNote
          ? `
      <div class="danger">
        <h4 style="margin-top: 0; color: #b91c1c;">Reason</h4>
        <p style="margin: 0;">${cancellationNote}</p>
      </div>
      `
          : ''
      }

      <div class="status-badge">${newStatus}</div>

      <div class="card">
        <h3 style="margin-top: 0;">Order Details</h3>
        <p><strong>Order Number:</strong> ${orderNumber}</p>
        <p><strong>Order ID:</strong> ${orderId}</p>
        ${previousStatus ? `<p><strong>Previous Status:</strong> ${previousStatus}</p>` : ''}
        <p><strong>Updated:</strong> ${new Date().toLocaleString('en-IN', {
          dateStyle: 'long',
          timeStyle: 'short',
        })}</p>
      </div>

      ${
        newStatus === 'shipped'
          ? `
        <div class="info">
          <h4 style="margin-top: 0; color: #1e40af;">Your order is on its way!</h4>
          <p>Track your shipment live by visiting your order page:</p>
          <p style="text-align: center; margin: 0;">
            <a href="${baseUrl}/account/orders/${orderId}" class="button" style="padding: 10px 24px; font-size: 14px;">
              Track Your Order
            </a>
          </p>
        </div>
      `
          : ''
      }

      ${
        newStatus === 'delivered'
          ? `
        <div class="info">
          <h4 style="margin-top: 0;">Thank You!</h4>
          <p>We hope you're satisfied with your purchase. If you have any questions or concerns, please don't hesitate to contact us.</p>
        </div>
      `
          : ''
      }

      <div class="cta">
        <a href="${baseUrl}/account/orders/${orderId}" class="button" style="color:#ffffff;">
          View Order Details
        </a>
      </div>

      <p>If you have any questions about your order, please feel free to contact us.</p>
    `,
    footerLines: [address, contactLine],
  })
  const attachments = invoicePdfBuffer
    ? [
        {
          filename: `Invoice-${orderNumber}.pdf`,
          content: invoicePdfBuffer,
          contentType: 'application/pdf',
        },
      ]
    : []

  try {
    const info = await sendAuditedMail({
      from,
      to: customerEmail,
      subject,
      html,
      attachments,
      kind: 'order',
      templateName: 'order_status_update',
      entityType: 'orders',
      entityId: orderId ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPaymentStatusUpdate(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderId: string,
  newPaymentStatus: string,
  orderTotal: number
) {
  const baseUrl = await storeBaseUrlAsync()
  const contactLine = await storeContactLine()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const paymentMessages: Record<string, { title: string; message: string; color: string }> = {
    paid: {
      title: 'Payment Received',
      message: 'We have received your payment successfully. Thank you!',
      color: '#10b981',
    },
    pending: {
      title: 'Payment Pending',
      message: 'Your payment is pending. Please complete the payment to proceed with your order.',
      color: '#ffc107',
    },
    failed: {
      title: 'Payment Failed',
      message:
        'Unfortunately, your payment could not be processed. You have 10 minutes from when the order was placed to retry payment before the order is automatically cancelled.',
      color: '#ef4444',
    },
    refunded: {
      title: 'Payment Refunded',
      message: 'Your payment has been refunded. It may take 5-7 business days to reflect in your account.',
      color: '#8b5cf6',
    },
  }

  const paymentInfo = paymentMessages[newPaymentStatus] || {
    title: 'Payment Update',
    message: `Your payment status has been updated to: ${newPaymentStatus}`,
    color: '#6b7280',
  }

  const from = await customerMailFromAsync()
  const subject = `${paymentInfo.title} - Order ${orderNumber}`
  const html = mailShell({
    brand,
    kicker: 'Payment Update',
    title: paymentInfo.title,
    preheader: `${paymentInfo.title} — Order #${orderNumber}. ${paymentInfo.message}`,
    extraCss: `
      .payment-badge { background-color: ${paymentInfo.color}; color: white; font-size: 18px; font-weight: bold; text-align: center; padding: 15px 20px; border-radius: 8px; margin: 20px 0; text-transform: uppercase; }
      .amount-box { background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
      .amount { font-size: 32px; font-weight: bold; color: #2563eb; }
    `,
    content: `
      <p>Hello ${customerName},</p>
      <p>${paymentInfo.message}</p>

      <div class="payment-badge">${newPaymentStatus}</div>

      <div class="amount-box">
        <p style="margin: 0; color: #666;">Order Amount</p>
        <div class="amount">₹${orderTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      </div>

      <div class="card">
        <h3 style="margin-top: 0;">Order Details</h3>
        <p><strong>Order Number:</strong> ${orderNumber}</p>
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Payment Status:</strong> ${newPaymentStatus}</p>
        <p><strong>Updated:</strong> ${new Date().toLocaleString('en-IN', {
          dateStyle: 'long',
          timeStyle: 'short',
        })}</p>
      </div>

      ${
        newPaymentStatus === 'paid'
          ? `
        <div class="info">
          <h4 style="margin-top: 0;">Payment Confirmed</h4>
          <p>Your order will now be processed and shipped as per the delivery schedule.</p>
        </div>
      `
          : ''
      }

      ${
        newPaymentStatus === 'pending'
          ? `
        <div class="info">
          <h4 style="margin-top: 0;">Action Required</h4>
          <p>Please complete your payment to avoid order cancellation. Contact us if you need assistance.</p>
        </div>
      `
          : ''
      }

      ${
        newPaymentStatus === 'refunded'
          ? `
        <div class="info">
          <h4 style="margin-top: 0;">Refund Processed</h4>
          <p>The refund has been initiated. Please allow 5-7 business days for the amount to reflect in your account.</p>
        </div>
      `
          : ''
      }

      ${
        newPaymentStatus === 'failed'
          ? `
        <div class="danger">
          <h4 style="margin-top: 0; color: #ef4444;">Action Required &mdash; 10 Minute Window</h4>
          <p>You have <strong>10 minutes</strong> from when the order was placed to complete payment. After that, the order will be automatically cancelled and items returned to your cart.</p>
          <p>Click the button below to retry payment now.</p>
        </div>
      `
          : ''
      }

      <div class="cta">
        <a href="${baseUrl}/account/orders/${orderId}" class="button" style="color:#ffffff;">
          View Order Details
        </a>
      </div>

      <p>If you have any questions about this payment update, please contact us.</p>
    `,
    footerLines: [address, contactLine],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: customerEmail,
      subject,
      html,
      kind: 'order',
      templateName: 'payment_status',
      entityType: 'orders',
      entityId: orderId ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminCertificateEmail(
  email: string,
  displayName: string,
  p12Buffer: Buffer,
  p12Password: string,
  serialNumber: string,
  expiresAt: string,
  role: string,
  tenant?: { slug: string; storeName: string }
) {
  // portal: invite only, never the .p12 or password. both: attachment plus the portal link. email: attachment only.
  const { certDeliveryMode, certPortalUrl } = await import('./cert-delivery')
  const mode = certDeliveryMode()
  if (mode === 'portal') {
    return sendCertInviteEmail(email, displayName, role, tenant)
  }
  const portalNote =
    mode === 'both'
      ? `
            <div class="info">
              <strong>Prefer to download it later?</strong>
              <p style="margin: 8px 0 0 0;">This certificate is also available once from the certificate portal at
                <a href="${certPortalUrl()}" style="color:#2563eb;">${certPortalUrl()}</a>.
                Sign in there with <strong>${email}</strong> (Google, or a one-time code sent to this address).</p>
            </div>
`
      : ''
  // Tenant owners are an ecom communication, so they come from ecommerce@; the platform's
  // own admin certs keep the existing admin sender.
  const from = tenant
    ? `"Jeffi Commerce" <${process.env.ECOM_FROM_EMAIL || 'ecommerce@jeffistores.in'}>`
    : adminMailFrom()
  const subject = tenant ? `Your admin certificate for ${tenant.storeName}` : 'Your Admin Certificate - Jeffi Stores'
  const certFileSlug = (displayName || email).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'admin'
  // A tenant owner administers their own store on their own host. Sending them to the
  // platform's admin panel gave them a certificate their browser was never asked for, and a
  // login they have no account on.
  const platformDomain = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  const adminUrl = tenant
    ? `https://admin-${tenant.slug}.${platformDomain}/admin/login`
    : `${currentAdminBaseUrl()}/login`
  const headerName = tenant ? tenant.storeName : storeName()
  const html = mailShell({
    brand: headerName,
    kicker: 'Admin Panel Access',
    title: `Welcome, ${displayName}!`,
    extraCss: `
      .credential-box { background-color: #1e293b; color: #e2e8f0; padding: 20px; border-radius: 8px; margin: 20px 0; font-family: monospace; }
      .credential-box .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
      .credential-box .value { color: #38bdf8; font-size: 16px; font-weight: bold; word-break: break-all; }
      .credential-box hr { border: none; border-top: 1px solid #334155; margin: 12px 0; }
    `,
    content: `
      <p>You have been added as an <strong>${role}</strong> on the ${headerName} admin panel. Your client certificate is attached to this email.</p>

      <div class="credential-box">
        <div class="label">Email</div>
        <div class="value">${email}</div>
        <hr>
        <div class="label">Certificate Password</div>
        <div class="value">${p12Password}</div>
        <hr>
        <div class="label">Certificate Serial</div>
        <div class="value" style="font-size: 11px;">${serialNumber}</div>
        <hr>
        <div class="label">Expires On</div>
        <div class="value">${new Date(expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      <div class="warning">
        <strong>Important Security Notice</strong>
        <ul style="margin: 8px 0 0 0; padding-left: 20px;">
          <li>The attached <code>.p12</code> certificate file is required to access the admin panel.</li>
          <li>Install it in your browser or system keychain using the password above.</li>
          <li>Do <strong>not</strong> share this certificate or password with anyone.</li>
          <li>This certificate is valid for 365 days from issuance.</li>
        </ul>
      </div>

      <div class="info">
        <strong>How to install:</strong>
        <ol style="margin: 8px 0 0 0; padding-left: 20px;">
          <li>Download the attached <code>${certFileSlug}-admin-cert.p12</code> file.</li>
          <li>Double-click the file to open it in your system's certificate manager.</li>
          <li>Enter the certificate password shown above when prompted.</li>
          <li>Navigate to <a href="${adminUrl}" style="color:#2563eb;"><strong>${adminUrl}</strong></a> to access the admin panel.</li>
        </ol>
      </div>

${portalNote}
      <p>If you have any questions, contact the super admin.</p>
    `,
    footerLines: tenant
      ? []
      : [
          'SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092',
          `Phone: +91 96853 54099 | Email: ${process.env.ADMIN_EMAIL || `admin@${platformDomain}`}`,
        ],
  })
  const attachments = [
    {
      filename: `${certFileSlug}-admin-cert.p12`,
      content: p12Buffer,
      contentType: 'application/x-pkcs12',
    },
  ]

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      attachments,
      kind: 'admin_notification',
      templateName: 'admin_certificate',
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

// Portal-era delivery: an INVITATION with no attachment and no password. The recipient signs in at
// certificate.jeffistores.in with this same Google (Gmail) account and downloads the cert once.
export async function sendCertInviteEmail(
  email: string,
  displayName: string,
  role: string,
  tenant?: { slug: string; storeName: string }
) {
  const { certPortalUrl } = await import('./cert-delivery')
  const portalUrl = certPortalUrl()
  const from = tenant
    ? `"Jeffi Commerce" <${process.env.ECOM_FROM_EMAIL || 'ecommerce@jeffistores.in'}>`
    : adminMailFrom()
  const platformDomain = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  const headerName = tenant ? tenant.storeName : storeName()
  const subject = `Access your admin certificate for ${headerName}`
  const esc = (s: string) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string)
  const html = mailShell({
    brand: headerName,
    kicker: 'Admin Panel Access',
    title: `You've been added as ${role} to ${headerName}`,
    content: `
      <p>To administer the store you need your admin certificate. For security we no longer send
         it as an attachment. Instead, download it once from the certificate portal.</p>

      <div class="cta">
        <a href="${portalUrl}" class="button">Open the certificate portal</a>
      </div>

      <div class="info">
        <strong>How it works</strong>
        <ol style="margin: 8px 0 0 0; padding-left: 20px;">
          <li>Sign in with <strong>${esc(email)}</strong> — the Google account this invitation was sent to.</li>
          <li>You will see your certificate and can download it a single time.</li>
          <li>Save the <code>.p12</code> file and the import password it shows you somewhere safe.</li>
        </ol>
      </div>

      <p class="muted">If the button doesn't work, go to <a href="${portalUrl}" style="color:#2563eb;">${portalUrl}</a></p>
    `,
    footerLines: tenant
      ? []
      : [
          'SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092',
          `Phone: +91 96853 54099 | Email: ${process.env.ADMIN_EMAIL || `admin@${platformDomain}`}`,
        ],
  })
  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      attachments: [],
      kind: 'admin_notification',
      templateName: 'admin_cert_invite',
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

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

type ReturnEmailEvent = 'requested_admin' | 'approved' | 'rejected' | 'received' | 'replacement_created'

export async function sendReturnStatusEmail(
  recipientEmail: string | string[],
  recipientName: string,
  orderNumber: string,
  orderId: string,
  event: ReturnEmailEvent,
  extra?: {
    adminNotes?: string
    replacementOrderNumber?: string
    returnType?: string
    reason?: string
    appUrl?: string
  }
): Promise<{ success: boolean; error?: unknown }> {
  const appUrl = extra?.appUrl || (await storeBaseUrlAsync())
  const orderLink = `${appUrl}/account/orders/${orderId}`
  const to = Array.isArray(recipientEmail) ? recipientEmail.join(', ') : recipientEmail

  const subjects: Record<ReturnEmailEvent, string> = {
    requested_admin: `Return/Replacement Request — Order #${orderNumber}`,
    approved: `Your Return Request Has Been Approved — Order #${orderNumber}`,
    rejected: `Your Return Request Was Not Approved — Order #${orderNumber}`,
    received: `We've Received Your Return — Order #${orderNumber}`,
    replacement_created: `Your Replacement Order Has Been Created — Order #${orderNumber}`,
  }

  const bodies: Record<ReturnEmailEvent, string> = {
    requested_admin: `
      <p>A customer has submitted a return/replacement request for order <strong>#${orderNumber}</strong>.</p>
      <div class="info">
        <p style="margin:0 0 6px"><strong>Customer:</strong> ${recipientName}</p>
        <p style="margin:0 0 6px"><strong>Type:</strong> ${extra?.returnType || 'N/A'}</p>
        <p style="margin:0"><strong>Reason:</strong> ${extra?.reason || 'N/A'}</p>
      </div>
      <div class="cta"><a href="${currentAdminBaseUrl()}/orders/${orderId}" class="button">Review Request</a></div>
    `,
    approved: `
      <p>Your return/replacement request for order <strong>#${orderNumber}</strong> has been <strong style="color:#16a34a;">approved</strong>.</p>
      <p>Please ship the item(s) back to us. Our team will contact you with the return shipping address and instructions shortly.</p>
      <p>Once we receive and inspect the item, we will process your ${extra?.returnType === 'replacement' ? 'replacement shipment' : 'refund'} promptly.</p>
      <div class="cta"><a href="${orderLink}" class="button">View Order</a></div>
    `,
    rejected: `
      <p>We have reviewed your return/replacement request for order <strong>#${orderNumber}</strong>.</p>
      <p>Unfortunately, we are unable to approve this request at this time.</p>
      ${extra?.adminNotes ? `<div class="danger"><p style="margin:0"><strong>Reason:</strong> ${extra.adminNotes}</p></div>` : ''}
      <p>If you have questions, please contact our support team.</p>
      <div class="cta"><a href="${orderLink}" class="button">View Order</a></div>
    `,
    received: `
      <p>We have received your returned item(s) for order <strong>#${orderNumber}</strong>.</p>
      <p>Our team is now inspecting the item and will process your ${extra?.returnType === 'replacement' ? 'replacement shipment' : 'refund'} shortly. You will receive another notification once it is done.</p>
      <div class="cta"><a href="${orderLink}" class="button">View Order</a></div>
    `,
    replacement_created: `
      <p>Great news! Your replacement order has been created for original order <strong>#${orderNumber}</strong>.</p>
      ${extra?.replacementOrderNumber ? `<p>Your new order number is <strong>#${extra.replacementOrderNumber}</strong>. It has been confirmed and will be processed shortly.</p>` : ''}
      <div class="cta"><a href="${orderLink}" class="button">View Original Order</a></div>
    `,
  }

  const brand = await currentBrandNameAsync()
  const title = event === 'requested_admin' ? 'New Return / Replacement Request' : subjects[event]

  const mailOptions = {
    from: await customerMailFromAsync(),
    to,
    subject: subjects[event],
    html: mailShell({
      brand,
      kicker: 'Return Update',
      title,
      content: `
        ${event !== 'requested_admin' ? `<p>Hi ${recipientName},</p>` : ''}
        ${bodies[event]}
      `,
      footerLines: [`${brand} — do not reply to this email.`],
    }),
  }

  try {
    await sendAuditedMail({
      ...mailOptions,
      kind: 'order',
      templateName: 'return_status',
      entityType: 'orders',
      entityId: orderId ?? null,
      metadata: { event, orderNumber },
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPaymentRetryEmail(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderTotal: number
) {
  const BASE_URL = await storeBaseUrlAsync()
  const shopUrl = `${BASE_URL}/products`
  const brand = await currentBrandNameAsync()
  const formatted = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(orderTotal)

  const html = mailShell({
    brand,
    kicker: 'Payment Update',
    title: `Sorry your order didn't go through`,
    content: `
      <p>Hi ${customerName},</p>
      <p>We're sorry your purchase didn't go through. It looks like the payment for order <strong>#${orderNumber}</strong> (${formatted}) could not be processed.</p>
      <p>No worries — simply visit our store and place a new order whenever you're ready. Your cart items are still available.</p>
      <div class="cta"><a href="${shopUrl}" class="button">Shop Again →</a></div>
      <p class="muted">If you need any help or have questions, just reply to this email and we'll be happy to assist.</p>
    `,
    footerLines: [`© ${new Date().getFullYear()} ${brand} &bull; <a href="${BASE_URL}">${brand}</a>`],
  })

  try {
    await sendAuditedMail({
      from: await customerMailFromAsync(),
      to: customerEmail,
      subject: `Sorry your order didn't go through — Order #${orderNumber}`,
      html,
      kind: 'order',
      templateName: 'payment_retry',
      entityType: 'orders',
      entityId: null,
      metadata: { orderNumber, orderTotal },
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendInvoiceFinalizedEmail(
  toEmail: string,
  customerName: string,
  invoiceNumber: string,
  totalAmount: number,
  orderNumber?: string,
  viewUrl?: string
) {
  const contactLine = await storeContactLine().then(c => (c ? `<p>${c}</p>` : ''))
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const mailOptions = {
    from: await customerMailFromAsync(),
    to: toEmail,
    subject: `Invoice ${invoiceNumber} from ${brand}`,
    html: mailShell({
      brand,
      kicker: 'Invoice',
      title: `Invoice ${invoiceNumber}`,
      content: `
        <p>Dear ${customerName},</p>
        <p>Thank you for your purchase! Your invoice has been generated.</p>
        <div class="success">
          <p style="margin:0 0 6px"><strong>Invoice No.:</strong> ${invoiceNumber}</p>
          ${orderNumber ? `<p style="margin:0 0 6px"><strong>Order No.:</strong> ${orderNumber}</p>` : ''}
          <p style="margin:0"><strong>Total Amount:</strong> ₹${formatted}</p>
        </div>
        ${viewUrl ? `<div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Invoice</a></div>` : ''}
        <p>For any queries, please contact us.</p>
        ${contactLine}
      `,
      footerLines: [address],
    }),
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'invoice',
      templateName: 'invoice_finalized',
      entityType: 'orders',
      entityId: null,
      metadata: { invoiceNumber, orderNumber: orderNumber ?? null, totalAmount },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPurchaseOrderEmail(
  toEmail: string,
  contactName: string,
  supplierName: string,
  poNumber: string,
  totalAmount: number,
  items: Array<{ product_name: string; variant_name?: string | null; quantity: number; unit_cost: number }>,
  viewUrl?: string
) {
  const contactLine = await storeContactLine().then(c => (c ? `<p>${c}</p>` : ''))
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const itemRows = items
    .map(
      it =>
        `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${it.product_name}${it.variant_name ? ` / ${it.variant_name}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${it.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">₹${it.unit_cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>`
    )
    .join('')
  const mailOptions = {
    from: await customerMailFromAsync(),
    to: toEmail,
    subject: `Purchase Order ${poNumber} from ${brand}`,
    html: mailShell({
      brand,
      kicker: 'Purchase Order',
      title: `Purchase Order ${poNumber}`,
      content: `
        <p>Dear ${contactName || supplierName},</p>
        <p>Please find below our purchase order. Kindly confirm receipt and expected delivery.</p>
        <div class="info">
          <p style="margin:0 0 6px"><strong>PO Number:</strong> ${poNumber}</p>
          <p style="margin:0"><strong>Total Amount:</strong> ₹${formatted}</p>
        </div>
        ${viewUrl ? `<div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Purchase Order</a></div>` : ''}
        <table class="rows">
          <thead><tr>
            <th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Cost</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="margin-top:20px">For any questions, please contact us.</p>
        ${contactLine}
      `,
      footerLines: [address],
    }),
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'purchase_order',
      templateName: 'purchase_order',
      entityType: 'purchase_orders',
      entityId: null,
      metadata: { poNumber, supplierName, totalAmount },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPOReceiveNotificationEmail(
  toEmail: string,
  contactName: string,
  supplierName: string,
  poNumber: string,
  grnNumber: string,
  newStatus: string,
  items: Array<{ product_name: string; variant_name?: string | null; quantity_received: number; unit_cost: number }>
) {
  const contactLine = await storeContactLine().then(c => (c ? `<p>${c}</p>` : ''))
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const statusLabel = newStatus === 'received' ? 'Fully Received' : 'Partially Received'
  const itemRows = items
    .map(
      it =>
        `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${it.product_name}${it.variant_name ? ` / ${it.variant_name}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${it.quantity_received}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">₹${it.unit_cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>`
    )
    .join('')
  const mailOptions = {
    from: await customerMailFromAsync(),
    to: toEmail,
    subject: `Goods Receipt Confirmation — PO ${poNumber} (${statusLabel})`,
    html: mailShell({
      brand,
      kicker: 'Purchase Order',
      title: 'Goods Receipt Confirmation',
      content: `
        <p>Dear ${contactName || supplierName},</p>
        <p>We have recorded receipt of goods against your purchase order.</p>
        <div class="success">
          <p style="margin:0 0 6px"><strong>PO Number:</strong> ${poNumber}</p>
          <p style="margin:0 0 6px"><strong>GRN Number:</strong> ${grnNumber}</p>
          <p style="margin:0"><strong>Status:</strong> ${statusLabel}</p>
        </div>
        <table class="rows">
          <thead><tr>
            <th>Product</th><th style="text-align:right">Qty Received</th><th style="text-align:right">Unit Cost</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="margin-top:20px">Thank you for your supply.</p>
        ${contactLine}
      `,
      footerLines: [address],
    }),
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'po_receive',
      entityType: 'purchase_orders',
      entityId: null,
      metadata: { poNumber, grnNumber, newStatus, supplierName },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendQuotationFinalizedEmail(
  toEmail: string,
  consigneeName: string,
  quoteNumber: string,
  totalAmount: number,
  viewUrl: string
) {
  const contactLine = await storeContactLine().then(c => (c ? `<p>${c}</p>` : ''))
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const mailOptions = {
    from: await customerMailFromAsync(),
    to: toEmail,
    subject: `Quotation ${quoteNumber} from ${brand}`,
    html: mailShell({
      brand,
      kicker: 'Quotation',
      title: `Quotation ${quoteNumber}`,
      content: `
        <p>Dear ${consigneeName},</p>
        <p>Please find your quotation from ${brand}.</p>
        <div class="info">
          <p style="margin:0 0 6px"><strong>Quotation No.:</strong> ${quoteNumber}</p>
          <p style="margin:0"><strong>Total Amount:</strong> ₹${formatted}</p>
        </div>
        <div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Quotation</a></div>
        <p>If you have any questions regarding this quotation, please feel free to contact us.</p>
        ${contactLine}
      `,
      footerLines: [address],
    }),
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'quotation',
      templateName: 'quotation_finalized',
      entityType: 'quotations',
      entityId: null,
      metadata: { quoteNumber, totalAmount },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

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

interface AnnouncementProduct {
  id: string
  name: string
  slug: string
  price: string
  short_description: string | null
  primary_image_url?: string | null
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
  const { sendAuditedMail } = await import('./mail-audit')
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
    to: (await import('./brand')).platformAdminEmail(),
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
