// The store wizard's KYB answers (Business and GST steps) as its draft keeps them, what each uploaded document is checked
// against, and what keeps either step from complete. Pure: the wizard and /api/ecom/onboard/kyb-check share it.
import { getStateCode } from '@/lib/catalog/gst'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { isIsoDate, todayIst } from '@controller/lib/catalog/compliance'
import { isGstin, isPan } from '@controller/lib/catalog/tax-ids'
import type { DocAnalysis, Expected } from '@controller/lib/kyb/extract'
import { checkGstin, checkPan, idChars, isEntityType, kycBusinessType, type EntityType } from '@controller/lib/kyb/ids'
import {
  KYB_DOCS,
  REGISTRATION_DOCS,
  canonicalState,
  docNumberProblem,
  formatDocNumber,
  isGstExemptReason,
  registrationDocsFor,
  type GstExemptReason,
} from '@controller/lib/kyb/requirements'

export const isKybDoc = (t: unknown): t is string => typeof t === 'string' && Object.prototype.hasOwnProperty.call(KYB_DOCS, t)

/** A KYB document in the wizard: the file (none yet when only its number is typed) and what its check found. */
export interface KybUpload {
  s3Key: string
  fileName: string
  number?: string
  expiresOn?: string
  /** The wizard's check; null when the file couldn't be read. */
  analysis?: DocAnalysis | null
  /** "I've checked this" on a document whose check didn't match, and why: its owner_note at submit. */
  ack?: boolean
  note?: string
  /** A document already on the store's record (a services workspace adding a store): its review status. */
  status?: string
}

export type KybState = {
  bizName: string
  /** Null until set: the Business step starts it from the store's name, once. */
  tradeName: string | null
  entityType: EntityType | ''
  pan: string
  addrLine: string
  addrCity: string
  addrState: string
  addrPin: string
  signatoryName: string
  signatoryDesignation: string
  gstRegistered: boolean | null
  gstNumber: string
  gstExemptReason: GstExemptReason | ''
  gstExemptNote: string
  /** The registration proof picked, for a business without GST. */
  regDocType: string
  kybDocs: Record<string, KybUpload>
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const PIN = /^[1-9][0-9]{5}$/

/** The answers with one document changed (started when it has no entry yet). */
export const patchDoc = (k: KybState, docType: string, patch: Partial<KybUpload>): KybState => ({
  ...k,
  kybDocs: { ...k.kybDocs, [docType]: { s3Key: '', fileName: '', ...(k.kybDocs[docType] as KybUpload | undefined), ...patch } },
})

/**
 * The answers from a draft. One from before KYB has a one-line address (only its PIN code is taken, the rest is asked
 * again), five business types ('other' is asked again) and a GST certificate uploaded with the licences.
 */
export function initialKyb(init: Record<string, any>): KybState {
  const legacyType = str(init.bizType)
  const addrPin = str(init.addrPin) || (str(init.bizAddress).match(/\b[1-9][0-9]{5}\b/)?.[0] ?? '')
  const docs: Record<string, KybUpload> = {}
  for (const [t, v] of Object.entries((init.kybDocs ?? {}) as Record<string, unknown>))
    if (isKybDoc(t) && v && typeof v === 'object') docs[t] = { ...(v as KybUpload), s3Key: str((v as KybUpload).s3Key), fileName: str((v as KybUpload).fileName) }
  if (!docs.gst_cert?.s3Key && str(init.gstS3Key)) docs.gst_cert = { s3Key: init.gstS3Key, fileName: str(init.gstFilename) }
  const gstNumber = str(init.gstNumber)
  return {
    bizName: str(init.bizName),
    tradeName: typeof init.tradeName === 'string' ? init.tradeName : null,
    entityType: isEntityType(init.entityType) ? init.entityType : isEntityType(legacyType) && legacyType !== 'other' ? legacyType : '',
    pan: str(init.pan),
    addrLine: str(init.addrLine),
    addrCity: str(init.addrCity),
    addrState: canonicalState(str(init.addrState)) || stateFromPincode(addrPin) || '',
    addrPin,
    signatoryName: str(init.signatoryName),
    signatoryDesignation: str(init.signatoryDesignation),
    gstRegistered: typeof init.gstRegistered === 'boolean' ? init.gstRegistered : gstNumber ? true : null,
    gstNumber,
    gstExemptReason: isGstExemptReason(init.gstExemptReason) ? init.gstExemptReason : '',
    gstExemptNote: str(init.gstExemptNote),
    regDocType: isKybDoc(init.regDocType) ? init.regDocType : (REGISTRATION_DOCS.find(d => docs[d]?.s3Key) ?? ''),
    kybDocs: docs,
  }
}

/** On entering the Business step: what earlier steps said fills the fields still empty. */
export function prefillBusiness(k: KybState, from: { storeName: string; ownerName: string; address: { address: string; city: string; state: string; pincode: string } }): KybState {
  const a = from.address
  const noAddress = !k.addrLine && !k.addrCity && !k.addrState && !k.addrPin
  return {
    ...k,
    tradeName: k.tradeName ?? from.storeName.trim(),
    signatoryName: k.signatoryName || from.ownerName.trim(),
    ...(noAddress && a.address.trim()
      ? { addrLine: a.address.trim(), addrCity: a.city.trim(), addrState: canonicalState(a.state) || stateFromPincode(a.pincode) || '', addrPin: PIN.test(a.pincode) ? a.pincode : '' }
      : {}),
  }
}

/** The one-line address (tenant_kyc.business_address) as saveKybProfile rebuilds it from the parts. */
export const composeAddress = (k: Pick<KybState, 'addrLine' | 'addrCity' | 'addrState' | 'addrPin'>) =>
  [k.addrLine.trim(), k.addrCity.trim(), [k.addrState.trim(), k.addrPin.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ')

export type KybAnswers = Partial<Pick<KybState, 'bizName' | 'tradeName' | 'entityType' | 'pan' | 'gstNumber' | 'signatoryName'>>

/**
 * What a document should say, from the wizard's answers (or the draft they were saved to): lib/kyb/analyze.ts
 * expectedFor, before there is a store record. A proprietorship's PAN card is in the proprietor's own name.
 */
export function kybExpected(docType: string, a: KybAnswers, doc: { number?: string | null; expiresOn?: string | null } = {}): Expected {
  const legal = str(a.bizName).trim() || null
  const trade = str(a.tradeName).trim() || null
  const signatory = str(a.signatoryName).trim() || null
  const entity = isEntityType(a.entityType) ? a.entityType : null
  if (docType === 'pan_card') {
    const pan = idChars(str(a.pan), 10)
    return { number: isPan(pan) ? pan : null, names: entity === 'proprietor' ? [signatory, legal] : [legal, trade], entity }
  }
  if (docType === 'gst_cert') {
    const gstin = idChars(str(a.gstNumber), 15)
    return { number: isGstin(gstin) ? gstin : null, names: [legal, trade], entity }
  }
  const n = String(doc.number ?? '').trim()
  return { number: n ? formatDocNumber(docType, n) : null, names: [legal, trade, ...(entity === 'proprietor' ? [signatory] : [])], expiresOn: doc.expiresOn || null, entity }
}

/** Equal when a check against one expectation holds for the other (as analysisCurrent compares them). */
export const expectedKey = (e: Expected | null | undefined) =>
  JSON.stringify([idChars(e?.number), (e?.names ?? []).map(n => String(n ?? '').trim()).filter(Boolean), e?.expiresOn || null, e?.entity || null])

/** Whether a document's check compared it with the answers as they are now. */
export function checkCurrent(docType: string, k: KybState): boolean {
  const u = k.kybDocs[docType]
  if (!u?.analysis) return true
  return u.analysis.docType === docType && expectedKey(u.analysis.expected) === expectedKey(kybExpected(docType, k, u))
}

/** Why a document can't be checked yet: the answer it is compared with is missing or invalid. */
export function checkBlocked(docType: string, k: KybState, u: KybUpload | undefined = k.kybDocs[docType]): string | null {
  if (!k.bizName.trim()) return 'Enter the legal name of the business, then check this.'
  if (docType === 'pan_card') return checkPan(k.pan, k.entityType || null).ok ? null : 'Enter a valid PAN and the card is checked against it.'
  if (docType === 'gst_cert') return checkGstin(k.gstNumber, { pan: k.pan, state: k.addrState }).ok ? null : 'Enter a valid GSTIN and the certificate is checked against it.'
  return docNumberProblem(docType, u?.number)
}

const LABEL: Record<string, string> = { pan_card: 'PAN card', gst_cert: 'GST certificate' }
export const docLabel = (t: string) => LABEL[t] ?? KYB_DOCS[t]?.label ?? t

/** A check that didn't match, or couldn't find the number: the owner explains it or fixes it. */
export const needsNote = (u: KybUpload | undefined) => u?.analysis?.verdict === 'mismatch' || u?.analysis?.verdict === 'unreadable'
const noted = (u: KybUpload) => !!u.ack && (u.note ?? '').trim().length >= 10

/** What keeps a document from done: not uploaded, refused, checked against older answers, or a mismatch unexplained. */
export function docIssue(docType: string, k: KybState): string | null {
  const u = k.kybDocs[docType]
  const label = docLabel(docType)
  if (!u?.s3Key) return `Upload your ${label}.`
  if (u.status === 'approved') return null
  if (u.status === 'rejected') return `Jeffi couldn’t accept your ${label}. Upload it again.`
  if (u.status === 'expired') return `Your ${label} has expired. Upload the renewed one.`
  if (!u.analysis) return null
  if (!checkCurrent(docType, k)) return `You changed your details after your ${label} was checked. Check it again.`
  if (needsNote(u) && !noted(u)) return `Your ${label} didn’t match. Fix the details, upload a clearer copy, or tick “I’ve checked this” and explain.`
  return null
}

/** The first thing keeping the Business step from complete, in the order it shows them. */
export function businessIssue(k: KybState): string | null {
  if (k.bizName.trim().length < 2) return 'Enter the legal name of the business.'
  if (!k.entityType) return 'Pick the business type.'
  if (k.addrLine.trim().length < 3) return 'Enter the business address.'
  if (k.addrCity.trim().length < 2) return 'Enter the city.'
  if (!getStateCode(k.addrState)) return 'Pick the state.'
  if (!PIN.test(k.addrPin)) return 'Enter the 6-digit PIN code.'
  if (k.signatoryName.trim().length < 2) return 'Enter who signs for the business.'
  if (k.signatoryDesignation.trim().length < 2) return 'Enter the signatory’s designation.'
  const pan = checkPan(k.pan, k.entityType)
  if (!pan.ok) return pan.problem ?? 'Check the PAN.'
  return docIssue('pan_card', k)
}

/** The first thing keeping the GST step from complete. */
export function gstIssue(k: KybState): string | null {
  if (k.gstRegistered === null) return 'Tell us whether the business is registered for GST.'
  if (k.gstRegistered) {
    const g = checkGstin(k.gstNumber, { pan: k.pan, state: k.addrState })
    if (!g.ok) return g.problem ?? 'Check the GSTIN.'
    return docIssue('gst_cert', k)
  }
  if (!k.gstExemptReason) return 'Tell us why the business isn’t registered for GST.'
  if (k.gstExemptReason === 'other' && k.gstExemptNote.trim().length < 10) return 'Tell us in a sentence why the business isn’t registered.'
  if (!registrationDocsFor(k.entityType || null).includes(k.regDocType)) return 'Pick a registration proof.'
  const u = k.kybDocs[k.regDocType]
  const n = docNumberProblem(k.regDocType, u?.number)
  if (n) return n
  if (u?.expiresOn && (!isIsoDate(u.expiresOn) || u.expiresOn < todayIst())) return 'Enter an expiry date that hasn’t passed.'
  return docIssue(k.regDocType, k)
}

/** What submit sends for the Business and GST steps (lib/catalog/onboard-schema.ts). */
export function kybPayload(k: KybState) {
  const docs: Record<string, { s3Key: string; fileName?: string; number?: string; expiresOn?: string; ownerNote?: string }> = {}
  const put = (t: string) => {
    const u = k.kybDocs[t]
    if (!u?.s3Key) return
    docs[t] = {
      s3Key: u.s3Key,
      fileName: u.fileName || undefined,
      number: u.number?.trim() || undefined,
      expiresOn: u.expiresOn || undefined,
      ownerNote: needsNote(u) && u.ack ? u.note?.trim() || undefined : undefined,
    }
  }
  put('pan_card')
  if (k.gstRegistered) put('gst_cert')
  else if (k.regDocType) put(k.regDocType)
  return {
    businessName: k.bizName.trim(),
    businessType: k.entityType ? kycBusinessType(k.entityType) : undefined,
    entityType: k.entityType || undefined,
    tradeName: k.tradeName?.trim() || undefined,
    pan: k.pan,
    businessAddress: composeAddress(k),
    addressLine: k.addrLine.trim(),
    city: k.addrCity.trim(),
    state: k.addrState,
    pincode: k.addrPin,
    authorizedName: k.signatoryName.trim(),
    authorizedDesignation: k.signatoryDesignation.trim(),
    gstRegistered: k.gstRegistered,
    gstNumber: k.gstRegistered ? k.gstNumber : '',
    gstExemptReason: k.gstRegistered ? undefined : k.gstExemptReason || undefined,
    gstExemptNote: k.gstRegistered ? undefined : k.gstExemptNote.trim() || undefined,
    kybDocs: docs,
  }
}
