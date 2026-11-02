import 'server-only'
import { promises as dns } from 'node:dns'
import { getCustomDomain, setCustomDomainStatus } from '@/lib/tenant-registry/custom-domains'

// DNS TXT verification for a customer-owned domain.
// Owner adds `_jeffi.{domain}  TXT  "{verification_token}"`. We resolve the record and compare.
// Expires after 48h without a successful match.
const EXPIRY_MS = 48 * 60 * 60 * 1000

export type VerifyOutcome =
  | { ok: true; status: 'dns-verified' }
  | { ok: false; status: 'pending' | 'expired' | 'not-found'; error: string }

export async function verifyDomain(id: string): Promise<VerifyOutcome> {
  const row = await getCustomDomain(id)
  if (!row) return { ok: false, status: 'not-found', error: 'Domain not found' }
  if (!row.verification_token) return { ok: false, status: 'pending', error: 'No verification token' }

  // Already past the dns step — nothing to do.
  if (row.status === 'dns-verified' || row.status === 'cert-pending' || row.status === 'verified') {
    return { ok: true, status: 'dns-verified' }
  }

  const host = `_jeffi.${row.domain}`
  let records: string[][] = []
  try {
    records = await dns.resolveTxt(host)
  } catch (e: unknown) {
    const err = e as { code?: string }
    // NODATA / ENOTFOUND means owner has not added the record yet.
    if (err?.code === 'ENOTFOUND' || err?.code === 'ENODATA') {
      return maybeExpire(row.created_at, id, 'pending', 'TXT record not found')
    }
    return maybeExpire(row.created_at, id, 'pending', `DNS lookup failed: ${err?.code ?? 'unknown'}`)
  }

  const flat = records.map(parts => parts.join('')).map(s => s.trim())
  if (flat.some(v => v === row.verification_token)) {
    await setCustomDomainStatus(id, 'dns-verified')
    return { ok: true, status: 'dns-verified' }
  }
  return maybeExpire(row.created_at, id, 'pending', 'TXT value does not match verification token')
}

async function maybeExpire(
  createdAt: string,
  id: string,
  status: 'pending',
  error: string
): Promise<VerifyOutcome> {
  const age = Date.now() - new Date(createdAt).getTime()
  if (age > EXPIRY_MS) {
    await setCustomDomainStatus(id, 'expired')
    return { ok: false, status: 'expired', error: 'Verification window expired (48h)' }
  }
  return { ok: false, status, error }
}
