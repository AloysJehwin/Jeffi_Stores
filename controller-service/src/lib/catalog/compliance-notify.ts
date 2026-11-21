import 'server-only'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { sendComplianceEmail } from '@/lib/shared/ecom-emails'
import { DOCS, daysUntil, todayIst } from './compliance'
import { KYB_DOCS } from '@controller/lib/kyb/requirements'

// Mail about a store's licences: to the owner when one is not accepted, about to lapse or lapsed; to the platform admin
// when the owner sends one from the console. Lines and rows of the owner mail are HTML, so everything typed is escaped.

export const LICENCES_PAGE = `https://ecom.${ROOT_DOMAIN}/dashboard/licences`
/** Where KYB documents (PAN card, GST certificate, registration proofs) are replaced. */
export const BUSINESS_PAGE = `https://ecom.${ROOT_DOMAIN}/dashboard/business`
/** Stores whose owner has the console to fix a licence in; an application still under review is settled with its KYC. */
export const CONSOLE_STATUSES = ['active', 'provisioning', 'suspended']

const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!)
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const docName = (type: string) => DOCS[type]?.name ?? KYB_DOCS[type]?.label ?? type

interface Owner {
  email: string
  name: string | null
}
interface Doc {
  doc_type: string
  doc_number: string | null
  /** YYYY-MM-DD */
  expires_on: string | null
}
export interface ExpiryNotice extends Doc {
  /** Days before the date (30, 7), or 0 once it has passed. */
  notice: number
}

const docRows = (d: Doc, lapsed = false) => [
  ...(d.doc_number ? [{ label: DOCS[d.doc_type]?.numberLabel ?? KYB_DOCS[d.doc_type]?.numberLabel ?? 'Number', value: esc(d.doc_number) }] : []),
  ...(d.expires_on ? [{ label: lapsed ? 'Expired on' : 'Valid until', value: day(d.expires_on) }] : []),
]

/** The platform admin did not accept a document the owner has to replace. */
export async function notifyDocumentRejected(owner: Owner, store: string, doc: Doc, note: string | null): Promise<void> {
  const name = docName(doc.doc_type)
  // A KYB document (PAN card, GST certificate, registration proof) is replaced on Business verification.
  const kyb = !DOCS[doc.doc_type] && !!KYB_DOCS[doc.doc_type]
  await sendComplianceEmail(owner, {
    subject: `${store}: your ${name} was not accepted`,
    title: kyb ? 'A verification document was not accepted' : 'A licence was not accepted',
    lines: [
      `We could not accept the <strong>${esc(name)}</strong> you sent for <strong>${esc(store)}</strong>.`,
      kyb
        ? 'Upload a corrected copy from Business verification in your console. We review it again as soon as it arrives.'
        : 'Upload a corrected copy from Licences &amp; certificates in your console. We review it again as soon as it arrives.',
    ],
    rows: docRows(doc),
    ...(note ? { warn: `<strong>Reason:</strong> ${esc(note)}` } : {}),
    cta: { href: kyb ? BUSINESS_PAGE : LICENCES_PAGE, label: 'Upload a new copy' },
  })
}

const when = (n: number) => (n <= 0 ? 'that is today' : n === 1 ? 'tomorrow' : `${n} days from now`)

/** One store's licences that are about to lapse or have: one email however many there are. */
export async function notifyExpiry(owner: Owner, store: string, docs: ExpiryNotice[], today = todayIst()): Promise<void> {
  if (!docs.length) return
  const lapsed = docs.some(d => d.notice === 0)
  const one = docs.length === 1 ? docs[0] : null
  const s = esc(store)
  const subject = one
    ? lapsed
      ? `${store}: your ${docName(one.doc_type)} has expired`
      : `${store}: your ${docName(one.doc_type)} expires on ${day(one.expires_on!)}`
    : `${store}: ${docs.length} licences ${lapsed ? 'need renewing' : 'expire soon'}`
  const lead = one
    ? lapsed
      ? `Your <strong>${esc(docName(one.doc_type))}</strong> for <strong>${s}</strong> expired on <strong>${day(one.expires_on!)}</strong>. It shows as expired on your store's record until you upload the renewed one.`
      : `Your <strong>${esc(docName(one.doc_type))}</strong> for <strong>${s}</strong> is valid until <strong>${day(one.expires_on!)}</strong>, ${when(daysUntil(one.expires_on!, today))}. Renew it and upload the renewed one before then.`
    : `These licences for <strong>${s}</strong> ${lapsed ? 'have expired or are about to' : 'are about to expire'}. Renew each one and upload the renewed copy; an expired one shows on your store's record until you do.`
  await sendComplianceEmail(owner, {
    subject,
    title: lapsed ? (one ? 'A licence has expired' : 'Licences need renewing') : one ? 'A licence expires soon' : 'Licences expire soon',
    lines: [lead, 'We review each renewed licence as soon as it arrives.'],
    rows: one
      ? docRows(one, lapsed)
      : docs.map(d => ({
          label: esc(docName(d.doc_type)),
          value: `${d.doc_number ? `${esc(d.doc_number)} · ` : ''}${d.notice === 0 ? 'expired' : 'valid until'} ${day(d.expires_on!)}`,
        })),
    cta: { href: LICENCES_PAGE, label: one ? 'Upload the renewed licence' : 'Upload renewed licences' },
  })
}

/** The owner sent a licence from the console: the platform admin reviews it on the store's KYC tab. */
export async function alertDocumentSubmitted(
  tenant: { id: string; slug: string; display_name: string },
  doc: Doc & { category: string },
  replaced: boolean
): Promise<void> {
  const { sendPlatformAlert } = await import('@controller/lib/provisioning/alerts')
  const admin = process.env.ADMIN_BASE_URL || `https://admin.${ROOT_DOMAIN}`
  const body = [
    `Store: ${tenant.display_name} (${tenant.slug})`,
    `Document: ${docName(doc.doc_type)}${replaced ? ' (replaces the one on file)' : ''}`,
    `Category: ${doc.category}`,
    ...(doc.doc_number ? [`Number: ${doc.doc_number}`] : []),
    ...(doc.expires_on ? [`Valid until: ${doc.expires_on}`] : []),
    '',
    `${admin}/ecom/customers/${tenant.id}?tab=kyc`,
  ].join('\n')
  await sendPlatformAlert(`Licence to review: ${docName(doc.doc_type)} for ${tenant.display_name}`, body, {
    kind: 'compliance_review',
    kicker: 'Licence Review',
    footer: 'Sent when a store owner uploads a licence from the console.',
  })
}
