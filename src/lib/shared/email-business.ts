import { sendAuditedMail } from '@/lib/shared/mail-audit'
import {
  customerMailFromAsync,
  currentBrandNameAsync,
  platformAdminEmail,
  storeContactLine,
  resolveCurrentTenant,
} from '@/lib/catalog/brand'
import { mailShell } from '@/lib/shared/mail-template'

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'jeffistores.in'

// Was 'admin@admin.jeffistores.in' — a typo'd host that does not exist, so the fallback
// silently bounced whenever adminEmail() was unset.
const adminEmail = () => platformAdminEmail()

/** The business portal for whichever store this mail belongs to. */
async function businessUrl(): Promise<string> {
  const t = await resolveCurrentTenant()
  return t?.slug ? `https://${t.slug}.business.${PLATFORM_DOMAIN}` : `https://business.${PLATFORM_DOMAIN}`
}

async function baseLayout(title: string, body: string) {
  const brand = await currentBrandNameAsync()
  const contact = await storeContactLine()
  return mailShell({ brand, kicker: 'Business Portal', title, content: body, footerLines: [contact] })
}

async function send(
  to: string,
  subject: string,
  html: string,
  audit: { templateName: string; entityType?: string | null; entityId?: string | null; userId?: string | null }
) {
  try {
    const info = await sendAuditedMail({
      from: await customerMailFromAsync(),
      to,
      subject,
      html,
      kind: 'business',
      templateName: audit.templateName,
      entityType: audit.entityType ?? null,
      entityId: audit.entityId ?? null,
      userId: audit.userId ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

// RFQ submitted — notify business user + admin
export async function sendRfqSubmittedEmail(toEmail: string, name: string, rfqNumber: string) {
  const userHtml = await baseLayout(
    `RFQ ${rfqNumber} submitted`,
    `
    <p>Dear ${name},</p>
    <p>Your Request for Quotation has been submitted successfully. Our team will review it and send you a quotation shortly.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>RFQ No.:</strong> ${rfqNumber}</p>
    </div>
    <p>You can track the status of your RFQ by logging into your account.</p>
    <div class="cta"><a href="${await businessUrl()}/rfqs" class="button" style="color:#ffffff;">View My RFQs</a></div>
  `
  )

  const adminHtml = await baseLayout(
    `New RFQ ${rfqNumber}`,
    `
    <p>A new RFQ has been submitted.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>RFQ No.:</strong> ${rfqNumber}</p>
      <p style="margin:0"><strong>Submitted By:</strong> ${name} (${toEmail})</p>
    </div>
    <div class="cta"><a href="https://admin.jeffistores.in/admin/business/rfqs" class="button" style="color:#ffffff;">View RFQs</a></div>
  `
  )

  const brand = await currentBrandNameAsync()
  await Promise.allSettled([
    send(toEmail, `RFQ ${rfqNumber} submitted — ${brand}`, userHtml, {
      templateName: 'rfq_submitted_user',
    }),
    send(adminEmail(), `New RFQ ${rfqNumber} from ${name}`, adminHtml, {
      templateName: 'rfq_submitted_admin',
    }),
  ])
}

// RFQ converted to quotation — notify business user
export async function sendRfqConvertedToQuotationEmail(
  toEmail: string,
  name: string,
  rfqNumber: string,
  quoteNumber: string,
  totalAmount: number,
  viewUrl: string
) {
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const html = await baseLayout(
    `Quotation ${quoteNumber} ready`,
    `
    <p>Dear ${name},</p>
    <p>Your RFQ <strong>${rfqNumber}</strong> has been reviewed and a quotation has been prepared for you.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>Quotation No.:</strong> ${quoteNumber}</p>
      <p style="margin:0"><strong>Total Amount:</strong> ₹${formatted}</p>
    </div>
    <div class="cta"><a href="${viewUrl}" class="button" style="color:#ffffff;">View Quotation</a></div>
    <p>Please review the quotation. If you have any questions, contact us at +91 96853 54099.</p>
  `
  )
  const brand = await currentBrandNameAsync()
  return send(toEmail, `Quotation ${quoteNumber} ready — ${brand}`, html, {
    templateName: 'rfq_converted_to_quotation',
  })
}

// Business account approved
export async function sendBusinessAccountApprovedEmail(toEmail: string, name: string, companyName: string) {
  const html = await baseLayout(
    'Business account approved',
    `
    <p>Dear ${name},</p>
    <p>We are pleased to inform you that your business account for <strong>${companyName}</strong> has been <strong>approved</strong>.</p>
    <p>You can now log in and start placing RFQs and orders.</p>
    <div class="cta"><a href="${await businessUrl()}/signin" class="button" style="color:#ffffff;">Log In to Business Portal</a></div>
  `
  )
  const brand = await currentBrandNameAsync()
  return send(toEmail, `Business account approved — ${brand}`, html, {
    templateName: 'business_account_approved',
  })
}

// Business account rejected
export async function sendBusinessAccountRejectedEmail(
  toEmail: string,
  name: string,
  companyName: string,
  rejectionNote?: string | null
) {
  const contact = await storeContactLine()
  const html = await baseLayout(
    'Business account application update',
    `
    <p>Dear ${name},</p>
    <p>We regret to inform you that your business account application for <strong>${companyName}</strong> could not be approved at this time.</p>
    ${rejectionNote ? `<div class="info"><p style="margin:0"><strong>Reason:</strong> ${rejectionNote}</p></div>` : ''}
    <p>If you believe this is an error or would like to reapply, please contact us${contact ? ` at ${contact}` : ''}.</p>
  `
  )
  const brand = await currentBrandNameAsync()
  return send(toEmail, `Business account application update — ${brand}`, html, {
    templateName: 'business_account_rejected',
  })
}

// Business invoice generated (quotation converted to invoice)
export async function sendBusinessInvoiceGeneratedEmail(
  toEmail: string,
  name: string,
  invoiceNumber: string,
  orderNumber: string,
  totalAmount: number,
  invoiceViewUrl: string
) {
  const contact = await storeContactLine()
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const html = await baseLayout(
    `Invoice ${invoiceNumber}`,
    `
    <p>Dear ${name},</p>
    <p>Your invoice has been generated. Please find the details below.</p>
    <div class="info">
      <p style="margin:0 0 6px"><strong>Invoice No.:</strong> ${invoiceNumber}</p>
      <p style="margin:0 0 6px"><strong>Order No.:</strong> ${orderNumber}</p>
      <p style="margin:0"><strong>Amount Due:</strong> ₹${formatted}</p>
    </div>
    <div class="cta"><a href="${invoiceViewUrl}" class="button" style="color:#ffffff;">View Invoice</a></div>
    <p>For payment enquiries, contact us${contact ? ` at ${contact}` : ''}.</p>
  `
  )
  const brand = await currentBrandNameAsync()
  return send(toEmail, `Invoice ${invoiceNumber} — ${brand}`, html, {
    templateName: 'business_invoice_generated',
  })
}

// Business order status update
export async function sendBusinessOrderStatusEmail(
  toEmail: string,
  name: string,
  orderNumber: string,
  status: string,
  invoiceViewUrl?: string
) {
  const contact = await storeContactLine()
  const statusLabel: Record<string, string> = {
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  }
  const label = statusLabel[status] || status
  const html = await baseLayout(
    `Order ${orderNumber} — ${label}`,
    `
    <p>Dear ${name},</p>
    <p>Your order <strong>${orderNumber}</strong> is now <strong>${label}</strong>.</p>
    ${invoiceViewUrl ? `<div class="cta"><a href="${invoiceViewUrl}" class="button" style="color:#ffffff;">View Invoice</a></div>` : ''}
    <p>For any queries, contact us${contact ? ` at ${contact}` : ''}.</p>
  `
  )
  const brand = await currentBrandNameAsync()
  return send(toEmail, `Order ${orderNumber} — ${label} | ${brand}`, html, {
    templateName: 'business_order_status',
  })
}
