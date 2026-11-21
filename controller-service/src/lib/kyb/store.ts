import { controlPlanePool, type TenantKyc } from '@/lib/tenant-registry'
import type { DocAnalysis } from './extract'
import { kycBusinessType, type EntityType } from './ids'
import { KYB_CATEGORY, type KybDoc, type KybProfile, type MessagingUse } from './requirements'

// KYB lives on the store's tenant_kyc row (the profile) and in tenant_compliance_documents (category KYB). One row
// per document type: sending one again replaces the file and puts it back to review and to the automatic check.

export type KybRecord = TenantKyc & KybProfile & {
  address_line: string | null
  authorized_designation: string | null
  gst_exempt_note: string | null
}

export async function getKybRecord(tenantId: string): Promise<KybRecord | null> {
  const r = await controlPlanePool().query<KybRecord>(`SELECT * FROM tenant_kyc WHERE tenant_id = $1`, [tenantId])
  return r.rows[0] ?? null
}

export interface KybProfileInput {
  legalName?: string
  tradeName?: string | null
  entityType?: EntityType
  addressLine?: string
  city?: string
  state?: string
  pincode?: string
  authorizedName?: string
  authorizedDesignation?: string | null
  mobile?: string | null
  pan?: string
  gstRegistered?: boolean
  gstin?: string | null
  gstExemptReason?: string | null
  gstExemptNote?: string | null
  website?: string | null
  messagingUse?: MessagingUse | null
}

/** The fields an approved business can't change itself: they are what Jeffi verified. */
export const LOCKED_WHEN_APPROVED: (keyof KybProfileInput)[] = ['legalName', 'entityType', 'pan', 'gstRegistered', 'gstin']

const COLUMN: Partial<Record<keyof KybProfileInput, string>> = {
  legalName: 'business_name',
  tradeName: 'trade_name',
  entityType: 'entity_type',
  addressLine: 'address_line',
  city: 'address_city',
  state: 'address_state',
  pincode: 'address_pincode',
  authorizedName: 'authorized_name',
  authorizedDesignation: 'authorized_designation',
  mobile: 'mobile',
  pan: 'pan',
  gstRegistered: 'gst_registered',
  gstin: 'gst_number',
  gstExemptReason: 'gst_exempt_reason',
  gstExemptNote: 'gst_exempt_note',
  website: 'website',
  messagingUse: 'messaging_use',
}

/**
 * Saves the fields given (others stay as they are), creating the store's KYC row on first use (a showcase workspace
 * has none). business_type follows the entity type, and business_address is rebuilt from the address parts, so the
 * places that read them (invoices, Razorpay, the KYC tab) see the KYB answers.
 */
export async function saveKybProfile(tenantId: string, ownerId: string, input: KybProfileInput): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = [tenantId]
  const put = (col: string, v: unknown) => {
    vals.push(v)
    sets.push(`${col} = $${vals.length}`)
  }
  for (const [k, col] of Object.entries(COLUMN) as [keyof KybProfileInput, string][]) {
    if (!(k in input)) continue
    const v = input[k]
    put(col, k === 'messagingUse' ? (v ? JSON.stringify(v) : null) : typeof v === 'string' ? v.trim() || null : (v ?? null))
  }
  if (input.entityType) put('business_type', kycBusinessType(input.entityType))
  if (input.gstRegistered === false) put('gst_number', null)
  if (input.gstRegistered === true) {
    put('gst_exempt_reason', null)
    put('gst_exempt_note', null)
  }
  if (!sets.length) return
  const pool = controlPlanePool()
  await pool.query(`INSERT INTO tenant_kyc (tenant_id, owner_id) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, ownerId])
  await pool.query(`UPDATE tenant_kyc SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1`, vals)
  await pool.query(
    `UPDATE tenant_kyc SET business_address = concat_ws(', ', address_line, address_city, nullif(trim(concat_ws(' ', address_state, address_pincode)), ''))
      WHERE tenant_id = $1 AND address_line IS NOT NULL AND address_city IS NOT NULL`,
    [tenantId]
  )
}

// ── Documents ──

export type KybDocRow = KybDoc & {
  owner_id: string
  tenant_id: string
  category: string
  s3_key: string
  file_name: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  analyzed_at: string | null
  created_at: string
}

const DOC_COLS = `id, owner_id, tenant_id, category, doc_type, doc_number, to_char(expires_on, 'YYYY-MM-DD') AS expires_on, s3_key, file_name,
  status, review_note, reviewed_by, reviewed_at, created_at, analysis, analysis_status, analyzed_at, owner_note`

export async function listKybDocuments(tenantId: string): Promise<KybDocRow[]> {
  const r = await controlPlanePool().query<KybDocRow>(
    `SELECT ${DOC_COLS} FROM tenant_compliance_documents WHERE tenant_id = $1 AND category = $2 ORDER BY created_at`,
    [tenantId, KYB_CATEGORY]
  )
  return r.rows
}

/** Every document on file for the store, KYB and licences alike (the admin's re-check runs over all of them). */
export async function listAllDocuments(tenantId: string): Promise<KybDocRow[]> {
  const r = await controlPlanePool().query<KybDocRow>(`SELECT ${DOC_COLS} FROM tenant_compliance_documents WHERE tenant_id = $1 ORDER BY created_at`, [tenantId])
  return r.rows
}

export async function getDocument(tenantId: string, id: string): Promise<KybDocRow | null> {
  const r = await controlPlanePool().query<KybDocRow>(`SELECT ${DOC_COLS} FROM tenant_compliance_documents WHERE tenant_id = $1 AND id = $2`, [tenantId, id])
  return r.rows[0] ?? null
}

/** A new or replaced KYB document: back to review, its check pending. */
export async function upsertKybDocument(
  tenantId: string,
  ownerId: string,
  d: { docType: string; number: string | null; expiresOn: string | null; s3Key: string; fileName: string | null }
): Promise<KybDocRow> {
  const r = await controlPlanePool().query<KybDocRow>(
    `INSERT INTO tenant_compliance_documents (owner_id, tenant_id, category, doc_type, doc_number, expires_on, s3_key, file_name, analysis_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET
       owner_id = EXCLUDED.owner_id, category = EXCLUDED.category, doc_number = EXCLUDED.doc_number, expires_on = EXCLUDED.expires_on,
       s3_key = EXCLUDED.s3_key, file_name = EXCLUDED.file_name, status = 'pending', review_note = NULL, reviewed_at = NULL,
       reviewed_by = NULL, created_at = now(), analysis = NULL, analysis_status = 'pending', analyzed_at = NULL, owner_note = NULL,
       expiry_notice = NULL, expiry_notice_for = NULL
     RETURNING ${DOC_COLS}`,
    [ownerId, tenantId, KYB_CATEGORY, d.docType, d.number?.slice(0, 64) || null, d.expiresOn || null, d.s3Key, d.fileName?.slice(0, 255) || null]
  )
  return r.rows[0]
}

/** Drops a KYB document the business no longer needs (a registration proof once GST is added). */
export async function deleteKybDocument(tenantId: string, docType: string): Promise<boolean> {
  const r = await controlPlanePool().query(`DELETE FROM tenant_compliance_documents WHERE tenant_id = $1 AND doc_type = $2 AND category = $3 AND status <> 'approved'`, [
    tenantId,
    docType,
    KYB_CATEGORY,
  ])
  return (r.rowCount ?? 0) > 0
}

export async function markAnalysisPending(tenantId: string, id: string): Promise<void> {
  await controlPlanePool().query(`UPDATE tenant_compliance_documents SET analysis_status = 'pending' WHERE tenant_id = $1 AND id = $2`, [tenantId, id])
}

/** Stores a check's result, unless the file was replaced while it ran (that copy gets its own check). */
export async function saveAnalysis(tenantId: string, id: string, s3Key: string, status: 'done' | 'failed', analysis: DocAnalysis | null): Promise<boolean> {
  const r = await controlPlanePool().query(
    `UPDATE tenant_compliance_documents SET analysis = $4, analysis_status = $5, analyzed_at = now()
      WHERE tenant_id = $1 AND id = $2 AND s3_key = $3`,
    [tenantId, id, s3Key, analysis ? JSON.stringify(analysis) : null, status]
  )
  return (r.rowCount ?? 0) > 0
}

/** The owner's word on a document whose check didn't match: it goes to a reviewer as it is. */
export async function setOwnerNote(tenantId: string, docType: string, note: string | null): Promise<KybDocRow | null> {
  const r = await controlPlanePool().query<KybDocRow>(
    `UPDATE tenant_compliance_documents SET owner_note = $3 WHERE tenant_id = $1 AND doc_type = $2 AND status IN ('pending', 'rejected') RETURNING ${DOC_COLS}`,
    [tenantId, docType, note?.trim().slice(0, 1000) || null]
  )
  return r.rows[0] ?? null
}

/** The KYC row's own pointer to the GST certificate (the KYC tab and older readers use it) follows the KYB upload. */
export async function setGstCertKey(tenantId: string, s3Key: string): Promise<void> {
  await controlPlanePool().query(`UPDATE tenant_kyc SET gst_cert_s3_key = $2, updated_at = now() WHERE tenant_id = $1`, [tenantId, s3Key])
}
