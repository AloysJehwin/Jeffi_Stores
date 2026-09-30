import { controlPlanePool } from './shared'

export interface IntegrationCredential {
  id: string
  tenant_id: string
  provider: string
  label: string | null
  config_enc: string
  meta: Record<string, any>
  status: string
  expires_at: string | null
}

/** Upsert a tenant's encrypted credential for a provider (one row per provider). */
export async function saveIntegrationCredential(c: {
  tenantId: string
  provider: string
  label?: string | null
  configEnc: string
  meta?: Record<string, any>
  expiresAt?: Date | null
}): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO tenant_integration_credentials
       (tenant_id, provider, label, config_enc, meta, expires_at, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'connected')
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       label=EXCLUDED.label, config_enc=EXCLUDED.config_enc, meta=EXCLUDED.meta,
       expires_at=EXCLUDED.expires_at, status='connected', updated_at=now()`,
    [
      c.tenantId,
      c.provider,
      c.label ?? null,
      c.configEnc,
      JSON.stringify(c.meta ?? {}),
      c.expiresAt ? c.expiresAt.toISOString() : null,
    ]
  )
}

export async function getIntegrationCredential(
  tenantId: string,
  provider: string
): Promise<IntegrationCredential | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM tenant_integration_credentials WHERE tenant_id=$1 AND provider=$2`, [
    tenantId,
    provider,
  ])
  return (r.rows[0] as IntegrationCredential) ?? null
}

/** List a tenant's integrations WITHOUT the encrypted secret (safe for API/UI). */
export async function listIntegrationCredentials(
  tenantId: string
): Promise<Array<Omit<IntegrationCredential, 'config_enc'>>> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT id, tenant_id, provider, label, meta, status, expires_at
     FROM tenant_integration_credentials WHERE tenant_id=$1 ORDER BY provider`,
    [tenantId]
  )
  return r.rows
}

export async function deleteIntegrationCredential(tenantId: string, provider: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`DELETE FROM tenant_integration_credentials WHERE tenant_id=$1 AND provider=$2`, [
    tenantId,
    provider,
  ])
}

// ── Custom domains (BYO CNAME) ────────────────────────────────────────────────

