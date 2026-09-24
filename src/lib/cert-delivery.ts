// How admin certificates reach the person, during the portal transition.
//   email  — legacy: attach the .p12 + password in the mail (no portal invite)
//   both   — transition (DEFAULT): attach the .p12 AND record it in the portal + send an invite,
//            so nobody is stranded if the portal has an issue
//   portal — hard cutover: invite link only; the .p12/password are never attached, returned to the
//            browser, or shown on screen — the portal is the sole way to obtain the cert
export type CertDeliveryMode = 'email' | 'both' | 'portal'

export function certDeliveryMode(): CertDeliveryMode {
  const v = (process.env.CERT_PORTAL_DELIVERY || 'both').toLowerCase()
  return v === 'email' || v === 'portal' ? v : 'both'
}

/** True when the raw .p12/password may still be delivered by mail / browser / on-screen. */
export function mayDeliverBlob(): boolean {
  return certDeliveryMode() !== 'portal'
}

export function certPortalUrl(): string {
  const root = process.env.PLATFORM_ROOT_DOMAIN || process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  return `https://certificate.${root}`
}
