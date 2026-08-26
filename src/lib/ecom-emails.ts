import nodemailer from 'nodemailer'

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

const PLATFORM_ADDRESS = process.env.ECOM_FROM_EMAIL || 'ecommerce@jeffistores.in'
const PLATFORM_FROM = `"Jeffi Commerce" <${PLATFORM_ADDRESS}>`
const PLATFORM_ADMIN = process.env.ADMIN_EMAIL || 'aloysjehwin@gmail.com'
const SUPPORT_ADDRESS = PLATFORM_ADDRESS

export function tenantNoReplyEmail(slug: string): string {
  return `"${slug} Store" <noreply-${slug}@jeffistores.in>`
}

export function tenantCampaignEmail(slug: string): string {
  return `"${slug} Store" <campaigns-${slug}@jeffistores.in>`
}

const INK = '#111827'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'
const ACCENT = '#15803d'

interface Row { label: string; value: string }

/** Definition table. Tables + inline styles: many clients strip <style> blocks. */
function detailTable(rows: Row[]): string {
  const cells = rows.map(({ label, value }) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px;width:38%;vertical-align:top;">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:14px;font-weight:600;">${value}</td>
    </tr>`).join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:20px 0;">${cells}</table>`
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="background:${ACCENT};border-radius:6px;">
      <a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${label}</a>
    </td></tr></table>`
}

function notice(text: string, tone: 'info' | 'warn' = 'info'): string {
  const bg = tone === 'warn' ? '#fef2f2' : '#f9fafb'
  const border = tone === 'warn' ? '#fecaca' : LINE
  const color = tone === 'warn' ? '#991b1b' : INK
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0;">
    <tr><td style="background:${bg};border:1px solid ${border};border-left:3px solid ${tone === 'warn' ? '#dc2626' : ACCENT};border-radius:4px;padding:14px 16px;color:${color};font-size:14px;line-height:1.6;">${text}</td></tr>
  </table>`
}

/** Preheader = the preview line clients show next to the subject. */
function baseHtml(preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:8px;">
    <tr><td style="padding:24px 32px;border-bottom:1px solid ${LINE};">
      <span style="font-size:16px;font-weight:700;color:${INK};letter-spacing:-0.01em;">Jeffi Commerce</span>
    </td></tr>
    <tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px;line-height:1.65;">
      ${body}
    </td></tr>
    <tr><td style="padding:20px 32px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      Jeffi Commerce &middot; <a href="https://ecom.jeffistores.in" style="color:${MUTED};">ecom.jeffistores.in</a><br>
      Questions? Reply to this email or write to <a href="mailto:${SUPPORT_ADDRESS}" style="color:${MUTED};">${SUPPORT_ADDRESS}</a>.
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 18px;font-size:19px;font-weight:700;color:${INK};line-height:1.35;">${text}</h1>`
}

/** Crude HTML-to-text for the multipart alternative — improves deliverability. */
function toText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h1|h2|div|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim()
}

async function send(to: string, subject: string, html: string) {
  await transporter.sendMail({
    from: PLATFORM_FROM,
    replyTo: PLATFORM_ADDRESS,
    to,
    subject,
    html,
    text: toText(html),
  }).catch((e) => {
    process.stderr.write(`[ecom-email] failed to send to ${to}: ${e?.message}\n`)
  })
}

export async function sendKycSubmittedEmail(owner: { email: string; name: string | null }) {
  const name = owner.name ?? 'there'
  const html = baseHtml('We have received your application and started the review.', `
    ${heading('Your application is under review')}
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">Thank you for applying to Jeffi Commerce. We have received your business details and GST certificate, and our team has started the verification.</p>
    ${notice('Verification usually completes within <strong>1 to 2 business days</strong>. Once approved, you will complete your subscription payment and your store will be provisioned automatically.')}
    <p style="margin:0;">We will email you as soon as there is an update. No action is needed from you in the meantime.</p>
  `)
  await send(owner.email, 'Your Jeffi Commerce application is under review', html)

  const adminHtml = baseHtml('A new merchant application needs review.', `
    ${heading('New merchant application')}
    ${detailTable([
      { label: 'Applicant', value: owner.name ?? '—' },
      { label: 'Email', value: owner.email },
      { label: 'Received', value: new Date().toLocaleString('en-IN') },
    ])}
    <p style="margin:0;">Review it in the Ecom Store section of the admin panel.</p>
  `)
  await send(PLATFORM_ADMIN, `New merchant application: ${owner.email}`, adminHtml)
}

export async function sendKycApprovedEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string },
  checkoutUrl: string
) {
  const name = owner.name ?? 'there'
  const html = baseHtml('Your application is approved. Complete payment to launch your store.', `
    ${heading('Your application has been approved')}
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">Your GST certificate has been verified and your application for <strong>${tenant.display_name}</strong> is approved.</p>
    ${detailTable([
      { label: 'Store name', value: tenant.display_name },
      { label: 'Store address', value: `${tenant.slug}.jeffistores.in` },
    ])}
    <p style="margin:0 0 14px;">Complete your subscription payment to launch. You will be taken to Razorpay's secure checkout.</p>
    ${button(checkoutUrl, 'Complete payment')}
    <p style="margin:0;color:${MUTED};font-size:13px;">Your store is provisioned automatically once payment is confirmed, and is usually ready within a few minutes.</p>
  `)
  await send(owner.email, 'Approved: complete your payment to launch your store', html)
}

export async function sendKycRejectedEmail(
  owner: { email: string; name: string | null },
  reason: string
) {
  const name = owner.name ?? 'there'
  const html = baseHtml('We could not verify your application. Action is required.', `
    ${heading('We could not verify your application')}
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">We were unable to verify the details submitted with your application.</p>
    ${notice(`<strong>Reason:</strong> ${reason}`, 'warn')}
    <p style="margin:0 0 14px;">This is usually straightforward to resolve. Reply to this email with corrected details and we will re-review your application.</p>
    <p style="margin:0;">No payment has been taken.</p>
  `)
  await send(owner.email, 'Action required: we could not verify your application', html)
}

export async function sendPaymentConfirmedEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string; plan: string | null; billing_interval: string }
) {
  const name = owner.name ?? 'there'
  const html = baseHtml('Payment confirmed. Your store is being provisioned.', `
    ${heading('Payment confirmed')}
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">We have received your subscription payment for <strong>${tenant.display_name}</strong>. Your store is being provisioned now.</p>
    ${detailTable([
      { label: 'Store', value: tenant.display_name },
      { label: 'Store address', value: `${tenant.slug}.jeffistores.in` },
      { label: 'Plan', value: `${tenant.plan ?? 'Basic'} (${tenant.billing_interval})` },
      { label: 'Status', value: 'Provisioning' },
    ])}
    <p style="margin:0;">Provisioning sets up your database, storage and store addresses. We will email you the moment it is live, usually within a few minutes.</p>
  `)
  await send(owner.email, `Payment confirmed for ${tenant.display_name}`, html)
}

export async function sendStoreLiveEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string; plan: string | null }
) {
  const name = owner.name ?? 'there'
  const adminUrl = `https://admin-${tenant.slug}.jeffistores.in`
  const storeUrl = `https://${tenant.slug}.jeffistores.in`
  const html = baseHtml(`${tenant.display_name} is live. Here are your store links.`, `
    ${heading(`${tenant.display_name} is now live`)}
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">Your store has been provisioned and is ready to use.</p>
    ${detailTable([
      { label: 'Storefront', value: `<a href="${storeUrl}" style="color:${ACCENT};">${storeUrl}</a>` },
      { label: 'Admin panel', value: `<a href="${adminUrl}" style="color:${ACCENT};">${adminUrl}</a>` },
      { label: 'Plan', value: tenant.plan ?? 'Basic' },
      { label: 'Sign-in email', value: owner.email },
    ])}
    ${button(adminUrl, 'Open your admin panel')}
    <p style="margin:0 0 14px;">Sign in with <strong>${owner.email}</strong> using the same one-time code or Google sign-in you used during onboarding.</p>
    ${notice('Your admin panel is protected by a client certificate, sent separately. Install it on each device you use to manage the store.')}
  `)
  await send(owner.email, `${tenant.display_name} is live`, html)
}
