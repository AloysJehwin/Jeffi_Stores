import { signServiceToken } from '@jeffi/service-auth'
import { currentTenant, PLATFORM_TENANT_ID } from '@jeffi/tenancy'
import { mailShell } from './mail-template'
import { recordEmailSend, type ReplyTarget } from './reply-context'
import { currentBrandNameAsync, customerMailFromAsync, storeAddressLine, storeContactLine } from './brand'

const MESSAGING_URL = process.env.MESSAGING_URL || 'http://localhost:3101'
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Result = { success: boolean; messageId?: string; error?: unknown }

async function send(to: string, subject: string, html: string, templateName: string, metadata: Record<string, unknown>, reply?: ReplyTarget | null): Promise<Result> {
  const t = currentTenant() ?? { tenantId: PLATFORM_TENANT_ID, slug: 'platform' }
  try {
    const res = await fetch(`${MESSAGING_URL}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${signServiceToken({ service: 'documents', tenantId: t.tenantId, tenantSlug: t.slug, internal: true })}`,
      },
      body: JSON.stringify({ channel: 'email', to, subject, body: html, from: await customerMailFromAsync(), reference: templateName, metadata, reply_to: reply?.replyTo }),
    })
    const d: any = await res.json().catch(() => ({}))
    if (!res.ok) return { success: false, error: d?.message ?? res.statusText }
    if (reply && d.status !== 'failed') await recordEmailSend(reply.contextId, d.provider_ref)
    return { success: d.status !== 'failed', messageId: d.id, error: d.error ?? undefined }
  } catch (error) {
    return { success: false, error }
  }
}

async function shell(kicker: string, title: string, content: string) {
  const brand = await currentBrandNameAsync()
  const contact = await storeContactLine()
  const address = await storeAddressLine()
  return { brand, html: mailShell({ brand, kicker, title, content: content + (contact ? `<p>${contact}</p>` : ''), footerLines: [address] }) }
}

export async function sendInvoiceFinalizedEmail(toEmail: string, customerName: string, invoiceNumber: string, totalAmount: number, orderNumber?: string, viewUrl?: string): Promise<Result> {
  const { brand, html } = await shell('Invoice', `Invoice ${invoiceNumber}`, `
    <p>Dear ${customerName},</p>
    <p>Thank you for your purchase! Your invoice has been generated.</p>
    <div class="success">
      <p style="margin:0 0 6px"><strong>Invoice No.:</strong> ${invoiceNumber}</p>
      ${orderNumber ? `<p style="margin:0 0 6px"><strong>Order No.:</strong> ${orderNumber}</p>` : ''}
      <p style="margin:0"><strong>Total Amount:</strong> ₹${inr(totalAmount)}</p>
    </div>
    ${viewUrl ? `<div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Invoice</a></div>` : ''}
    <p>For any queries, please contact us.</p>`)
  return send(toEmail, `Invoice ${invoiceNumber} from ${brand}`, html, 'invoice_finalized', { invoiceNumber, orderNumber: orderNumber ?? null, totalAmount })
}

export async function sendQuotationFinalizedEmail(toEmail: string, consigneeName: string, quoteNumber: string, totalAmount: number, viewUrl: string, reply?: ReplyTarget | null): Promise<Result> {
  const brandName = await currentBrandNameAsync()
  const { brand, html } = await shell('Quotation', `Quotation ${quoteNumber}`, `
    <p>Dear ${consigneeName},</p>
    <p>Please find your quotation from ${brandName}.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>Quotation No.:</strong> ${quoteNumber}</p>
      <p style="margin:0"><strong>Total Amount:</strong> ₹${inr(totalAmount)}</p>
    </div>
    <div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Quotation</a></div>
    <p>${reply ? 'To accept it, ask for changes or ask a question, simply reply to this email.' : 'If you have any questions regarding this quotation, please feel free to contact us.'}</p>`)
  return send(toEmail, `Quotation ${quoteNumber} from ${brand}`, html, 'quotation_finalized', { quoteNumber, totalAmount }, reply)
}

export async function sendPurchaseOrderEmail(
  toEmail: string, contactName: string, supplierName: string, poNumber: string, totalAmount: number,
  items: Array<{ product_name: string; variant_name?: string | null; quantity: number; unit_cost: number }>, viewUrl?: string
): Promise<Result> {
  const rows = items.map(it => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${it.product_name}${it.variant_name ? ` / ${it.variant_name}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${it.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">₹${inr(it.unit_cost)}</td></tr>`).join('')
  const { brand, html } = await shell('Purchase Order', `Purchase Order ${poNumber}`, `
    <p>Dear ${contactName || supplierName},</p>
    <p>Please find below our purchase order. Kindly confirm receipt and expected delivery.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>PO Number:</strong> ${poNumber}</p>
      <p style="margin:0"><strong>Total Amount:</strong> ₹${inr(totalAmount)}</p>
    </div>
    ${viewUrl ? `<div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Purchase Order</a></div>` : ''}
    <table class="rows"><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Cost</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:20px">For any questions, please contact us.</p>`)
  return send(toEmail, `Purchase Order ${poNumber} from ${brand}`, html, 'purchase_order', { poNumber, supplierName, totalAmount })
}

export async function sendBusinessInvoiceGeneratedEmail(toEmail: string, name: string, invoiceNumber: string, orderNumber: string, totalAmount: number, viewUrl: string): Promise<Result> {
  const { brand, html } = await shell('Invoice', `Invoice ${invoiceNumber}`, `
    <p>Dear ${name},</p>
    <p>Your invoice has been generated. Please find the details below.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>Invoice No.:</strong> ${invoiceNumber}</p>
      <p style="margin:0 0 6px"><strong>Order No.:</strong> ${orderNumber}</p>
      <p style="margin:0"><strong>Amount Due:</strong> ₹${inr(totalAmount)}</p>
    </div>
    <div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Invoice</a></div>`)
  return send(toEmail, `Invoice ${invoiceNumber} — ${brand}`, html, 'business_invoice_generated', { invoiceNumber, orderNumber, totalAmount })
}

export async function sendPOReceiveNotificationEmail(
  toEmail: string, contactName: string, supplierName: string, poNumber: string, grnNumber: string, newStatus: string,
  items: Array<{ product_name: string; variant_name?: string | null; quantity_received: number; unit_cost: number }>
): Promise<Result> {
  const statusLabel = newStatus === 'received' ? 'Fully Received' : 'Partially Received'
  const rows = items.map(it => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${it.product_name}${it.variant_name ? ` / ${it.variant_name}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${it.quantity_received}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">₹${inr(it.unit_cost)}</td></tr>`).join('')
  const { html } = await shell('Purchase Order', 'Goods Receipt Confirmation', `
    <p>Dear ${contactName || supplierName},</p>
    <p>We have recorded receipt of goods against your purchase order.</p>
    <div class="success">
      <p style="margin:0 0 6px"><strong>PO Number:</strong> ${poNumber}</p>
      <p style="margin:0 0 6px"><strong>GRN Number:</strong> ${grnNumber}</p>
      <p style="margin:0"><strong>Status:</strong> ${statusLabel}</p>
    </div>
    <table class="rows"><thead><tr><th>Product</th><th style="text-align:right">Qty Received</th><th style="text-align:right">Unit Cost</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:20px">Thank you for your supply.</p>`)
  return send(toEmail, `Goods Receipt Confirmation — PO ${poNumber} (${statusLabel})`, html, 'po_receive', { poNumber, grnNumber, newStatus, supplierName })
}

export async function sendRfqConvertedToQuotationEmail(toEmail: string, name: string, rfqNumber: string, quoteNumber: string, totalAmount: number, viewUrl: string): Promise<Result> {
  const brand = await currentBrandNameAsync()
  const contact = await storeContactLine()
  const html = mailShell({ brand, kicker: 'Business Portal', title: `Quotation ${quoteNumber} ready`, content: `
    <p>Dear ${name},</p>
    <p>Your RFQ <strong>${rfqNumber}</strong> has been reviewed and a quotation has been prepared for you.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>Quotation No.:</strong> ${quoteNumber}</p>
      <p style="margin:0"><strong>Total Amount:</strong> ₹${inr(totalAmount)}</p>
    </div>
    <div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Quotation</a></div>
    <p>Please review the quotation. If you have any questions, just reply to this email.</p>`, footerLines: [contact] })
  return send(toEmail, `Quotation ${quoteNumber} ready — ${brand}`, html, 'rfq_converted_to_quotation', { rfqNumber, quoteNumber, totalAmount })
}
