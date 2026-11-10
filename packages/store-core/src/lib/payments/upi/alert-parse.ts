import { createHash, createHmac, timingSafeEqual } from 'crypto'

/**
 * Bank credit-alert emails (docs/plans/UPI_UPG_V2.md §3), pure: the forwarding address, which senders
 * are banks, what an alert says, and whether its authentication results can be trusted.
 */

// ── address: upi+<slug>.<token>@<reply domain> ─────────────────────────────────────────────────────

export const alertDomain = () => process.env.REPLY_MAIL_DOMAIN || `reply.${process.env.PLATFORM_DOMAIN || 'jeffistores.in'}`
/** The flagship's slug wherever it acts as a tenant. */
export const PLATFORM_ALERT_SLUG = 'platform'

export function alertToken(slug: string, secret = process.env.UPG_ALERT_SECRET || ''): string {
  return createHmac('sha256', secret).update(slug.toLowerCase()).digest('hex').slice(0, 12)
}

/** Null when UPG_ALERT_SECRET is unset: an address anyone could compute is worse than none. */
export function alertAddress(slug: string, secret = process.env.UPG_ALERT_SECRET || '', domain = alertDomain()): string | null {
  if (!secret) return null
  return `upi+${slug.toLowerCase()}.${alertToken(slug, secret)}@${domain}`
}

/** upi+<slug>.<token>@domain with a valid token → the slug; anything else is not ours. */
export function parseAlertAddress(addr: string, secret = process.env.UPG_ALERT_SECRET || '', domain = alertDomain()): { slug: string } | null {
  const m = /^upi\+([a-z0-9-]+)\.([a-f0-9]{12})@(.+)$/i.exec(addr.trim().replace(/^.*<|>.*$/g, ''))
  if (!m || !secret || m[3].toLowerCase() !== domain.toLowerCase()) return null
  const slug = m[1].toLowerCase()
  const want = Buffer.from(alertToken(slug, secret))
  const got = Buffer.from(m[2].toLowerCase())
  return want.length === got.length && timingSafeEqual(want, got) ? { slug } : null
}

// ── bank domains ───────────────────────────────────────────────────────────────────────────────────

const LEGACY_BANK_DOMAINS = [
  'hdfcbank.net', 'hdfcbank.com', 'icicibank.com', 'sbi.co.in', 'axisbank.com', 'kotak.com', 'yesbank.in', 'idfcfirstbank.com',
  'indusind.com', 'pnb.co.in', 'bankofbaroda.co.in', 'bankofbaroda.com', 'canarabank.com', 'unionbankofindia.co.in',
  'federalbank.co.in', 'aubank.in', 'rblbank.com', 'idbibank.co.in', 'bandhanbank.com',
]

const host = (v: string) => v.trim().toLowerCase().replace(/^.*@/, '').replace(/\.$/, '')

/** The bank's registered domain for a sender host (subdomains included; <name>.bank.in), or null. */
export function bankDomainOf(domainOrAddress: string | null | undefined): string | null {
  const h = host(domainOrAddress ?? '')
  if (!h) return null
  const legacy = LEGACY_BANK_DOMAINS.find(d => h === d || h.endsWith(`.${d}`))
  if (legacy) return legacy
  const m = /(?:^|\.)([a-z0-9-]+\.bank\.in)$/.exec(h)
  return m ? m[1] : null
}

// ── trust ──────────────────────────────────────────────────────────────────────────────────────────

export interface MailAuthFacts {
  fromDomain: string | null
  /** DKIM signatures on the message as verified by us. */
  dkim: Array<{ domain: string | null | undefined; result: string | null | undefined }>
  /** The newest ARC set, when its chain validates (cv=pass). */
  arc?: { result: string | null | undefined; sealDomain: string | null | undefined; dkim: Array<{ domain: string | null | undefined; result: string | null | undefined }> } | null
}

/**
 * Auto-confirm only mail a bank provably sent: From is a bank domain and that bank's DKIM signature
 * verifies, or Gmail's ARC seal (chain passes, sealed by google.com) recorded dkim=pass for it.
 */
export function trustBankMail(f: MailAuthFacts): { trusted: boolean; bankDomain: string | null; via: 'dkim' | 'arc' | null } {
  const bank = bankDomainOf(f.fromDomain)
  if (!bank) return { trusted: false, bankDomain: null, via: null }
  const sameBank = (d: string | null | undefined) => !!d && bankDomainOf(d) === bank
  if (f.dkim.some(s => s.result === 'pass' && sameBank(s.domain))) return { trusted: true, bankDomain: bank, via: 'dkim' }
  const arc = f.arc
  if (arc && arc.result === 'pass' && host(arc.sealDomain ?? '') === 'google.com' && arc.dkim.some(s => s.result === 'pass' && sameBank(s.domain))) {
    return { trusted: true, bankDomain: bank, via: 'arc' }
  }
  return { trusted: false, bankDomain: bank, via: null }
}

// ── alert text ─────────────────────────────────────────────────────────────────────────────────────

export interface ParsedAlert {
  kind: 'credit' | 'debit' | 'unknown'
  amountPaise: number | null
  utr: string | null
  senderVpa: string | null
}

const AMOUNT = String.raw`(?:Rs\.?|INR|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`
const VPA = String.raw`([A-Za-z0-9][A-Za-z0-9._-]{1,}@[A-Za-z][A-Za-z0-9]{1,})(?![A-Za-z0-9]*\.[A-Za-z])`

const toPaise = (s: string | undefined) => {
  const n = Number((s ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

/** Bank formats where a field sits somewhere the generic patterns would misread. Each returns what it is sure of. */
const BANK_PATTERNS: Array<{ bank: string; credit: RegExp }> = [
  // HDFC: "Rs.500.00 is successfully credited to your account **1234 by VPA a@b NAME on 10-11-26. Your UPI transaction reference number is 431234567890."
  { bank: 'hdfcbank.net', credit: new RegExp(String.raw`${AMOUNT}\s+(?:is|has been)\s+(?:successfully\s+)?credited to (?:your\s+)?(?:account|a\/c)[^.]*?(?:by|from)\s+VPA\s+${VPA}[\s\S]*?reference (?:number|no\.?)\s*(?:is)?\s*:?\s*(\d{12})`, 'i') },
  // ICICI: "Account XX123 has been credited with INR 1,500.00 on 10-Nov-26. Info: UPI/431234567890/a@b/..."
  { bank: 'icicibank.com', credit: new RegExp(String.raw`credited with\s+${AMOUNT}[\s\S]*?UPI[\/-](\d{12})(?:[\/-]${VPA})?`, 'i') },
  // SBI: "a/c no. XX1234 is credited by Rs.250.00 on 10-11-26 by a/c linked to VPA a@b (UPI Ref no 431234567890)"
  { bank: 'sbi.co.in', credit: new RegExp(String.raw`credited by\s+${AMOUNT}[\s\S]*?VPA\s+${VPA}[\s\S]*?Ref\.?\s*(?:no\.?)?\s*:?\s*(\d{12})`, 'i') },
  // Axis: "INR 750.00 credited to A/c no. XX1234 on ... Info - UPI/P2A/431234567890/NAME"
  { bank: 'axisbank.com', credit: new RegExp(String.raw`${AMOUNT}\s+(?:was\s+|has been\s+)?credited to[\s\S]*?UPI\/[A-Z0-9]{2,4}\/(\d{12})`, 'i') },
  // Kotak: "Received Rs.300.00 in your Kotak Bank AC X1234 from a@b on 10-11-26. UPI Ref:431234567890."
  { bank: 'kotak.com', credit: new RegExp(String.raw`Received\s+${AMOUNT}[\s\S]*?from\s+${VPA}[\s\S]*?UPI Ref\.?\s*(?:no\.?)?\s*:?\s*(\d{12})`, 'i') },
]

const CREDIT_WORDS = /\b(credited|credit(?:\s+(?:of|by|alert))?|received|deposited)\b/i
const DEBIT_WORDS = /\b(debited|debit(?:\s+(?:of|by|alert))?|withdrawn|spent|paid|sent)\b/i

const squash = (s: string) => s.replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim()

function utrIn(t: string): string | null {
  const labelled = /(?:UPI|UTR|RRN|Ref(?:erence)?)[^0-9]{0,40}?(\d{12})(?!\d)/i.exec(t)
  if (labelled) return labelled[1]
  const any = /(?<![\d.,])(\d{12})(?![\d.,])/.exec(t)
  return any ? any[1] : null
}

/**
 * What a bank alert says. Direction is the first of the credit / debit words in the text ("debited …
 * and credited to X" is a debit); debits and anything without an amount are ignored by the caller.
 */
export function parseBankAlert(input: { subject?: string | null; text?: string | null; bankDomain?: string | null }): ParsedAlert {
  const text = squash(`${input.text ?? ''}`)
  const all = squash(`${input.subject ?? ''}. ${text}`)
  const c = CREDIT_WORDS.exec(text) ?? CREDIT_WORDS.exec(all)
  const d = DEBIT_WORDS.exec(text) ?? DEBIT_WORDS.exec(all)
  const kind: ParsedAlert['kind'] = c && (!d || c.index < d.index) ? 'credit' : d ? 'debit' : 'unknown'
  if (kind !== 'credit') return { kind, amountPaise: null, utr: null, senderVpa: null }

  for (const p of BANK_PATTERNS) {
    if (input.bankDomain && input.bankDomain !== p.bank && !(p.bank === 'hdfcbank.net' && input.bankDomain === 'hdfcbank.com')) continue
    const m = p.credit.exec(text)
    if (!m) continue
    const groups = m.slice(1).filter(Boolean)
    const amount = toPaise(m[1])
    const utr = groups.find(g => /^\d{12}$/.test(g)) ?? null
    const vpa = groups.find(g => g.includes('@')) ?? null
    if (amount) return { kind, amountPaise: amount, utr, senderVpa: vpa?.toLowerCase() ?? null }
  }

  const amount = toPaise(new RegExp(AMOUNT, 'i').exec(text)?.[1])
  const vpa = new RegExp(String.raw`(?:from|by)\s+(?:VPA\s+|UPI ID\s+)?${VPA}`, 'i').exec(text)?.[1] ?? new RegExp(String.raw`VPA\s+${VPA}`, 'i').exec(text)?.[1] ?? null
  return { kind, amountPaise: amount, utr: utrIn(text), senderVpa: vpa?.toLowerCase() ?? null }
}

/** Gmail's "confirm forwarding" mail: the code and the confirmation link. */
export function parseGmailForwardingConfirmation(input: { from?: string | null; subject?: string | null; text?: string | null }): { code: string | null; link: string | null } | null {
  if (!/^forwarding-noreply@google\.com$/i.test((input.from ?? '').trim())) return null
  const text = `${input.subject ?? ''}\n${input.text ?? ''}`
  const code = /confirmation code[:\s#(]*?(\d{6,12})/i.exec(text)?.[1] ?? /\(#?(\d{6,12})\)/.exec(input.subject ?? '')?.[1] ?? null
  const link = /https:\/\/(?:mail(?:-settings)?|isolated\.mail)\.google\.com\/mail\/[^\s<>"')]+/i.exec(text)?.[0] ?? null
  return { code, link }
}

/** sha256(receiving_vpa | amount_paise | utr | 10-minute bucket); the unique UTR catches a later re-forward. */
export function alertFingerprint(p: { receivingVpa: string; amountPaise: number; utr: string | null; at: Date | number }): string {
  const bucket = Math.floor(new Date(p.at).getTime() / 600_000)
  return createHash('sha256').update(`${p.receivingVpa.toLowerCase()}|${p.amountPaise}|${p.utr ?? ''}|${bucket}`).digest('hex')
}
