import 'server-only'
import {
  sendAuditedMail,
  mailShell,
  createAdminNotification,
  getAdminNotificationEmails,
  customerMailFromAsync,
  adminMailFrom,
  currentBrandNameAsync,
  currentAdminBaseUrlAsync,
  storeContactLine,
  storeAddressLine,
} from './shared'
import { orderUrlById } from '@/lib/shared/customer-links'

export async function sendOrderConfirmationEmail(email: string, order: any, orderItems: any[]) {
  const contactLine = await storeContactLine().then(c => (c ? `<p>${c}</p>` : ''))
  const orderLink = order?.id ? await orderUrlById(String(order.id)) : null
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const subject = `Order Received - ${order.order_number}`
  // Digital lines are delivered to the vault, not dispatched.
  const allDigital = order.status === 'granted' || (orderItems.length > 0 && orderItems.every((i: any) => i.is_digital))
  const hasDigital = allDigital || orderItems.some((i: any) => i.is_digital)
  const vaultLink = hasDigital ? await import('@/lib/vault/links').then(m => m.vaultLibraryUrl()) : null
  const nextSteps = allDigital
    ? 'Your payment has been received and your digital items are ready. Open your vault to view them any time.'
    : hasDigital
      ? "Your payment has been received. Your digital items are ready in your vault now; we're preparing the rest of your order for dispatch and will email you once it's on its way."
      : "Your payment has been received. We're now preparing your order for dispatch. You'll receive another email once your order is on its way."
  const html = mailShell({
    brand,
    kicker: 'Order Confirmation',
    title: 'Order Received!',
    preheader: allDigital
      ? `Order confirmed! Your digital items are ready in your vault.`
      : `Order confirmed! We've received your order and will keep you updated on dispatch.`,
    extraCss: `
      .order-box { background-color: #e3f2fd; border: 2px solid #2563eb; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .total { background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: right; }
    `,
    content: `
      <p>Hello ${order.customer_name},</p>
      <p>${
        allDigital
          ? "Thank you for your order! We've received your payment and your access has been granted."
          : "Thank you for your order! We've received your order and payment — our team is preparing it and will keep you updated on dispatch."
      }</p>

      <div class="order-box">
        <h3 style="margin-top: 0;">Order Details</h3>
        <p><strong>Order Number:</strong> ${order.order_number}</p>
        <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}</p>
        <p><strong>Status:</strong> <span style="color: #16a34a; font-weight: bold;">${allDigital ? 'ACCESS GRANTED' : 'CONFIRMED'}</span></p>
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
              <td>₹${item.total_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
        <p style="margin: 3px 0; font-size: 14px;">Taxable Amount: ₹${Number(order.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        ${
          order.is_igst
            ? `<p style="margin: 3px 0; font-size: 14px;">IGST: ₹${Number(order.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>`
            : `<p style="margin: 3px 0; font-size: 14px;">CGST: ₹${Number(order.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
             <p style="margin: 3px 0; font-size: 14px;">SGST: ₹${Number(order.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>`
        }
        <hr style="border: none; border-top: 1px solid #ccc; margin: 8px 0;">
        `
            : ''
        }
        <h3 style="margin: 0;">Total Amount: ₹${order.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
      </div>

      <div class="success">
        <h4 style="margin-top: 0;">What happens next?</h4>
        <p style="margin: 5px 0;">${nextSteps}</p>
      </div>

      ${vaultLink ? `<div class="cta"><a href="${vaultLink}" class="button" style="color:#ffffff;">Open my vault</a></div>` : ''}

      ${orderLink ? `<div class="cta"><a href="${orderLink}" class="button" style="color:#ffffff;">View Your Order</a></div>` : ''}

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
    message:
      order.total_amount != null
        ? `Total ₹${Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : null,
    link: order.id ? `/admin/orders/${order.id}` : '/admin/orders',
    entityType: 'order',
    entityId: order.id ? String(order.id) : null,
    scope: 'orders:read',
  }).catch(() => {})

  const from = adminMailFrom()
  const brand = await currentBrandNameAsync()
  const subject = `New Order - ${order.order_number}`
  const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const qtyText = (item: any) =>
    item.buy_mode === 'weight' || item.buy_mode === 'length'
      ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}`
      : `${Math.round(Number(item.quantity))}${item.sold_unit && item.sold_unit !== 'unit' ? ` ${item.sold_unit}` : ''}`
  const isCod = order.payment_mode === 'cod'
  const paid = order.payment_status === 'paid' || order.payment_status === 'cod_collected'
  const discount = Number(order.discount_amount || 0) + Number(order.business_discount_amount || 0)
  const statusText = String(order.status || 'pending').replace(/_/g, ' ').toUpperCase()
  const statusColor = order.status === 'cancelled' ? '#ef4444' : order.status === 'pending' ? '#d97706' : '#16a34a'
  // payment_mode defaults to 'cash' for online (Razorpay) orders.
  const modeLabel = isCod ? 'Cash on delivery' : order.payment_mode === 'upi_qr' ? 'UPI QR' : order.payment_mode === 'credit' ? 'On credit' : 'Online'
  const paymentText = `${modeLabel} — ${paid ? (isCod ? 'collected' : 'paid') : String(order.payment_status || 'pending').replace(/_/g, ' ')}`
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
        <p><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span></p>
        <p><strong>Payment:</strong> ${paymentText}</p>
        ${order.notes ? `<p><strong>Customer Notes:</strong> ${order.notes}</p>` : ''}
      </div>

      <h3>Order Items</h3>
      <table class="rows" style="width: 100%; table-layout: fixed; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="width: 62%;">Item</th>
            <th style="width: 38%; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${orderItems
            .map(
              item => `
            <tr>
              <td style="word-break: break-word; overflow-wrap: anywhere;">
                <strong>${item.product_name}</strong>
                ${item.product_sku ? `<br><span style="font-size: 12px; color: #888;">SKU: ${item.product_sku}</span>` : ''}
                <br><span style="font-size: 12px; color: #888;">${qtyText(item)} × ${inr(item.unit_price)}</span>
              </td>
              <td style="text-align: right; white-space: nowrap;">${inr(item.total_price)}</td>
            </tr>
          `
            )
            .join('')}
          ${Number(order.subtotal) > 0 ? `<tr><td style="text-align: right; color: #666;">Subtotal</td><td style="text-align: right;">${inr(order.subtotal)}</td></tr>` : ''}
          ${discount > 0 ? `<tr><td style="text-align: right; color: #666;">Discount</td><td style="text-align: right;">− ${inr(discount)}</td></tr>` : ''}
          ${Number(order.shipping_amount) > 0 ? `<tr><td style="text-align: right; color: #666;">Shipping</td><td style="text-align: right;">${inr(order.shipping_amount)}</td></tr>` : ''}
          ${Number(order.cod_fee_amount) > 0 ? `<tr><td style="text-align: right; color: #666;">COD fee</td><td style="text-align: right;">${inr(order.cod_fee_amount)}</td></tr>` : ''}
          <tr style="background-color: #fff3cd; font-weight: bold;">
            <td style="text-align: right;">Total</td>
            <td style="text-align: right; white-space: nowrap;">${inr(order.total_amount)}</td>
          </tr>
        </tbody>
      </table>

      <div class="${paid ? 'success' : 'warning'}">
        <h4 style="margin-top: 0;">${paid ? 'Ready to fulfil' : 'Action Required'}</h4>
        <p>${paid ? 'Payment is received. Pack the items and create the shipment from the admin panel.' : isCod ? 'Cash on delivery — confirm the order with the customer before packing.' : 'Payment is not confirmed yet — check the payment and contact the customer within 24 hours.'}</p>
      </div>

      <div class="cta">
        <a href="${await currentAdminBaseUrlAsync()}/orders/${order.id}" class="button">
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
