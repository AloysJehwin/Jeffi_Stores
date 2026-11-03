// Traefik passTLSClientCert headers → the nginx-style values the app already consumes
// (x-client-cert = PEM, x-client-cert-serial = hex, x-client-cert-cn). Edge-safe: no node crypto.

export const TRAEFIK_CERT_HEADER = 'x-forwarded-tls-client-cert'
export const TRAEFIK_CERT_INFO_HEADER = 'x-forwarded-tls-client-cert-info'

function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

// Traefik sends the leaf (then chain, comma-separated) as base64 DER without delimiters or newlines.
export function traefikCertToPem(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const decoded = safeDecode(raw.trim())
  if (!decoded) return null
  const leaf = decoded.split(',')[0].replace(/\s+/g, '')
  if (!leaf || !/^[A-Za-z0-9+/]+={0,2}$/.test(leaf)) return null
  const lines = leaf.match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

function decimalToHex(dec: string): string | null {
  if (!/^\d+$/.test(dec)) return null
  let hex = BigInt(dec).toString(16).toUpperCase()
  if (hex.length % 2) hex = '0' + hex
  return hex
}

// Info looks like: Subject="CN=alice,O=Acme";Issuer="CN=CA";SerialNumber="1234";NB="…";NA="…"
export function parseTraefikCertInfo(raw: string | null | undefined): {
  serial: string | null
  commonName: string | null
} {
  const none = { serial: null, commonName: null }
  if (!raw || !raw.trim()) return none
  const decoded = safeDecode(raw.trim())
  if (!decoded) return none
  const leaf = decoded.split(',Subject=')[0]
  const field = (name: string) => leaf.match(new RegExp(`(?:^|;)${name}="([^"]*)"`))?.[1] ?? null
  const subject = field('Subject')
  const cn = subject?.match(/(?:^|,)CN=([^,]*)/)?.[1] ?? null
  // Traefik renders the serial as a decimal big integer; nginx (and service_accounts) use hex.
  const serialRaw = field('SerialNumber')
  return { serial: serialRaw ? decimalToHex(serialRaw) : null, commonName: cn || null }
}

// Only trust Traefik's headers when it is the configured edge: behind nginx a client could send them.
export function clientCertProxy(): 'traefik' | 'nginx' {
  return process.env.CLIENT_CERT_PROXY === 'traefik' ? 'traefik' : 'nginx'
}

// Returns the values the proxy asserted, normalised to the nginx header contract.
export function clientCertFromProxy(
  headers: Headers,
  proxy: 'traefik' | 'nginx' = clientCertProxy()
): { pem: string | null; serial: string | null; commonName: string | null } {
  if (proxy === 'traefik') {
    const info = parseTraefikCertInfo(headers.get(TRAEFIK_CERT_INFO_HEADER))
    return { pem: traefikCertToPem(headers.get(TRAEFIK_CERT_HEADER)), ...info }
  }
  return {
    pem: headers.get('x-client-cert'),
    serial: headers.get('x-client-cert-serial'),
    commonName: headers.get('x-client-cert-cn'),
  }
}
