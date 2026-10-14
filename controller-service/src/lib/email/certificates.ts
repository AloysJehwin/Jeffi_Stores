import 'server-only'
import { sendAuditedMail, mailShell, storeName, adminMailFrom, currentAdminBaseUrl } from './shared'

// Admin certs are delivered ONLY via the certificate portal (#487): the .p12/password are never
// attached to mail. This keeps the old call signature (callers still pass the blob) but ignores it
// and always sends the no-attachment portal invite. The _blob params are intentionally unused.
export async function sendAdminCertificateEmail(
  email: string,
  displayName: string,
  _p12Buffer: Buffer,
  _p12Password: string,
  _serialNumber: string,
  _expiresAt: string,
  role: string,
  tenant?: { slug: string; storeName: string }
) {
  return sendCertInviteEmail(email, displayName, role, tenant)
}

// Portal-era delivery: an INVITATION with no attachment and no password. The recipient signs in at
// certificate.jeffistores.in with this same Google (Gmail) account and downloads the cert once.
export async function sendCertInviteEmail(
  email: string,
  displayName: string,
  role: string,
  tenant?: { slug: string; storeName: string }
) {
  const { certPortalUrl } = await import('@/lib/tenancy/cert-delivery')
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
