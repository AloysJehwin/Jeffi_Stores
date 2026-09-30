import 'server-only'
import {
  sendAuditedMail,
  mailShell,
  customerMailFromAsync,
  currentBrandNameAsync,
  currentAdminBaseUrl,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
  type ReturnEmailEvent,
} from './shared'

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

