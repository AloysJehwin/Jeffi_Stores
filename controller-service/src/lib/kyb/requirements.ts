// What each service needs verified before Jeffi switches it on (docs/KYB.md), and where a business stands against
// that. Pure: the console, the owner and admin routes, and the service approval gates all evaluate the same rules.
import { checkCin, checkGstin, checkLlpin, checkPan, checkUdyam, formatLlpin, formatUdyam, isEntityType, type EntityType, type IdCheck } from './ids'
import type { DocAnalysis } from './extract'

/** tenant_compliance_documents.category for KYB documents; everything else there is a selling licence. */
export const KYB_CATEGORY = 'KYB'

export type KybService = 'showcase' | 'documents' | 'messaging' | 'store'
export type KybItem = 'profile' | 'pan' | 'gst' | 'registration' | 'website' | 'messaging_use' | 'bank' | 'licences'

/**
 * A showcase site is a public page about the business: it needs no verification beyond its name and a contact.
 * Documents issue tax invoices in the business's name; messaging sends to people in its name; a store also takes
 * payments and ships, so it adds the payout account and the licences for what it sells. A registration proof is
 * asked only of a business without GST (the GST certificate proves registration otherwise).
 */
export const SERVICE_ITEMS: Record<KybService, KybItem[]> = {
  showcase: [],
  documents: ['profile', 'pan', 'gst', 'registration'],
  messaging: ['profile', 'pan', 'gst', 'registration', 'website', 'messaging_use'],
  store: ['profile', 'pan', 'gst', 'registration', 'bank', 'licences'],
}

export const SERVICE_LABEL: Record<KybService, string> = {
  showcase: 'Showcase site',
  documents: 'Documents API',
  messaging: 'Messaging API',
  store: 'Online store',
}

export const ITEM_LABEL: Record<KybItem, string> = {
  profile: 'Business details',
  pan: 'PAN',
  gst: 'GST registration',
  registration: 'Registration proof',
  website: 'Website',
  messaging_use: 'How you will message people',
  bank: 'Payout bank account',
  licences: 'Licences for what you sell',
}

// ── Documents ──

export interface KybDocType {
  id: string
  label: string
  numberLabel?: string
  /** Checks the typed number; documents without a fixed format take any number. */
  check?: (n: string) => IdCheck
  format?: (n: string) => string
  /** Business types this registration proof suits. */
  entities?: EntityType[]
  /** Licences that lapse ask for an expiry date. */
  expires?: boolean
  hint: string
}

export const KYB_DOCS: Record<string, KybDocType> = {
  pan_card: {
    id: 'pan_card',
    label: 'PAN card',
    numberLabel: 'PAN',
    hint: 'A clear photo or scan of the PAN card, or the e-PAN PDF. A sole proprietorship uses the proprietor’s own PAN card.',
  },
  gst_cert: {
    id: 'gst_cert',
    label: 'GST registration certificate (Form GST REG-06)',
    numberLabel: 'GSTIN',
    hint: 'Download the PDF from the GST portal: Services → User Services → View/Download Certificates.',
  },
  udyam: {
    id: 'udyam',
    label: 'Udyam registration certificate',
    numberLabel: 'Udyam number',
    check: checkUdyam,
    format: formatUdyam,
    entities: ['proprietor', 'partnership', 'llp', 'pvt_ltd', 'opc', 'public_ltd', 'huf', 'other'],
    hint: 'From udyamregistration.gov.in. Free, and it proves the business exists.',
  },
  shop_est: {
    id: 'shop_est',
    label: 'Shop and Establishment registration',
    numberLabel: 'Registration number',
    entities: ['proprietor', 'partnership', 'huf', 'other'],
    expires: true,
    hint: 'Issued by your state’s labour department or municipality.',
  },
  coi: {
    id: 'coi',
    label: 'Certificate of incorporation',
    numberLabel: 'CIN',
    check: checkCin,
    entities: ['pvt_ltd', 'opc', 'public_ltd'],
    hint: 'Issued by the Ministry of Corporate Affairs when the company was registered.',
  },
  llp_cert: {
    id: 'llp_cert',
    label: 'LLP certificate of incorporation',
    numberLabel: 'LLPIN',
    check: checkLlpin,
    format: formatLlpin,
    entities: ['llp'],
    hint: 'Issued by the Ministry of Corporate Affairs when the LLP was registered.',
  },
  partnership_deed: {
    id: 'partnership_deed',
    label: 'Partnership deed or firm registration certificate',
    numberLabel: 'Registration number, if the firm is registered',
    entities: ['partnership'],
    hint: 'The signed deed, or the Registrar of Firms certificate.',
  },
  trust_reg: {
    id: 'trust_reg',
    label: 'Trust deed or society registration certificate',
    numberLabel: 'Registration number',
    entities: ['trust', 'society'],
    hint: 'The registered deed or the registration certificate.',
  },
}

export const REGISTRATION_DOCS = ['udyam', 'shop_est', 'coi', 'llp_cert', 'partnership_deed', 'trust_reg']

/** The registration proofs that suit a business type, the likeliest first. */
export const registrationDocsFor = (entity: EntityType | null | undefined) =>
  REGISTRATION_DOCS.filter(d => !entity || KYB_DOCS[d].entities?.includes(entity))

/** Why a typed registration number isn't acceptable, or null. Only an unregistered firm's partnership deed has none. */
export function docNumberProblem(docType: string, number: string | null | undefined): string | null {
  const d = KYB_DOCS[docType]
  const n = String(number ?? '').trim()
  if (!d?.numberLabel) return null
  if (!n) return docType === 'partnership_deed' ? null : `Enter the ${d.numberLabel}.`
  if (n.length < 3) return `Check the ${d.numberLabel}.`
  return d.check?.(n).problem ?? null
}

export const formatDocNumber = (docType: string, number: string) => KYB_DOCS[docType]?.format?.(number) ?? number.trim().toUpperCase()

// ── Messaging use ──

export const MESSAGING_POLICY_VERSION = '2026-11'

export const MESSAGING_PURPOSES = [
  { id: 'otp', label: 'Sign-in and verification codes' },
  { id: 'transactional', label: 'Order, booking and payment updates' },
  { id: 'support', label: 'Replies to customers who wrote to you' },
  { id: 'marketing', label: 'Offers and promotions to people who opted in' },
] as const

export const MESSAGING_VOLUMES = [
  { id: 'lt_1k', label: 'Under 1,000 a month' },
  { id: '1k_10k', label: '1,000 to 10,000 a month' },
  { id: '10k_100k', label: '10,000 to 1 lakh a month' },
  { id: 'gt_100k', label: 'Over 1 lakh a month' },
] as const

export interface MessagingUse {
  purposes: string[]
  volume: string
  /** How recipients agree to hear from the business. */
  optIn: string
  /** One message the business will send. */
  sample: string
  policyVersion: string
  acceptedAt: string
}

export function messagingUseProblem(u: Partial<MessagingUse> | null | undefined): string | null {
  if (!u) return 'Tell us how you will message people.'
  if (!u.purposes?.length || !u.purposes.every(p => MESSAGING_PURPOSES.some(x => x.id === p))) return 'Pick what you will send.'
  if (!MESSAGING_VOLUMES.some(v => v.id === u.volume)) return 'Pick how many messages you expect to send.'
  if (String(u.optIn ?? '').trim().length < 15) return 'Describe how people agree to receive your messages.'
  if (String(u.sample ?? '').trim().length < 10) return 'Add one message you will send.'
  if (u.policyVersion !== MESSAGING_POLICY_VERSION || !u.acceptedAt) return 'Accept the messaging policy.'
  return null
}

export function websiteProblem(url: string | null | undefined): string | null {
  const u = String(url ?? '').trim()
  if (!u) return 'Add the website or page where your business presents itself.'
  try {
    const p = new URL(u)
    if ((p.protocol !== 'https:' && p.protocol !== 'http:') || !p.hostname.includes('.')) throw new Error()
  } catch {
    return 'Enter the full address, like https://yourbusiness.in.'
  }
  return null
}

// ── Where a business stands ──

/** The tenant_kyc fields the rules read. */
export interface KybProfile {
  status: string
  business_name: string | null
  trade_name: string | null
  entity_type: string | null
  business_type: string | null
  pan: string | null
  gst_number: string | null
  gst_registered: boolean | null
  gst_exempt_reason: string | null
  address_line: string | null
  address_city: string | null
  address_state: string | null
  address_pincode: string | null
  authorized_name: string | null
  website: string | null
  messaging_use: Partial<MessagingUse> | null
}

export interface KybDoc {
  id: string
  doc_type: string
  doc_number: string | null
  expires_on: string | null
  status: string
  review_note: string | null
  analysis: DocAnalysis | null
  analysis_status: string | null
  owner_note: string | null
}

/** missing/invalid/rejected: the owner has to act; checking: wait; review/complete: done, for Jeffi to look at; approved: verified. */
export type ItemState = 'missing' | 'invalid' | 'checking' | 'review' | 'complete' | 'approved' | 'rejected' | 'not_needed'

export interface ItemStatus {
  state: ItemState
  problem?: string
  /** The document the item rests on, when it has one. */
  docType?: string
}

export interface KybFacts {
  profile: KybProfile | null
  docs: KybDoc[]
  /** The owner has a payout account that passed the penny-drop. */
  bankVerified: boolean
  /** The store's licences: action (rejected or lapsed), fine, or null when it has no store. */
  licences: 'action' | 'ok' | null
}

export interface ServiceStatus {
  required: KybItem[]
  /** Everything the owner has to do is done: Jeffi can review and switch the service on. */
  ready: boolean
  /** Everything is verified, by the checks and by Jeffi. */
  verified: boolean
  /** Items the owner still has to complete or fix. */
  todo: KybItem[]
}

export interface KybEvaluation {
  items: Record<KybItem, ItemStatus>
  services: Record<KybService, ServiceStatus>
}

const DONE: ItemState[] = ['review', 'complete', 'approved', 'not_needed']
const VERIFIED: ItemState[] = ['complete', 'approved', 'not_needed']

export const entityOf = (p: KybProfile | null): EntityType | null => {
  const e = p?.entity_type ?? p?.business_type
  return isEntityType(e) ? e : null
}

/** The first thing a document's automatic check found wrong, in the owner's words. */
export function analysisProblem(a: DocAnalysis | null): string | undefined {
  if (!a) return undefined
  const bad = a.checks.find(c => c.status === 'fail') ?? a.checks.find(c => c.status === 'missing')
  return bad?.message
}

function docState(doc: KybDoc | undefined, label: string, approvedKyc: boolean): ItemStatus {
  if (!doc) return { state: 'missing', problem: `Upload your ${label}.` }
  const at = { docType: doc.doc_type }
  if (doc.status === 'rejected') return { ...at, state: 'rejected', problem: doc.review_note || `Jeffi couldn’t accept this ${label}. Upload it again.` }
  if (doc.status === 'expired') return { ...at, state: 'invalid', problem: `Your ${label} has expired. Upload the renewed one.` }
  if (doc.status === 'approved') return { ...at, state: 'approved' }
  if (doc.analysis_status === 'pending') return { ...at, state: 'checking' }
  const v = doc.analysis?.verdict
  if ((v === 'mismatch' || v === 'unreadable') && !doc.owner_note)
    return { ...at, state: 'invalid', problem: analysisProblem(doc.analysis) ?? `Check your ${label}.` }
  return { ...at, state: approvedKyc && v === 'verified' ? 'approved' : 'review' }
}

export function evaluateKyb(f: KybFacts): KybEvaluation {
  const p = f.profile
  const entity = entityOf(p)
  const approved = p?.status === 'approved'
  const docs = new Map(f.docs.map(d => [d.doc_type, d]))
  const settled = (s: ItemStatus): ItemStatus => (approved && s.state === 'complete' ? { ...s, state: 'approved' } : s)

  const profile = ((): ItemStatus => {
    if (!p) return { state: 'missing', problem: 'Add your business details.' }
    const gaps = [
      !p.business_name?.trim() && 'legal name',
      !entity && 'business type',
      !p.address_line?.trim() && 'address',
      !p.address_city?.trim() && 'city',
      !p.address_state?.trim() && 'state',
      !p.address_pincode?.trim() && 'PIN code',
      !p.authorized_name?.trim() && 'authorised signatory',
    ].filter(Boolean)
    if (gaps.length) return { state: 'missing', problem: `Add your ${gaps.join(', ')}.` }
    if (!/^[1-9][0-9]{5}$/.test(p.address_pincode!.trim())) return { state: 'invalid', problem: 'Enter the 6-digit PIN code.' }
    return settled({ state: 'complete' })
  })()

  const pan = ((): ItemStatus => {
    if (!p?.pan) return { state: 'missing', problem: 'Enter your PAN.' }
    const c = checkPan(p.pan, entity)
    if (!c.ok) return { state: 'invalid', problem: c.problem }
    return docState(docs.get('pan_card'), 'PAN card', approved)
  })()

  const gst = ((): ItemStatus => {
    if (p?.gst_registered == null) return { state: 'missing', problem: 'Tell us whether the business is registered for GST.' }
    if (p.gst_registered === false) return p.gst_exempt_reason ? settled({ state: 'complete' }) : { state: 'missing', problem: 'Tell us why the business isn’t registered for GST.' }
    if (!p.gst_number) return { state: 'missing', problem: 'Enter your GSTIN.' }
    const c = checkGstin(p.gst_number, { pan: p.pan, state: p.address_state })
    if (!c.ok) return { state: 'invalid', problem: c.problem }
    return docState(docs.get('gst_cert'), 'GST certificate', approved)
  })()

  const registration = ((): ItemStatus => {
    const options = registrationDocsFor(entity)
    const doc = options.map(d => docs.get(d)).find(Boolean)
    if (p?.gst_registered !== false) return doc ? docState(doc, KYB_DOCS[doc.doc_type].label, approved) : { state: 'not_needed' }
    if (!doc) return { state: 'missing', problem: `Without GST, upload a registration proof: ${options.map(d => KYB_DOCS[d].label).join(', or ')}.` }
    const n = docNumberProblem(doc.doc_type, doc.doc_number)
    if (n) return { state: 'invalid', problem: n, docType: doc.doc_type }
    return docState(doc, KYB_DOCS[doc.doc_type].label, approved)
  })()

  const website = ((): ItemStatus => {
    const w = websiteProblem(p?.website)
    return w ? { state: 'missing', problem: w } : settled({ state: 'complete' })
  })()

  const messagingUse = ((): ItemStatus => {
    const m = messagingUseProblem(p?.messaging_use)
    return m ? { state: 'missing', problem: m } : settled({ state: 'complete' })
  })()

  const bank: ItemStatus = f.bankVerified ? { state: 'complete' } : { state: 'missing', problem: 'Add and verify the bank account payouts go to.' }
  const licences: ItemStatus =
    f.licences === 'action' ? { state: 'invalid', problem: 'A licence was rejected or has expired. Upload the current one.' } : f.licences === 'ok' ? { state: 'complete' } : { state: 'not_needed' }

  const items: Record<KybItem, ItemStatus> = { profile, pan, gst, registration, website, messaging_use: messagingUse, bank, licences }
  const services = Object.fromEntries(
    (Object.keys(SERVICE_ITEMS) as KybService[]).map(s => {
      const required = SERVICE_ITEMS[s]
      const todo = required.filter(i => !DONE.includes(items[i].state))
      return [s, { required, ready: todo.length === 0, verified: required.every(i => VERIFIED.includes(items[i].state)), todo }]
    })
  ) as Record<KybService, ServiceStatus>
  return { items, services }
}
