import 'server-only'
import {
  sendAuditedMail,
  mailShell,
  customerMailFromAsync,
  currentBrandNameAsync,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
} from './shared'

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
