import 'server-only'
import { hasVerifiedBank, listServiceApprovals, type ServiceApproval } from '@/lib/tenant-registry'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { complianceStanding } from '@controller/lib/catalog/compliance'
import { listComplianceDocuments } from '@controller/lib/catalog/compliance-docs'
import { analysisCurrent } from './analyze'
import type { DocAnalysis } from './extract'
import {
  evaluateKyb,
  KYB_DOCS,
  type ItemStatus,
  type KybItem,
  type KybProfile,
  type KybService,
  type MessagingUse,
  type ServiceStatus,
} from './requirements'
import { getKybRecord, listKybDocuments, LOCKED_WHEN_APPROVED, type KybDocRow, type KybRecord } from './store'

// One business's KYB as the console and the admin show it: its answers, its documents with their checks, and where
// each service stands. Built from the database on every request; nothing here is cached.

export interface KybDocView {
  id: string
  docType: string
  label: string
  number: string | null
  expiresOn: string | null
  fileName: string | null
  uploadedAt: string
  /** pending (with Jeffi), approved, rejected, expired */
  status: string
  reviewNote: string | null
  ownerNote: string | null
  /** pending while being checked; failed when the file couldn't be read (a reviewer looks instead). */
  analysisStatus: string | null
  analysis: DocAnalysis | null
  /** False when the business's answers changed after the check: it runs again. */
  current: boolean
}

export interface KybView {
  tenantId: string
  status: string | null
  reviewerNote: string | null
  profile: {
    legalName: string | null
    tradeName: string | null
    entityType: string | null
    addressLine: string | null
    city: string | null
    state: string | null
    pincode: string | null
    authorizedName: string | null
    authorizedDesignation: string | null
    mobile: string | null
    pan: string | null
    gstRegistered: boolean | null
    gstin: string | null
    gstExemptReason: string | null
    gstExemptNote: string | null
    website: string | null
    messagingUse: Partial<MessagingUse> | null
  }
  /** Fields the owner can't change any more (Jeffi verified them); support changes them. */
  locked: string[]
  docs: KybDocView[]
  items: Record<KybItem, ItemStatus>
  services: Record<KybService, ServiceStatus & { active: boolean; approval: ServiceApproval['status'] | null }>
}

export function docView(d: KybDocRow, kyc: KybRecord | null): KybDocView {
  return {
    id: d.id,
    docType: d.doc_type,
    label: KYB_DOCS[d.doc_type]?.label ?? d.doc_type,
    number: d.doc_number,
    expiresOn: d.expires_on,
    fileName: d.file_name,
    uploadedAt: d.created_at,
    status: d.status,
    reviewNote: d.review_note,
    ownerNote: d.owner_note,
    analysisStatus: d.analysis_status,
    analysis: d.analysis,
    current: analysisCurrent(d, kyc),
  }
}

/**
 * The KYB answers with what an older application already said filled in: a store onboarded before KYB gave its GSTIN
 * (so it is registered), its business type and a one-line address with a PIN code (which gives the state).
 */
export function normalizedProfile(kyc: KybRecord | null): (KybProfile & KybRecord) | null {
  if (!kyc) return null
  const structured = !!(kyc.address_line || kyc.address_city || kyc.address_state || kyc.address_pincode)
  const pin = kyc.address_pincode ?? kyc.business_address?.match(/\b[1-9][0-9]{5}\b/)?.[0] ?? null
  return {
    ...kyc,
    entity_type: kyc.entity_type ?? (kyc.business_type && kyc.business_type !== 'other' ? kyc.business_type : null),
    gst_registered: kyc.gst_registered ?? (kyc.gst_number ? true : null),
    address_line: kyc.address_line ?? (structured ? null : kyc.business_address),
    address_pincode: pin,
    address_state: kyc.address_state ?? stateFromPincode(pin),
  }
}

export async function loadKybView(tenant: { id: string; service_types: string[] | null }, ownerId: string): Promise<KybView> {
  const [kyc, docs, bankVerified, approvals, licenceDocs] = await Promise.all([
    getKybRecord(tenant.id),
    listKybDocuments(tenant.id),
    hasVerifiedBank(ownerId).catch(() => false),
    listServiceApprovals(tenant.id).catch(() => [] as ServiceApproval[]),
    listComplianceDocuments(tenant.id).catch(() => []),
  ])
  const types = tenant.service_types ?? ['store']
  const standing = complianceStanding(licenceDocs)
  const p = normalizedProfile(kyc)
  const evaluation = evaluateKyb({
    profile: p,
    docs,
    bankVerified,
    licences: types.includes('store') ? (standing === 'action' ? 'action' : 'ok') : null,
  })
  const services = Object.fromEntries(
    (Object.keys(evaluation.services) as KybService[]).map(s => [
      s,
      { ...evaluation.services[s], active: types.includes(s), approval: approvals.find(a => a.service === s)?.status ?? null },
    ])
  ) as KybView['services']
  return {
    tenantId: tenant.id,
    status: kyc?.status ?? null,
    reviewerNote: kyc?.reviewer_note ?? null,
    profile: {
      legalName: p?.business_name ?? null,
      tradeName: p?.trade_name ?? null,
      entityType: p?.entity_type ?? null,
      addressLine: p?.address_line ?? null,
      city: p?.address_city ?? null,
      state: p?.address_state ?? null,
      pincode: p?.address_pincode ?? null,
      authorizedName: p?.authorized_name ?? null,
      authorizedDesignation: p?.authorized_designation ?? null,
      mobile: p?.mobile ?? null,
      pan: p?.pan ?? null,
      gstRegistered: p?.gst_registered ?? null,
      gstin: p?.gst_number ?? null,
      gstExemptReason: p?.gst_exempt_reason ?? null,
      gstExemptNote: p?.gst_exempt_note ?? null,
      website: p?.website ?? null,
      messagingUse: p?.messaging_use ?? null,
    },
    locked: kyc?.status === 'approved' ? [...LOCKED_WHEN_APPROVED] : [],
    docs: docs.map(d => docView(d, kyc)),
    items: evaluation.items,
    services,
  }
}

/** Where one service stands for a tenant, for the gates that switch services on. */
export async function serviceReadiness(tenant: { id: string; service_types: string[] | null }, ownerId: string, service: KybService) {
  const v = await loadKybView(tenant, ownerId)
  return { ...v.services[service], items: v.items }
}
