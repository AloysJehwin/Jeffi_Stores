import { controlPlanePool } from './shared'

export interface OnboardingDraft {
  id: string
  owner_id: string
  current_step: number
  data: Record<string, any>
  status: string
  updated_at: string
}

export async function saveDraft(ownerId: string, step: number, data: Record<string, any>): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO onboarding_drafts (owner_id, current_step, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (owner_id) DO UPDATE
       SET current_step = $2, data = $3, updated_at = now()
     WHERE onboarding_drafts.status = 'draft'`,
    [ownerId, step, JSON.stringify(data)]
  )
}

export async function getDraft(ownerId: string): Promise<OnboardingDraft | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM onboarding_drafts WHERE owner_id=$1`, [ownerId])
  return r.rows[0] ?? null
}

export async function markDraftSubmitted(ownerId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE onboarding_drafts SET status='submitted', updated_at=now() WHERE owner_id=$1`, [ownerId])
}

// ── Tenant KYC ────────────────────────────────────────────────────────────────

export interface TenantKyc {
  id: string
  tenant_id: string
  owner_id: string
  gst_number: string | null
  gst_cert_s3_key: string | null
  pan: string | null
  business_name: string | null
  business_type: string | null
  business_address: string | null
  product_categories: string | null
  mobile: string | null
  logo_s3_key: string | null
  seal_s3_key: string | null
  legals_accepted_version: string | null
  legals_accepted_at: string | null
  status: string
  reviewer_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export async function saveKyc(
  tenantId: string,
  ownerId: string,
  kyc: {
    gst_number?: string | null
    gst_cert_s3_key?: string | null
    pan?: string | null
    business_name?: string | null
    business_type?: string | null
    business_address?: string | null
    product_categories?: string | null
    mobile?: string | null
    logo_s3_key?: string | null
    seal_s3_key?: string | null
    legals_accepted?: boolean
  }
): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO tenant_kyc (tenant_id, owner_id, gst_number, gst_cert_s3_key, pan, business_name, business_type, business_address, product_categories, mobile, logo_s3_key, seal_s3_key, legals_accepted_version, legals_accepted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (tenant_id) DO UPDATE SET
       gst_number=EXCLUDED.gst_number, gst_cert_s3_key=COALESCE(EXCLUDED.gst_cert_s3_key, tenant_kyc.gst_cert_s3_key),
       pan=EXCLUDED.pan, business_name=EXCLUDED.business_name, business_type=EXCLUDED.business_type,
       business_address=EXCLUDED.business_address, product_categories=EXCLUDED.product_categories,
       mobile=COALESCE(EXCLUDED.mobile, tenant_kyc.mobile),
       logo_s3_key=COALESCE(EXCLUDED.logo_s3_key, tenant_kyc.logo_s3_key),
       seal_s3_key=COALESCE(EXCLUDED.seal_s3_key, tenant_kyc.seal_s3_key),
       legals_accepted_version=COALESCE(EXCLUDED.legals_accepted_version, tenant_kyc.legals_accepted_version),
       legals_accepted_at=COALESCE(EXCLUDED.legals_accepted_at, tenant_kyc.legals_accepted_at),
       updated_at=now()`,
    [
      tenantId,
      ownerId,
      kyc.gst_number ?? null,
      kyc.gst_cert_s3_key ?? null,
      kyc.pan ?? null,
      kyc.business_name ?? null,
      kyc.business_type ?? null,
      kyc.business_address ?? null,
      kyc.product_categories ?? null,
      kyc.mobile ?? null,
      kyc.logo_s3_key ?? null,
      kyc.seal_s3_key ?? null,
      kyc.legals_accepted ? process.env.POLICY_VERSION || '1' : null,
      kyc.legals_accepted ? new Date().toISOString() : null,
    ]
  )
}

export async function getKyc(tenantId: string): Promise<TenantKyc | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM tenant_kyc WHERE tenant_id=$1`, [tenantId])
  return r.rows[0] ?? null
}

export async function approveKyc(tenantId: string, reviewerEmail: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_kyc SET status='approved', reviewed_by=$2, reviewed_at=now(), updated_at=now() WHERE tenant_id=$1`,
    [tenantId, reviewerEmail]
  )
  // Approved but NOT paid yet → 'awaiting_payment'. The provisioning ENGINE (and 'provisioning'
  // status) only starts after subscription.charged — never before payment.
  await pool.query(`UPDATE tenants SET status='awaiting_payment', updated_at=now() WHERE id=$1`, [tenantId])
}

export async function rejectKyc(tenantId: string, reviewerEmail: string, note: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_kyc SET status='rejected', reviewed_by=$2, reviewed_at=now(), reviewer_note=$3, updated_at=now() WHERE tenant_id=$1`,
    [tenantId, reviewerEmail, note]
  )
  await pool.query(`UPDATE tenants SET status='rejected', updated_at=now() WHERE id=$1`, [tenantId])
}

// ── Social accounts + scheduled posts (Meta auto-posting) ─────────────────────

