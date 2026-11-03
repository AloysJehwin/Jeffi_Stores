// Admin certificates are delivered ONLY through the certificate portal
// (certificate.<root>). The .p12 and its password are never attached to mail, returned to the
// browser, or shown on screen — the portal is the sole way to obtain a cert (#487). The former
// email / both transition modes (CERT_PORTAL_DELIVERY) have been removed; there is no opt-out.

export function certPortalUrl(): string {
  const root = process.env.PLATFORM_ROOT_DOMAIN || process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  return `https://certificate.${root}`
}
