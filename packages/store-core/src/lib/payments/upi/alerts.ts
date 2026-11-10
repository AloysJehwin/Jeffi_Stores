import 'server-only'
import { simpleParser } from 'mailparser'
import { authenticate } from 'mailauth'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'
import { alertFingerprint, bankDomainOf, parseBankAlert, parseGmailForwardingConfirmation, trustBankMail, type MailAuthFacts } from './alert-parse'
import { merchantUpiVpa } from './creds'
import { platformDb, storeDb } from './intents'
import { matchObservation } from './settle'
import { insertObservation } from './upg'

/**
 * The UPG observer (docs/plans/UPI_UPG_V2.md §3): a bank credit-alert email forwarded to the
 * merchant's upi+<slug>.<token> address. Runs in the merchant's context (the store's, or none for the
 * platform). Only mail a bank provably sent completes a payment; the rest is kept for staff.
 */

export type AlertOutcome = 'gmail_confirmation' | 'ignored' | 'duplicate' | 'untrusted' | 'observed' | 'matched'

const domainOf = (addr: string | null | undefined) => (addr ?? '').trim().toLowerCase().split('@')[1] ?? null

/** DKIM as we verify it, and Gmail's ARC set when its chain validates. DNS failures leave the mail untrusted. */
async function authFacts(raw: Buffer, fromDomain: string | null): Promise<MailAuthFacts> {
  try {
    const r: any = await authenticate(raw, { trustReceived: true, disableBimi: true } as any)
    const dkim = (r?.dkim?.results ?? []).map((s: any) => ({ domain: s?.signingDomain, result: s?.status?.result }))
    const a = r?.arc
    const arc = a
      ? {
          result: a.status?.result,
          sealDomain: a.signature?.signingDomain,
          dkim: (a.authenticationResults?.dkim ?? []).map((e: any) => ({
            domain: typeof e?.header?.d === 'string' ? e.header.d : typeof e?.header?.i === 'string' ? e.header.i.replace(/^.*@/, '') : null,
            result: e?.result,
          })),
        }
      : null
    return { fromDomain, dkim, arc }
  } catch (e: any) {
    console.warn('[upi:alert] authentication check failed', e?.message ?? e)
    return { fromDomain, dkim: [], arc: null }
  }
}

export async function handleUpgAlertEmail(input: { raw: Buffer; sesMessageId: string }): Promise<AlertOutcome> {
  const tenant = getCurrentTenant()
  const tenantId = tenant?.tenantId ?? null
  const db = tenantId ? storeDb : platformDb
  const store = tenant ? { tenantId: tenant.tenantId, slug: tenant.slug } : null
  const mail = await simpleParser(input.raw)
  const from = mail.from?.value?.[0]?.address?.trim().toLowerCase() ?? null
  const subject = mail.subject ?? ''
  const text = mail.text || (typeof mail.html === 'string' ? mail.html.replace(/<[^>]+>/g, ' ') : '')
  const messageId = mail.messageId?.replace(/^<|>$/g, '') || null

  const gmail = parseGmailForwardingConfirmation({ from, subject, text })
  if (gmail) {
    await insertObservation(
      { kind: 'gmail_forwarding', receivingVpa: null, amountPaise: null, utr: null, sesMessageId: input.sesMessageId, messageId, fingerprint: `gmail:${input.sesMessageId}`, trusted: false, subject, details: gmail },
      db
    )
    return 'gmail_confirmation'
  }

  const fromDomain = domainOf(from)
  const parsed = parseBankAlert({ subject, text, bankDomain: bankDomainOf(fromDomain) })
  if (parsed.kind !== 'credit' || !parsed.amountPaise) return 'ignored'
  const vpa = (await merchantUpiVpa(tenantId))?.toLowerCase() ?? null
  if (!vpa) return 'ignored'

  const trust = trustBankMail(await authFacts(input.raw, fromDomain))
  const observedAt = new Date()
  const obs = await insertObservation(
    {
      receivingVpa: vpa,
      amountPaise: parsed.amountPaise,
      utr: parsed.utr,
      senderVpa: parsed.senderVpa,
      bankDomain: trust.bankDomain ?? fromDomain,
      sesMessageId: input.sesMessageId,
      messageId,
      fingerprint: alertFingerprint({ receivingVpa: vpa, amountPaise: parsed.amountPaise, utr: parsed.utr, at: observedAt }),
      trusted: trust.trusted,
      subject,
      details: { from, via: trust.via },
      observedAt,
    },
    db
  )
  if (!obs) return 'duplicate'
  if (!obs.trusted) return 'untrusted'
  return (await matchObservation(obs, { store, db })) ? 'matched' : 'observed'
}
