import crypto from 'crypto'
import { issueTenantAdminCert } from './tenant-ca'
import { sendAdminCertificateEmail } from './email'
import { runWithTenantContext } from './tenant-context'
import { query, queryOne } from './db'
import { TENANT_SCOPE_KEYS } from './scopes'
import type { TenantContext } from './tenant-context'

/**
 * Provision the store owner as a super_admin in the tenant's own DB.
 * Called when the tenant's store goes live (subscription.charged webhook).
 *
 * Flow:
 * 1. Resolve tenant infra from control plane
 * 2. Run inside TenantContext so getPool() → tenant's RDS
 * 3. Create user + admin row (role='super_admin', all scopes)
 * 4. Issue an mTLS client certificate from the TENANT's own CA
 * 5. Email cert + password to owner
 *
 * Idempotent — skips if super_admin already exists for this email.
 * Non-fatal — if tenant DB not ready yet, logs and returns false (retried on next event).
 */
export async function provisionTenantOwnerAdmin(opts: {
  tenantId: string
  tenantSlug: string
  ownerEmail: string
  ownerName: string | null
  storeName?: string | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await resolveTenantCtx(opts.tenantId)
    if (!ctx) {
      return { success: false, error: 'Tenant DB not yet provisioned — will retry on next activation' }
    }

    const storeName = opts.storeName?.trim() || ctx.displayName?.trim() || opts.tenantSlug
    await runWithTenantContext(ctx, async () => {
      // Idempotency: skip if super_admin already exists for this email
      const existing = await queryOne<{ id: string }>(
        `SELECT a.id FROM admins a
         JOIN users u ON u.id = a.user_id
         WHERE u.email = $1 AND a.role = 'super_admin' LIMIT 1`,
        [opts.ownerEmail]
      )
      if (existing) return

      const nameParts = (opts.ownerName ?? opts.ownerEmail).split(' ')
      const firstName = nameParts[0] ?? opts.ownerEmail
      const lastName = nameParts.slice(1).join(' ') || ''

      // 1. Upsert user
      // ON CONFLICT (email) has no matching constraint — the only unique touching email is
      // users_email_user_type_key UNIQUE (email, user_type). Postgres rejects the statement
      // outright ("no unique or exclusion constraint matching the ON CONFLICT specification"),
      // so this never created an owner admin, never issued a certificate and never sent the
      // email — while provisioning still reported done, because the caller swallowed the error.
      // user_type is NOT NULL and must be given explicitly for the conflict target to match.
      const userRow = await queryOne<{ id: string }>(
        `INSERT INTO users (email, first_name, last_name, is_active, user_type)
         VALUES ($1, $2, $3, true, 'customer')
         ON CONFLICT (email, user_type) DO UPDATE
           SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name
         RETURNING id`,
        [opts.ownerEmail, firstName, lastName]
      )
      const userId = userRow!.id

      // 2. Create super_admin with all scopes
      const adminRow = await queryOne<{ id: string }>(
        // admins.scopes is jsonb. Passing the JS array directly makes node-postgres send a
        // Postgres array literal ({a,b,c}), which jsonb rejects with "invalid input syntax for
        // type json" — so the owner admin was never created and no certificate was issued.
        // Every other call site that writes this column stringifies it.
        `INSERT INTO admins (user_id, role, scopes, is_active)
         VALUES ($1, 'super_admin', $2::jsonb, true)
         ON CONFLICT (user_id) DO UPDATE
           SET role='super_admin', scopes=$2::jsonb, is_active=true
         RETURNING id`,
        [userId, JSON.stringify(TENANT_SCOPE_KEYS)]
      )
      const adminId = adminRow!.id

      // 3. Issue an mTLS client cert from this tenant's OWN CA, so it can never
      //    authenticate against another tenant's admin panel.
      const certCN = opts.ownerEmail.replace(/[^a-zA-Z0-9._@-]/g, '_')
      const cert = await issueTenantAdminCert({
        tenantId: opts.tenantId,
        slug: opts.tenantSlug,
        commonName: certCN,
        issuedTo: opts.ownerEmail,
      })
      const downloadToken = crypto.randomUUID()

      await query(
        `INSERT INTO admin_certificates
           (admin_id, serial_number, common_name, expires_at, download_token, p12_data, p12_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [adminId, cert.serial, certCN, cert.expiresAt, downloadToken, cert.p12Buffer, cert.p12Password]
      )

      // 4. Email cert to owner
      await sendAdminCertificateEmail(
        opts.ownerEmail,
        opts.ownerName ?? opts.ownerEmail,
        cert.p12Buffer,
        cert.p12Password,
        cert.serial,
        cert.expiresAt.toISOString(),
        'super_admin',
        { slug: opts.tenantSlug, storeName },
      )
    })

    return { success: true }
  } catch (err: any) {
    process.stderr.write(`[provisionTenantOwnerAdmin] ${opts.tenantSlug}: ${err?.message}\n`)
    return { success: false, error: err?.message }
  }
}

async function resolveTenantCtx(tenantId: string): Promise<TenantContext | null> {
  const { controlPlanePool } = await import('./tenant-registry')
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.display_name, p.slug AS plan,
            i.rds_endpoint, i.rds_db, i.rds_port, i.iam_auth, i.s3_bucket, i.region
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.id = $1`, [tenantId]
  )
  const r = res.rows[0]
  if (!r?.rds_endpoint) return null
  return {
    tenantId: r.id,
    slug: r.slug,
    displayName: r.display_name ?? null,
    plan: r.plan ?? null,
    infra: {
      rdsEndpoint: r.rds_endpoint,
      rdsDb: r.rds_db || 'jeffi_stores',
      rdsPort: r.rds_port || 5432,
      dbSecretRef: null,
      iamAuth: r.iam_auth !== false,
      s3Bucket: r.s3_bucket ?? null,
      region: r.region || 'us-east-1',
    },
  }
}
