import { createHash } from 'node:crypto'

// Enhanced-conversion identifiers, normalised the way Google documents (Data Manager formatting
// guide, same as the Ads API): no whitespace, lowercase; for gmail.com / googlemail.com also drop
// every dot and any +suffix from the username; phones in E.164. SHA-256 as 64 lowercase hex chars.

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').replace(/\s+/g, '').toLowerCase()
  const parts = s.split('@')
  if (parts.length !== 2) return null
  let [user] = parts
  const domain = parts[1]
  if (!user || !domain || !domain.includes('.')) return null
  if (GMAIL_DOMAINS.has(domain)) user = user.replace(/\./g, '').replace(/\+.*$/, '')
  return user ? `${user}@${domain}` : null
}

/**
 * E.164 (+<country><number>). A number without a country code is read as Indian: 10 digits,
 * a trunk 0 + 10 digits, or 91 + 10 digits. Anything ambiguous returns null.
 */
export function normalizePhoneE164(raw: string | null | undefined, defaultCountry = '91'): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let digits = s.replace(/\D/g, '')
  let international = s.startsWith('+')
  if (!international && s.startsWith('00')) {
    digits = digits.slice(2)
    international = true
  }
  let e164: string
  if (international) e164 = `+${digits}`
  else if (digits.length === 10) e164 = `+${defaultCountry}${digits}`
  else if (digits.length === 11 && digits.startsWith('0')) e164 = `+${defaultCountry}${digits.slice(1)}`
  else if (digits.length === 10 + defaultCountry.length && digits.startsWith(defaultCountry)) e164 = `+${digits}`
  else return null
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export interface UserIdentifier {
  userIdentifierSource: 'FIRST_PARTY'
  hashedEmail?: string
  hashedPhoneNumber?: string
}

/** One identifier per value (each UserIdentifier carries exactly one of email / phone). */
export function userIdentifiers(email: string | null | undefined, phone: string | null | undefined): UserIdentifier[] {
  const out: UserIdentifier[] = []
  const e = normalizeEmail(email)
  if (e) out.push({ userIdentifierSource: 'FIRST_PARTY', hashedEmail: sha256Hex(e) })
  const p = normalizePhoneE164(phone)
  if (p) out.push({ userIdentifierSource: 'FIRST_PARTY', hashedPhoneNumber: sha256Hex(p) })
  return out
}

export type DataManagerIdentifier = { emailAddress: string } | { phoneNumber: string }

/** Data Manager shape: one UserIdentifier per value, hex-encoded hashes (request encoding HEX). */
export function dmUserIdentifiers(email: string | null | undefined, phone: string | null | undefined): DataManagerIdentifier[] {
  const out: DataManagerIdentifier[] = []
  const e = normalizeEmail(email)
  if (e) out.push({ emailAddress: sha256Hex(e) })
  const p = normalizePhoneE164(phone)
  if (p) out.push({ phoneNumber: sha256Hex(p) })
  return out
}
