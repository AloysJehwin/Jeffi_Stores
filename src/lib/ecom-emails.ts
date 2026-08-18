import nodemailer from 'nodemailer'

// Ecom onboarding transactional emails.
// Platform sender: noreply@jeffistores.in (all onboarding events)
// Tenant sender:   noreply-{slug}@jeffistores.in (order comms once store is live)
// Campaign sender: campaigns-{slug}@jeffistores.in (Pro+ only, marketing)
//
// SES domain identity for jeffistores.in covers all *@jeffistores.in addresses —
// no per-tenant SES identity registration needed.

const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

const PLATFORM_FROM = `"Jeffi Commerce" <${process.env.SES_FROM_EMAIL || 'noreply@jeffistores.in'}>`
const PLATFORM_ADMIN = process.env.ADMIN_EMAIL || 'aloysjehwin@gmail.com'

/** Get the noreply address for a tenant's storefront (all plans). */
export function tenantNoReplyEmail(slug: string): string {
  return `"${slug} Store" <noreply-${slug}@jeffistores.in>`
}

/** Get the campaign sender for a tenant (Pro+ only). */
export function tenantCampaignEmail(slug: string): string {
  return `"${slug} Store" <campaigns-${slug}@jeffistores.in>`
}

function baseHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .header { background: linear-gradient(135deg, #16a34a, #15803d); padding: 28px 32px; }
  .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 700; }
  .header p { color: rgba(255,255,255,.8); margin: 4px 0 0; font-size: 13px; }
  .body { padding: 32px; color: #333; line-height: 1.6; }
  .body h2 { font-size: 18px; margin: 0 0 16px; color: #111; }
  .body p { margin: 0 0 14px; font-size: 15px; }
  .cta { display: inline-block; margin: 8px 0 16px; padding: 12px 24px; background: #16a34a; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; }
  .info-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px; }
  .info-box strong { color: #15803d; }
  .footer { background: #f9fafb; padding: 20px 32px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #eee; }
</style></head><body>
<div class="wrap">
  <div class="header"><h1>Jeffi Commerce</h1><p>Your online store platform</p></div>
  <div class="body">${body}</div>
  <div class="footer">© 2026 Jeffi Stores · <a href="https://ecom.jeffistores.in" style="color:#16a34a;">ecom.jeffistores.in</a></div>
</div></body></html>`
}

async function send(to: string, subject: string, html: string) {
  await transporter.sendMail({ from: PLATFORM_FROM, to, subject, html }).catch((e) => {
    process.stderr.write(`[ecom-email] failed to send to ${to}: ${e?.message}\n`)
  })
}

// ── Onboarding emails ─────────────────────────────────────────────────────────

export async function sendKycSubmittedEmail(owner: { email: string; name: string | null }) {
  const name = owner.name ?? 'there'
  const html = baseHtml('Application received', `
    <h2>We've received your application!</h2>
    <p>Hi ${name},</p>
    <p>Thanks for applying to Jeffi Commerce. Our team will review your GST certificate and business details — this usually takes <strong>1–2 business days</strong>.</p>
    <p>You'll receive an email as soon as your application is approved.</p>
    <div class="info-box">📋 <strong>What happens next?</strong><br>
    Once approved, you'll complete your subscription payment and your store will go live on your personal subdomain.</div>
    <p>If you have any questions, reply to this email or contact <a href="mailto:support@jeffistores.in">support@jeffistores.in</a>.</p>
  `)
  await send(owner.email, 'Application received — Jeffi Commerce', html)
  // Also notify platform admin
  await send(PLATFORM_ADMIN, `[KYC] New application from ${owner.email}`, html)
}

export async function sendKycApprovedEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string },
  checkoutUrl: string
) {
  const name = owner.name ?? 'there'
  const html = baseHtml('Application approved!', `
    <h2>Your application has been approved! 🎉</h2>
    <p>Hi ${name},</p>
    <p>Great news — your GST certificate has been verified and your application for <strong>${tenant.display_name}</strong> is approved.</p>
    <p>Complete your subscription payment to launch your store at <strong>${tenant.slug}.jeffistores.in</strong>.</p>
    <a href="${checkoutUrl}" class="cta">Complete payment →</a>
    <div class="info-box">💳 You'll be redirected to Razorpay's secure checkout to set up your subscription.</div>
    <p>Once payment is complete, your store will be provisioned within a few minutes.</p>
  `)
  await send(owner.email, 'Application approved — complete your payment', html)
}

export async function sendKycRejectedEmail(
  owner: { email: string; name: string | null },
  reason: string
) {
  const name = owner.name ?? 'there'
  const html = baseHtml('Application update', `
    <h2>Application could not be verified</h2>
    <p>Hi ${name},</p>
    <p>Unfortunately we were unable to verify your application. Here's what we found:</p>
    <div class="info-box" style="border-color:#fecaca;background:#fef2f2;">⚠️ <strong>${reason}</strong></div>
    <p>Please contact our support team to resolve this — reply to this email or reach us at <a href="mailto:support@jeffistores.in">support@jeffistores.in</a>.</p>
  `)
  await send(owner.email, 'Application update — action required', html)
}

export async function sendPaymentConfirmedEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string; plan: string | null; billing_interval: string }
) {
  const name = owner.name ?? 'there'
  const html = baseHtml('Payment confirmed', `
    <h2>Payment confirmed! Your store is being set up.</h2>
    <p>Hi ${name},</p>
    <p>Your subscription payment for <strong>${tenant.display_name}</strong> has been confirmed.</p>
    <div class="info-box">
      🏪 <strong>Store:</strong> ${tenant.display_name}<br>
      🌐 <strong>URL:</strong> ${tenant.slug}.jeffistores.in<br>
      📋 <strong>Plan:</strong> ${tenant.plan ?? 'Basic'} (${tenant.billing_interval})<br>
      ⏳ <strong>Status:</strong> Being provisioned — usually ready in a few minutes
    </div>
    <p>You'll receive another email when your store is live.</p>
  `)
  await send(owner.email, `Payment confirmed — ${tenant.display_name} is being set up`, html)
}

export async function sendStoreLiveEmail(
  owner: { email: string; name: string | null },
  tenant: { display_name: string; slug: string; plan: string | null }
) {
  const name = owner.name ?? 'there'
  const adminUrl = `https://admin-${tenant.slug}.jeffistores.in`
  const storeUrl = `https://${tenant.slug}.jeffistores.in`
  const html = baseHtml('Your store is live!', `
    <h2>🎉 ${tenant.display_name} is live!</h2>
    <p>Hi ${name},</p>
    <p>Your store is up and running. Here are your important links:</p>
    <div class="info-box">
      🛍️ <strong>Storefront:</strong> <a href="${storeUrl}">${storeUrl}</a><br>
      ⚙️ <strong>Admin panel:</strong> <a href="${adminUrl}">${adminUrl}</a><br>
      📋 <strong>Plan:</strong> ${tenant.plan ?? 'Basic'}
    </div>
    <a href="${adminUrl}" class="cta">Go to your admin panel →</a>
    <p>Your login email is <strong>${owner.email}</strong> — use the same OTP or Google sign-in you used during onboarding.</p>
    <p>Questions? Contact us at <a href="mailto:support@jeffistores.in">support@jeffistores.in</a></p>
  `)
  await send(owner.email, `🎉 ${tenant.display_name} is live — here are your links`, html)
}
