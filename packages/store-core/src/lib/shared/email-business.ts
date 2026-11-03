import { sendByTemplate } from '@/lib/shared/send-by-template'
import {
  currentAdminBaseUrlAsync,
  businessBaseUrlAsync,
} from '@/lib/catalog/brand'
import { getAdminNotificationEmails } from '@/lib/email/shared'

const businessUrl = () => businessBaseUrlAsync()

function fmtAmount(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function sendRfqSubmittedEmail(toEmail: string, name: string, rfqNumber: string, rfqId?: string) {
  const rfqPath = rfqId ? `/${encodeURIComponent(rfqId)}` : ''
  const [portal, adminBase, adminTo] = await Promise.all([
    businessUrl(),
    currentAdminBaseUrlAsync(),
    getAdminNotificationEmails(),
  ])
  await Promise.allSettled([
    sendByTemplate({
      channel: 'email',
      slug: 'b2b/rfq-submitted',
      to: toEmail,
      variables: { customer_name: name, rfq_number: rfqNumber, rfq_url: `${portal}/quotes${rfqPath}` },
    }),
    sendByTemplate({
      channel: 'email',
      slug: 'b2b/rfq-submitted-admin',
      to: adminTo,
      variables: {
        customer_name: name,
        customer_email: toEmail,
        rfq_number: rfqNumber,
        rfq_url: `${adminBase}/business/rfqs${rfqPath}`,
      },
    }),
  ])
}

export async function sendRfqConvertedToQuotationEmail(
  toEmail: string,
  name: string,
  rfqNumber: string,
  quoteNumber: string,
  totalAmount: number,
  viewUrl: string
) {
  return sendByTemplate({
    channel: 'email',
    slug: 'b2b/quotation-ready',
    to: toEmail,
    variables: {
      customer_name: name,
      rfq_number: rfqNumber,
      quotation_number: quoteNumber,
      total: fmtAmount(totalAmount),
      quotation_url: viewUrl,
    },
  })
}

export async function sendBusinessAccountApprovedEmail(toEmail: string, name: string, companyName: string) {
  const signinUrl = `${await businessUrl()}/signin`
  return sendByTemplate({
    channel: 'email',
    slug: 'b2b/account-approved',
    to: toEmail,
    variables: { customer_name: name, company_name: companyName, signin_url: signinUrl },
  })
}

export async function sendBusinessAccountRejectedEmail(
  toEmail: string,
  name: string,
  companyName: string,
  rejectionNote?: string | null
) {
  return sendByTemplate({
    channel: 'email',
    slug: 'b2b/account-rejected',
    to: toEmail,
    variables: {
      customer_name: name,
      company_name: companyName,
      reason: rejectionNote ? `Reason: ${rejectionNote}` : '',
    },
  })
}

export async function sendBusinessInvoiceGeneratedEmail(
  toEmail: string,
  name: string,
  invoiceNumber: string,
  orderNumber: string,
  totalAmount: number,
  invoiceViewUrl: string
) {
  return sendByTemplate({
    channel: 'email',
    slug: 'b2b/invoice-generated',
    to: toEmail,
    variables: {
      customer_name: name,
      invoice_number: invoiceNumber,
      order_number: orderNumber,
      total: fmtAmount(totalAmount),
      invoice_url: invoiceViewUrl,
    },
  })
}

export async function sendBusinessOrderStatusEmail(
  toEmail: string,
  name: string,
  orderNumber: string,
  status: string,
  invoiceViewUrl?: string
) {
  const statusLabel: Record<string, string> = {
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    granted: 'Access granted',
    cancelled: 'Cancelled',
  }
  const label = statusLabel[status] || status
  const vaultUrl = status === 'granted' ? await import('@/lib/vault/links').then(m => m.vaultLibraryUrl()) : null
  const extraCta = vaultUrl
    ? `Open your vault: ${vaultUrl}`
    : invoiceViewUrl
      ? `View invoice: ${invoiceViewUrl}`
      : ''
  return sendByTemplate({
    channel: 'email',
    slug: 'b2b/order-status',
    to: toEmail,
    variables: {
      customer_name: name,
      order_number: orderNumber,
      status_label: label,
      extra_cta: extraCta,
    },
  })
}
