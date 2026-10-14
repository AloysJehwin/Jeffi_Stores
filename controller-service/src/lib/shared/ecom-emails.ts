import nodemailer from 'nodemailer'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { platformAdminEmail, tenantNoReplyAddress, tenantCampaignAddress } from '@/lib/catalog/brand'
import { mailShell } from '@/lib/shared/mail-template'

// Ecom onboarding transactional email.
// Platform sender: ecommerce@jeffistores.in — every platform/tenant communication.
// Tenant sender:   noreply-{slug}@jeffistores.in (order comms once the store is live)
// Campaign sender: campaigns-{slug}@jeffistores.in (Pro+ only, marketing)
//
// The SES domain identity for jeffistores.in covers all *@jeffistores.in addresses,
// so no per-tenant SES identity registration is needed.

const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

const PLATFORM_BRAND = 'Jeffi Commerce'
const PLATFORM_ADDRESS = process.env.ECOM_FROM_EMAIL || 'ecommerce@jeffistores.in'
const PLATFORM_FROM = `"${PLATFORM_BRAND}" <${PLATFORM_ADDRESS}>`
// Was a personal gmail hardcoded as the default, so any environment without ADMIN_EMAIL set
// mailed platform notifications to an individual instead of the administrative mailbox.
const PLATFORM_ADMIN = platformAdminEmail()
const SUPPORT_ADDRESS = PLATFORM_ADDRESS

/**
 * Sender name is the store's real name when we have it; otherwise the slug with "Store"
 * appended, since a bare slug ("acme") reads like a mistake in an inbox.
 */
function senderName(slug: string, displayName?: string | null): string {
  return displayName?.trim() || `${slug} Store`
}

export function tenantNoReplyEmail(slug: string, displayName?: string | null): string {
  return `"${senderName(slug, displayName)}" <${tenantNoReplyAddress(slug)}>`
}

export function tenantCampaignEmail(slug: string, displayName?: string | null): string {
  return `"${senderName(slug, displayName)}" <${tenantCampaignAddress(slug)}>`
}

interface Row {
  label: string
  value: string
}

function detailTable(rows: Row[]): string {
  const cells = rows
    .map(
      ({ label, value }) => `
    <tr><th>${label}</th><td>${value}</td></tr>`
    )
    .join('')
  return `<table class="rows" cellpadding="0" cellspacing="0" width="100%">${cells}</table>`
}

function button(href: string, label: string): string {
  return `<div class="cta"><a href="${href}" class="button" style="color:#ffffff;">${label}</a></div>`
}

function notice(text: string, tone: 'info' | 'warn' = 'info'): string {
  return `<div class="${tone === 'warn' ? 'danger' : 'info'}">${text}</div>`
}

const FOOTER_LINES = [
  `<a href="https://ecom.jeffistores.in" style="color:#666;">ecom.jeffistores.in</a>`,
  `Questions? Reply to this email or write to <a href="mailto:${SUPPORT_ADDRESS}" style="color:#666;">${SUPPORT_ADDRESS}</a>.`,
]

/** Preheader = the preview line clients show next to the subject. */
function baseHtml(preheader: string, title: string, body: string): string {
  return mailShell({
    brand: PLATFORM_BRAND,
    kicker: 'Merchant Onboarding',
    title,
    content: body,
    footerLines: FOOTER_LINES,
    preheader,
  })
}

/** Crude HTML-to-text for the multipart alternative — improves deliverability. */
function toText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h1|h2|div|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .trim()
}

async function send(to: string, subject: string, html: string, attachments?: Array<{ filename: string; content: Buffer; contentType: string }>) {
  // Every outbound mail goes through the audited chokepoint so it is visible in
  // /admin/audit?tab=mail_log alongside the rest.
  await sendAuditedMail({
    kind: 'ecom',
    from: PLATFORM_FROM,
    replyTo: PLATFORM_ADDRESS,
    to,
    subject,
    html,
    text: toText(html),
    ...(attachments?.length ? { attachments } : {}),
  }).catch(e => {
    process.stderr.write(`[ecom-email] failed to send to ${to}: ${e?.message}\n`)
  })
}

export async function sendKycSubmittedEmail(owner: { email: string; name: string | null }) {
  const name = owner.name ?? 'there'
  const html = baseHtml(
    'We have received your application and started the review.',
    'Your application is under review',
    `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">Thank you for applying to Jeffi Commerce. We have received your business details and GST certificate, and our team has started the verification.</p>
    ${notice('Verification usually completes within <strong>1 to 2 business days</strong>. Once approved, you will complete your subscription payment and your store will be provisioned automatically.')}
    <p style="margin:0;">We will email you as soon as there is an update. No action is needed from you in the meantime.</p>
  `
  )
  await send(owner.email, 'Your Jeffi Commerce application is under review', html)

  const adminHtml = baseHtml(
    'A new merchant application needs review.',
    'New merchant application',
    `
    ${detailTable([
      { label: 'Applicant', value: owner.name ?? '—' },
      { label: 'Email', value: owner.email },
      { label: 'Received', value: new Date().toLocaleString('en-IN') },
    ])}
    <p style="margin:0;">Review it in the Ecom Store section of the admin panel.</p>
  `
  )
  await send(PLATFORM_ADMIN, `New merchant application: ${owner.email}`, adminHtml)
}

export async function sendKycApprovedEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string },
  checkoutUrl: string
) {
  const name = owner.name ?? 'there'
  const html = baseHtml(
    'Your application is approved. Complete payment to launch your store.',
    'Your application has been approved',
    `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">Your GST certificate has been verified and your application for <strong>${tenant.display_name}</strong> is approved.</p>
    ${detailTable([
      { label: 'Store name', value: tenant.display_name },
      { label: 'Store address', value: `${tenant.slug}.jeffistores.in` },
    ])}
    <p style="margin:0 0 14px;">Complete your subscription payment to launch. You will be taken to Razorpay's secure checkout.</p>
    ${button(checkoutUrl, 'Complete payment')}
    <p class="muted" style="margin:0;">Your store is provisioned automatically once payment is confirmed, and is usually ready within a few minutes.</p>
  `
  )
  await send(owner.email, 'Approved: complete your payment to launch your store', html)
}

export async function sendKycRejectedEmail(owner: { email: string; name: string | null }, reason: string) {
  const name = owner.name ?? 'there'
  const html = baseHtml(
    'We could not verify your application. Action is required.',
    'We could not verify your application',
    `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">We were unable to verify the details submitted with your application.</p>
    ${notice(`<strong>Reason:</strong> ${reason}`, 'warn')}
    <p style="margin:0 0 14px;">This is usually straightforward to resolve. Reply to this email with corrected details and we will re-review your application.</p>
    <p style="margin:0;">No payment has been taken.</p>
  `
  )
  await send(owner.email, 'Action required: we could not verify your application', html)
}

export async function sendPaymentConfirmedEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string; plan: string | null; billing_interval: string }
) {
  const name = owner.name ?? 'there'
  const html = baseHtml(
    'Payment confirmed. Your store is being provisioned.',
    'Payment confirmed',
    `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">We have received your subscription payment for <strong>${tenant.display_name}</strong>. Your store is being provisioned now.</p>
    ${detailTable([
      { label: 'Store', value: tenant.display_name },
      { label: 'Store address', value: `${tenant.slug}.jeffistores.in` },
      { label: 'Plan', value: `${tenant.plan ?? 'Basic'} (${tenant.billing_interval})` },
      { label: 'Status', value: 'Provisioning' },
    ])}
    <p style="margin:0;">Provisioning sets up your database, storage and store addresses. We will email you the moment it is live, usually within a few minutes.</p>
  `
  )
  await send(owner.email, `Payment confirmed for ${tenant.display_name}`, html)
}

export async function sendStoreLiveEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string; plan: string | null }
) {
  const name = owner.name ?? 'there'
  const adminUrl = `https://admin-${tenant.slug}.jeffistores.in`
  const storeUrl = `https://${tenant.slug}.jeffistores.in`
  const html = baseHtml(
    `${tenant.display_name} is live. Here are your store links.`,
    `${tenant.display_name} is now live`,
    `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">Your store has been provisioned and is ready to use.</p>
    ${detailTable([
      { label: 'Storefront', value: `<a href="${storeUrl}" style="color:#2563eb;">${storeUrl}</a>` },
      { label: 'Admin panel', value: `<a href="${adminUrl}" style="color:#2563eb;">${adminUrl}</a>` },
      { label: 'Plan', value: tenant.plan ?? 'Basic' },
      { label: 'Sign-in email', value: owner.email },
    ])}
    ${button(adminUrl, 'Open your admin panel')}
    <p style="margin:0 0 14px;">Sign in with <strong>${owner.email}</strong> using the same one-time code or Google sign-in you used during onboarding.</p>
    ${notice('Your admin panel is protected by a client certificate, sent separately. Install it on each device you use to manage the store.')}
  `
  )
  await send(owner.email, `${tenant.display_name} is live`, html)
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Jeffi's tax invoice for a plan charge or wallet top-up, PDF attached. */
export async function sendPlatformInvoiceEmail(
  to: string,
  inv: { kind: 'subscription' | 'wallet_topup'; number: string; store: string; description: string; taxable: number; gst: number; total: number; credited?: number; viewUrl: string },
  pdf: Buffer
) {
  const what = inv.kind === 'wallet_topup' ? 'wallet top-up' : 'subscription'
  const html = baseHtml(
    `Tax invoice ${inv.number} for your ${what}.`,
    'Tax invoice',
    `
    <p style="margin:0 0 14px;">Thanks for your payment. Your tax invoice for <strong>${inv.store}</strong> is attached.</p>
    ${detailTable([
      { label: 'Invoice', value: inv.number },
      { label: 'For', value: inv.description },
      ...(inv.credited != null ? [{ label: 'Wallet credit', value: inr(inv.credited) }] : []),
      { label: 'Taxable value', value: inr(inv.taxable) },
      { label: 'GST (18%)', value: inr(inv.gst) },
      { label: 'Total paid', value: inr(inv.total) },
    ])}
    ${button(inv.viewUrl, 'View invoice')}
  `
  )
  await send(to, `Tax invoice ${inv.number} — ${inv.store}`, html, [{ filename: `${inv.number.replace(/\//g, '-')}.pdf`, content: pdf, contentType: 'application/pdf' }])
}

const serviceLabel = (services: string[]) => services.map(x => (x === 'messaging' ? 'Messaging API' : 'Documents API')).join(' and ')
const CONSOLE_URL = `https://ecom.${process.env.PLATFORM_DOMAIN || 'jeffistores.in'}/dashboard`

/** Messaging/Documents access requested (sign-up or an extra service): owner + platform admin. */
export async function sendServicesRequestedEmail(owner: { email: string; name: string | null }, workspace: string, services: string[]) {
  const what = serviceLabel(services)
  await send(owner.email, `We're reviewing your ${what} request`, baseHtml(
    `Your ${what} request is under review.`,
    'Your request is under review',
    `
    <p style="margin:0 0 14px;">Hi ${owner.name ?? 'there'},</p>
    <p style="margin:0 0 14px;">Thanks for choosing Jeffi. We have received your request for the <strong>${what}</strong> for <strong>${workspace}</strong>.</p>
    ${notice('Reviews usually finish the <strong>same business day</strong>. Meanwhile you can explore the console, set up templates and create API keys — sending starts as soon as we approve.')}
    ${button(CONSOLE_URL, 'Open the console')}
  `))
  await send(PLATFORM_ADMIN, `Service request: ${what} — ${workspace}`, baseHtml(
    'A Messaging/Documents request needs review.',
    'New service request',
    `
    ${detailTable([
      { label: 'Workspace', value: workspace },
      { label: 'Requested', value: what },
      { label: 'Owner', value: `${owner.name ?? '—'} · ${owner.email}` },
      { label: 'Received', value: new Date().toLocaleString('en-IN') },
    ])}
    <p style="margin:0;">Approve or reject it from Admin → Ecom → Customers → the workspace → KYC.</p>
  `))
}

export async function sendServicesReviewedEmail(owner: { email: string; name: string | null }, workspace: string, services: string[], decision: 'approved' | 'rejected', note?: string | null) {
  const what = serviceLabel(services)
  if (decision === 'approved') {
    await send(owner.email, `Approved: your ${what} is ready`, baseHtml(
      `Your ${what} is approved — you can start sending.`,
      'You are approved',
      `
      <p style="margin:0 0 14px;">Hi ${owner.name ?? 'there'},</p>
      <p style="margin:0 0 14px;">The <strong>${what}</strong> for <strong>${workspace}</strong> is approved. Your API keys and the console can now send and render.</p>
      ${button(CONSOLE_URL, 'Open the console')}
    `))
    return
  }
  await send(owner.email, `Update on your ${what} request`, baseHtml(
    `We could not approve your ${what} request.`,
    'We could not approve your request',
    `
    <p style="margin:0 0 14px;">Hi ${owner.name ?? 'there'},</p>
    <p style="margin:0 0 14px;">We were unable to approve the <strong>${what}</strong> for <strong>${workspace}</strong>.</p>
    ${note ? notice(`<strong>Reason:</strong> ${note}`, 'warn') : ''}
    <p style="margin:0;">Reply to this email with any corrections and we will review it again.</p>
  `))
}
