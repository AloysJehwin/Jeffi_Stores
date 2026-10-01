import 'server-only'
import { sendAuditedMail, mailShell, storeName, adminMailFrom, currentAdminBaseUrl } from './shared'

export async function sendAdminCertificateEmail(
  email: string,
  displayName: string,
  p12Buffer: Buffer,
  p12Password: string,
  serialNumber: string,
  expiresAt: string,
  role: string,
  tenant?: { slug: string; storeName: string }
) {
  // portal: invite only, never the .p12 or password. both: attachment plus the portal link. email: attachment only.
  const { certDeliveryMode, certPortalUrl } = await import('@/lib/tenancy/cert-delivery')
  const mode = certDeliveryMode()
  if (mode === 'portal') {
    return sendCertInviteEmail(email, displayName, role, tenant)
  }
  const portalNote =
    mode === 'both'
      ? `
            <div class="info">
              <strong>Prefer to download it later?</strong>
              <p style="margin: 8px 0 0 0;">This certificate is also available once from the certificate portal at
                <a href="${certPortalUrl()}" style="color:#2563eb;">${certPortalUrl()}</a>.
                Sign in there with <strong>${email}</strong> (Google, or a one-time code sent to this address).</p>
            </div>
`
      : ''
  // Tenant owners are an ecom communication, so they come from ecommerce@; the platform's
  // own admin certs keep the existing admin sender.
  const from = tenant
    ? `"Jeffi Commerce" <${process.env.ECOM_FROM_EMAIL || 'ecommerce@jeffistores.in'}>`
    : adminMailFrom()
  const subject = tenant ? `Your admin certificate for ${tenant.storeName}` : 'Your Admin Certificate - Jeffi Stores'
  const certFileSlug = (displayName || email).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'admin'
  // A tenant owner administers their own store on their own host. Sending them to the
  // platform's admin panel gave them a certificate their browser was never asked for, and a
  // login they have no account on.
  const platformDomain = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  const adminUrl = tenant
    ? `https://admin-${tenant.slug}.${platformDomain}/admin/login`
    : `${currentAdminBaseUrl()}/login`
  const headerName = tenant ? tenant.storeName : storeName()
  const html = mailShell({
    brand: headerName,
    kicker: 'Admin Panel Access',
    title: `Welcome, ${displayName}!`,
    extraCss: `
      .credential-box { background-color: #1e293b; color: #e2e8f0; padding: 20px; border-radius: 8px; margin: 20px 0; font-family: monospace; }
      .credential-box .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
      .credential-box .value { color: #38bdf8; font-size: 16px; font-weight: bold; word-break: break-all; }
      .credential-box hr { border: none; border-top: 1px solid #334155; margin: 12px 0; }
    `,
    content: `
      <p>You have been added as an <strong>${role}</strong> on the ${headerName} admin panel. Your client certificate is attached to this email.</p>

      <div class="credential-box">
        <div class="label">Email</div>
        <div class="value">${email}</div>
        <hr>
        <div class="label">Certificate Password</div>
        <div class="value">${p12Password}</div>
        <hr>
        <div class="label">Certificate Serial</div>
        <div class="value" style="font-size: 11px;">${serialNumber}</div>
        <hr>
        <div class="label">Expires On</div>
        <div class="value">${new Date(expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      <div class="warning">
        <strong>Important Security Notice</strong>
        <ul style="margin: 8px 0 0 0; padding-left: 20px;">
          <li>The attached <code>.p12</code> certificate file is required to access the admin panel.</li>
          <li>Install it in your browser or system keychain using the password above.</li>
          <li>Do <strong>not</strong> share this certificate or password with anyone.</li>
          <li>This certificate is valid for 365 days from issuance.</li>
        </ul>
      </div>

      <div class="info">
        <strong>How to install:</strong>
        <ol style="margin: 8px 0 0 0; padding-left: 20px;">
          <li>Download the attached <code>${certFileSlug}-admin-cert.p12</code> file.</li>
          <li>Double-click the file to open it in your system's certificate manager.</li>
          <li>Enter the certificate password shown above when prompted.</li>
          <li>Navigate to <a href="${adminUrl}" style="color:#2563eb;"><strong>${adminUrl}</strong></a> to access the admin panel.</li>
        </ol>
      </div>

${portalNote}
      <p>If you have any questions, contact the super admin.</p>
    `,
    footerLines: tenant
      ? []
      : [
          'SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092',
          `Phone: +91 96853 54099 | Email: ${process.env.ADMIN_EMAIL || `admin@${platformDomain}`}`,
        ],
  })
  const attachments = [
    {
      filename: `${certFileSlug}-admin-cert.p12`,
      content: p12Buffer,
      contentType: 'application/x-pkcs12',
    },
  ]

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      attachments,
      kind: 'admin_notification',
      templateName: 'admin_certificate',
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
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
