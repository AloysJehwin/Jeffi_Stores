import { controlPlanePool } from '@/lib/tenant-registry'
import { complianceStanding, todayIst, type DocStatus } from './compliance'

// The licences and certificates a store keeps on file (tenant_compliance_documents): sent with its application, or later
// from the console's Licences & certificates page. The platform admin reviews each one, or every pending one with the
// KYC; the daily compliance_expiry job marks lapsed ones expired. What each doc_type is: lib/catalog/compliance.ts.

export interface ComplianceDocumentRow {
  id: string
  owner_id: string
  tenant_id: string
  category: string
  doc_type: string
  doc_number: string | null
  /** YYYY-MM-DD */
  expires_on: string | null
  s3_key: string
  file_name: string | null
  status: DocStatus
  /** Shown to the owner. */
  review_note: string | null
  /** The platform admin who approved or rejected it. */
  reviewed_by: string | null
  created_at: string
  reviewed_at: string | null
}

export interface ComplianceDocumentInput {
  docType: string
  category: string
  number: string | null
  expiresOn: string | null
  s3Key: string
  fileName: string | null
}

const COLS = `id, owner_id, tenant_id, category, doc_type, doc_number, to_char(expires_on, 'YYYY-MM-DD') AS expires_on, s3_key, file_name,
  status, review_note, reviewed_by, created_at, reviewed_at`

/** Each document sent (again) goes back to review: its status, note and reviewer reset. */
async function upsertDocuments(tenantId: string, ownerId: string, docs: ComplianceDocumentInput[]): Promise<ComplianceDocumentRow[]> {
  if (!docs.length) return []
  const r = await controlPlanePool().query<ComplianceDocumentRow>(
    `INSERT INTO tenant_compliance_documents (owner_id, tenant_id, category, doc_type, doc_number, expires_on, s3_key, file_name)
     SELECT $1, $2, d.category, d.doc_type, d.doc_number, d.expires_on, d.s3_key, d.file_name
       FROM jsonb_to_recordset($3::jsonb) AS d(category text, doc_type text, doc_number text, expires_on date, s3_key text, file_name text)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET
       owner_id = EXCLUDED.owner_id, category = EXCLUDED.category, doc_number = EXCLUDED.doc_number,
       expires_on = EXCLUDED.expires_on, s3_key = EXCLUDED.s3_key, file_name = EXCLUDED.file_name,
       status = 'pending', review_note = NULL, reviewed_at = NULL, reviewed_by = NULL, created_at = now()
     RETURNING ${COLS}`,
    [
      ownerId,
      tenantId,
      JSON.stringify(
        docs.map(d => ({
          category: d.category.slice(0, 64),
          doc_type: d.docType,
          doc_number: d.number?.slice(0, 64) || null,
          expires_on: d.expiresOn || null,
          s3_key: d.s3Key,
          file_name: d.fileName?.slice(0, 255) || null,
        }))
      ),
    ]
  )
  return r.rows
}

/** The application's documents replace the store's: types no longer needed go, each one sent goes back to review. */
export async function saveComplianceDocuments(tenantId: string, ownerId: string, docs: ComplianceDocumentInput[]): Promise<void> {
  await controlPlanePool().query(`DELETE FROM tenant_compliance_documents WHERE tenant_id = $1 AND NOT (doc_type = ANY($2::text[]))`, [
    tenantId,
    docs.map(d => d.docType),
  ])
  await upsertDocuments(tenantId, ownerId, docs)
}

/** One document the owner sends from the console (a renewal, a corrected copy, one for a category they now sell): it goes to review. */
export async function submitComplianceDocument(tenantId: string, ownerId: string, doc: ComplianceDocumentInput): Promise<ComplianceDocumentRow> {
  const [row] = await upsertDocuments(tenantId, ownerId, [doc])
  return row
}

export async function listComplianceDocuments(tenantId: string): Promise<ComplianceDocumentRow[]> {
  const r = await controlPlanePool().query<ComplianceDocumentRow>(
    `SELECT ${COLS} FROM tenant_compliance_documents WHERE tenant_id = $1 ORDER BY created_at, doc_type`,
    [tenantId]
  )
  return r.rows
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getComplianceDocument(tenantId: string, id: string): Promise<ComplianceDocumentRow | null> {
  if (!UUID.test(tenantId) || !UUID.test(id)) return null
  const r = await controlPlanePool().query<ComplianceDocumentRow>(
    `SELECT ${COLS} FROM tenant_compliance_documents WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  )
  return r.rows[0] ?? null
}

/** A document the owner may open: one of a store they own. */
export async function getOwnerComplianceDocument(ownerId: string, id: string): Promise<ComplianceDocumentRow | null> {
  if (!UUID.test(ownerId) || !UUID.test(id)) return null
  const r = await controlPlanePool().query<ComplianceDocumentRow>(
    `SELECT ${COLS} FROM tenant_compliance_documents d
      WHERE d.id = $2 AND EXISTS (SELECT 1 FROM owner_tenants ot WHERE ot.tenant_id = d.tenant_id AND ot.owner_id = $1)`,
    [ownerId, id]
  )
  return r.rows[0] ?? null
}

/**
 * A platform admin's decision on one document, with an optional note the owner sees. `s3Key` is the file the admin
 * looked at: a copy the owner sent since is left for its own review. A lapsed one can only be rejected (the owner has to
 * send the renewed one). Null in those cases, or when there is no such document.
 */
export async function reviewComplianceDocument(
  tenantId: string,
  id: string,
  decision: 'approved' | 'rejected',
  reviewer: string,
  note: string | null,
  s3Key: string | null,
  today = todayIst()
): Promise<ComplianceDocumentRow | null> {
  if (!UUID.test(tenantId) || !UUID.test(id)) return null
  const r = await controlPlanePool().query<ComplianceDocumentRow>(
    `UPDATE tenant_compliance_documents SET status = $3::text, review_note = $4, reviewed_by = $5, reviewed_at = now()
      WHERE tenant_id = $1 AND id = $2 AND ($3::text = 'rejected' OR expires_on IS NULL OR expires_on >= $6::date)
        AND ($7::text IS NULL OR s3_key = $7::text)
     RETURNING ${COLS}`,
    [tenantId, id, decision, note?.slice(0, 1000) || null, reviewer.slice(0, 255), today, s3Key]
  )
  return r.rows[0] ?? null
}

/** Approving the KYC approves the documents still waiting with it; one that lapsed meanwhile is marked expired instead. */
export async function approveComplianceDocuments(tenantId: string, reviewer: string | null = null, today = todayIst()): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenant_compliance_documents
        SET status = CASE WHEN expires_on < $3::date THEN 'expired' ELSE 'approved' END, reviewed_at = now(), reviewed_by = $2
      WHERE tenant_id = $1 AND status = 'pending'`,
    [tenantId, reviewer?.slice(0, 255) ?? null, today]
  )
}

/** For badges and banners: `action` once a document is rejected or expired, `review` while one waits on the platform admin. */
export async function complianceAttention(tenantId: string): Promise<'action' | 'review' | null> {
  const s = complianceStanding(await listComplianceDocuments(tenantId))
  return s === 'action' || s === 'review' ? s : null
}
