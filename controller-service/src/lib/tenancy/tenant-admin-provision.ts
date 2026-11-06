import crypto from 'crypto'
import { getTenantCa, issueTenantAdminCert, revokeTenantAdminCert } from '@/lib/tenancy/tenant-ca'
import { sendAdminCertificateEmail, sendCertInviteEmail } from '@/lib/email'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { query, queryOne } from '@/lib/shared/db'
import { recordPortalCert, revokePortalCerts } from '@/lib/tenancy/portal-certs'
import { TENANT_SCOPE_KEYS } from '@/lib/auth/scopes'
import type { TenantContext } from '@/lib/tenancy/tenant-context'

const CONNECT_ATTEMPTS = 4

export type OwnerAdminOutcome = 'issued' | 'exists' | 'reissued'

export interface OwnerAdminResult {
  success: boolean
  error?: string
  outcome?: OwnerAdminOutcome
  serial?: string
  expiresAt?: Date
  /** The certificate invite went out (false: it did not, or nothing needed sending). */
  emailed: boolean
  /** Serials revoked in favour of the new certificate. */
  revoked: string[]
  /** This call created the tenant's CA (the fleet's CA bundle needs a refresh). */
  caCreated: boolean
}

interface OwnerAdminOpts {
  tenantId: string
  tenantSlug: string
  ownerEmail: string
  ownerName: string | null
  storeName?: string | null
  /** Issue a new certificate even when an active one exists. */
  force?: boolean
  /** With force: revoke this admin's other active certificates once the new one exists. */
  revokeExisting?: boolean
  revokedBy?: string
  /** An earlier issue of this serial failed to email: send the invite again if it is still the active one. */
  resendInviteFor?: string
}

type CreatedOwnerAdmin = Omit<OwnerAdminResult, 'success' | 'error'>

/** A just-created tenant RDS often is not accepting connections the instant the job flips to
 * `done`, so the first connect times out. These are transient — worth retrying — unlike a SQL
 * or logic error, which will fail identically every attempt. */
function isTransientConnError(msg: string): boolean {
  return /Connection terminated|connection timeout|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|the database system is starting up|too many clients|Connection terminated unexpectedly/i.test(
    msg
  )
}

/**
 * Provision the store owner as a super_admin in the tenant's own DB. Called by the provisioning
 * pipeline's issue_owner_certificate step, by the worker for jobs that predate it, and by the
 * platform admin's manual (re-)issue.
 *
 * Flow:
 * 1. Resolve tenant infra from control plane
 * 2. Run inside TenantContext so getPool() → tenant's RDS
 * 3. Create user + admin row (role='super_admin', plan scopes)
 * 4. Issue an mTLS client certificate from the TENANT's own CA
 * 5. Email the certificate-portal invite to the owner
 *
 * Idempotent: an active (unrevoked, unexpired) super_admin cert for the email means `exists`, unless
 * `force`. A failed email does not fail the call (`emailed: false`), so a retry can resend it.
 * Non-fatal — if tenant DB not ready yet, logs and returns success false (the caller retries).
 */
export async function provisionTenantOwnerAdmin(opts: OwnerAdminOpts): Promise<OwnerAdminResult> {
  const failed = (error?: string): OwnerAdminResult => ({ success: false, error, emailed: false, revoked: [], caCreated: false })
  try {
    const ctx = await resolveTenantCtx(opts.tenantId)
    if (!ctx) {
      return failed('Tenant DB not yet provisioned — will retry on next activation')
    }

    const storeName = opts.storeName?.trim() || ctx.displayName?.trim() || opts.tenantSlug
    // Fails open to every tenant scope: a control-plane hiccup must not provision an owner
    // who cannot reach their own store. The request-time gate still holds them to the plan.
    let grantedScopes: string[] = TENANT_SCOPE_KEYS
    try {
      const { getTenantPlan } = await import('@/lib/auth/plan-gate')
      const { scopes } = await getTenantPlan(opts.tenantId)
      if (scopes.size > 0) grantedScopes = TENANT_SCOPE_KEYS.filter(k => scopes.has(k))
    } catch {
      /* keep the full tenant set */
    }

    let lastConnErr: any
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      try {
        const made = await runWithTenantContext(ctx, () => createOwnerAdmin({ ...opts, ownerPhone: ctx.ownerMobile }, grantedScopes, storeName))
        return { success: true, ...made }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        if (attempt === CONNECT_ATTEMPTS || !isTransientConnError(msg)) throw err
        lastConnErr = err
        const backoff = 2000 * 2 ** (attempt - 1)
        await new Promise(r => setTimeout(r, backoff + Math.floor(Math.random() * 500)))
      }
    }
    throw lastConnErr
  } catch (err: any) {
    process.stderr.write(`[provisionTenantOwnerAdmin] ${opts.tenantSlug}: ${err?.message}\n`)
    return failed(err?.message)
  }
}

const ACTIVE_OWNER_CERTS = `SELECT ac.id, ac.serial_number FROM admin_certificates ac
     JOIN admins a ON a.id = ac.admin_id
     JOIN users u ON u.id = a.user_id
     WHERE u.email = $1 AND a.role = 'super_admin'
       AND ac.is_revoked IS NOT TRUE AND ac.expires_at > now()
     ORDER BY ac.created_at DESC`

const sameSerial = (a?: string | null, b?: string | null) => !!a && !!b && a.toUpperCase() === b.toUpperCase()

async function createOwnerAdmin(
  opts: OwnerAdminOpts & { ownerPhone?: string | null },
  grantedScopes: string[],
  storeName: string
): Promise<CreatedOwnerAdmin> {
  // Idempotency: skip only when the owner super_admin ALREADY HAS an active client certificate.
  // Checking for the super_admin row alone is wrong on re-provision — deprovision backs up the
  // tenant DB and restore_data brings the admins/users rows back, so the row exists again while
  // admin_certificates was never re-issued. A revoked or expired cert opens nothing, so it does
  // not count either.
  const existing = await queryOne<{ id: string; serial_number: string }>(`${ACTIVE_OWNER_CERTS} LIMIT 1`, [opts.ownerEmail])
  if (existing && !opts.force) {
    // The invite carries no p12 (portal delivery), so sending it again is safe.
    const emailed = sameSerial(existing.serial_number, opts.resendInviteFor)
      ? await sendCertInviteEmail(opts.ownerEmail, opts.ownerName ?? opts.ownerEmail, 'super_admin', { slug: opts.tenantSlug, storeName })
          .then(() => true)
          .catch(e => {
            process.stderr.write(`[provisionTenantOwnerAdmin] ${opts.tenantSlug}: invite resend failed: ${e?.message}\n`)
            return false
          })
      : false
    return { outcome: 'exists', serial: existing.serial_number, emailed, revoked: [], caCreated: false }
  }
  const previous =
    opts.force && opts.revokeExisting
      ? (await query<{ serial_number: string }>(ACTIVE_OWNER_CERTS, [opts.ownerEmail])).rows.map(r => r.serial_number)
      : []

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
  // The KYC mobile, unverified, so the admin's profile isn't blank; never replaces one already set.
  const userRow = await queryOne<{ id: string }>(
    `INSERT INTO users (email, first_name, last_name, phone, is_active, user_type)
     VALUES ($1, $2, $3, $4, true, 'customer')
     ON CONFLICT (email, user_type) DO UPDATE
       SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, phone=COALESCE(users.phone, EXCLUDED.phone)
     RETURNING id`,
    [opts.ownerEmail, firstName, lastName, opts.ownerPhone || null]
  )
  const userId = userRow!.id

  // 2. Create super_admin with the scopes this tenant's plan actually sells. The stored
  //    grant should reflect what was bought; resolveSession intersects with the plan again
  //    at request time so an upgrade or downgrade needs no re-provisioning.
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
    [userId, JSON.stringify(grantedScopes)]
  )
  const adminId = adminRow!.id

  // 3. Issue an mTLS client cert from this tenant's OWN CA, so it can never
  //    authenticate against another tenant's admin panel.
  let hadCa = true
  try {
    hadCa = !!(await getTenantCa(opts.tenantId))
  } catch {
    /* unknown: assume it exists, so no fleet refresh is forced */
  }
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

  // Central portal registry so certificate.jeffistores.in can serve it. Explicitly targets the
  // control-plane pool (not this tenant's RDS), so it is written even inside runWithTenantContext.
  // Non-fatal: the cert is still emailed during the transition window.
  await recordPortalCert({
    tenantId: opts.tenantId,
    serial: cert.serial,
    commonName: certCN,
    issuedTo: opts.ownerEmail,
    role: 'super_admin',
    storeName,
    p12Buffer: cert.p12Buffer,
    p12Password: cert.p12Password,
    expiresAt: cert.expiresAt,
    downloadToken,
  })

  // 4. Email cert to owner. A send failure must not fail the issue: the cert row now exists, so a
  //    retry would see it and never email; the caller resends instead (resendInviteFor).
  let emailed = true
  try {
    await sendAdminCertificateEmail(
      opts.ownerEmail,
      opts.ownerName ?? opts.ownerEmail,
      cert.p12Buffer,
      cert.p12Password,
      cert.serial,
      cert.expiresAt.toISOString(),
      'super_admin',
      { slug: opts.tenantSlug, storeName }
    )
  } catch (e: any) {
    emailed = false
    process.stderr.write(`[provisionTenantOwnerAdmin] ${opts.tenantSlug}: certificate email failed: ${e?.message}\n`)
  }

  // 5. Only once the new cert exists: retire the ones it replaces.
  const stale = previous.filter(s => !sameSerial(s, cert.serial))
  const revoked = stale.length ? await revokeCertSerials(stale, opts.revokedBy || 'platform-admin') : []

  return {
    outcome: existing ? 'reissued' : 'issued',
    serial: cert.serial,
    expiresAt: cert.expiresAt,
    emailed,
    revoked,
    caCreated: !hadCa,
  }
}

/**
 * Revoke admin certificates everywhere they are honoured: the tenant_admin_certs registry (mTLS), the
 * portal (download) and, running in the tenant's context, its admin_certificates. Never throws (a new
 * cert was already issued; a retry must not issue another); returns the serials the registry revoked.
 */
async function revokeCertSerials(serials: string[], revokedBy: string): Promise<string[]> {
  const done: string[] = []
  for (const s of serials) {
    try {
      await revokeTenantAdminCert(s, revokedBy)
      done.push(s)
    } catch (e: any) {
      process.stderr.write(`[revokeCertSerials] ${s} not revoked: ${e?.message}\n`)
    }
  }
  await revokePortalCerts(done)
  await markRevokedInTenantDb(done)
  return done
}

async function markRevokedInTenantDb(serials: string[]): Promise<void> {
  if (!serials.length) return
  await query(
    `UPDATE admin_certificates SET is_revoked = true, revoked_at = now()
      WHERE upper(serial_number) = ANY($1::text[]) AND is_revoked IS NOT TRUE`,
    [serials.map(s => s.toUpperCase())]
  ).catch((e: any) => process.stderr.write(`[revokeCertSerials] tenant DB not updated: ${e?.message}\n`))
}

/** Mark certificates revoked in the tenant DB (admin_certificates). Never throws. */
export async function markTenantDbCertsRevoked(tenantId: string, serials: string[]): Promise<boolean> {
  if (!serials.length) return true
  try {
    const ctx = await resolveTenantCtx(tenantId)
    if (!ctx) return false
    await runWithTenantContext(ctx, () => markRevokedInTenantDb(serials))
    return true
  } catch {
    return false
  }
}

export interface EnsureOwnerAdminResult extends OwnerAdminResult {
  slug?: string
  email?: string
  /** No owner is linked to the tenant (and no email was given). */
  noOwner?: boolean
  fleetRefreshed?: boolean
  fleetError?: string
}

/** The tenant's owner (the first linked), with the tenant slug; null only when none is linked. A query error throws. */
export async function ownerOfTenant(tenantId: string): Promise<{ email: string; name: string | null; slug: string } | null> {
  const { controlPlanePool } = await import('@/lib/tenant-registry')
  const row = await controlPlanePool().query(
    `SELECT o.email, o.name, t.slug
     FROM owner_tenants ot
     JOIN owners o ON o.id = ot.owner_id
     JOIN tenants t ON t.id = ot.tenant_id
     WHERE ot.tenant_id = $1 LIMIT 1`,
    [tenantId]
  )
  return row.rows[0] ?? null
}

/**
 * The owner's super_admin and certificate, issued if missing (or re-issued with `force`). `email`/`name`
 * issue to someone else: a certificate's CN must match the admin who signs in with it, so another email
 * is another super_admin. `refreshFleet` republishes the fleet's client-CA bundle afterwards (always, or
 * only when this call created the tenant CA).
 */
export async function ensureOwnerAdmin(
  tenantId: string,
  opts: {
    force?: boolean
    revokeExisting?: boolean
    revokedBy?: string
    email?: string
    name?: string | null
    resendInviteFor?: string
    refreshFleet?: boolean | 'if-ca-created'
  } = {}
): Promise<EnsureOwnerAdminResult> {
  const owner = await ownerOfTenant(tenantId)
  let slug = owner?.slug
  if (!owner) {
    if (!opts.email) return { success: false, error: 'no owner is linked to this tenant', noOwner: true, emailed: false, revoked: [], caCreated: false }
    const { getTenant } = await import('@/lib/tenant-registry')
    slug = (await getTenant(tenantId).catch(() => null))?.slug
    if (!slug) return { success: false, error: 'tenant not found', emailed: false, revoked: [], caCreated: false }
  }
  const email = opts.email?.trim() || owner!.email
  const sameAsOwner = !!owner && owner.email.toLowerCase() === email.toLowerCase()
  const r = await provisionTenantOwnerAdmin({
    tenantId,
    tenantSlug: slug!,
    ownerEmail: email,
    ownerName: opts.name?.trim() || (sameAsOwner ? owner!.name : null),
    force: opts.force,
    revokeExisting: opts.revokeExisting,
    revokedBy: opts.revokedBy,
    resendInviteFor: opts.resendInviteFor,
  })
  const out: EnsureOwnerAdminResult = { ...r, slug, email }
  if (opts.refreshFleet === true || (opts.refreshFleet === 'if-ca-created' && r.caCreated)) {
    try {
      const { refreshTenantMtlsFleet } = await import('@controller/lib/tenancy/mtls-fleet')
      await refreshTenantMtlsFleet(slug!)
      out.fleetRefreshed = true
    } catch (e: any) {
      out.fleetError = e?.message ?? String(e)
    }
  }
  return out
}

/**
 * For jobs whose pipeline has no issue_owner_certificate step: the owner admin once the job is done,
 * then the fleet's CA bundle so the admin host prompts for the new CA without waiting for a deploy.
 * Never throws; failures are logged and alerted (the store is live regardless).
 */
export async function fireOwnerAdmin(tenantId: string): Promise<void> {
  const res = await ensureOwnerAdmin(tenantId, { refreshFleet: true }).catch(
    (e: any): EnsureOwnerAdminResult => ({ success: false, error: e?.message ?? String(e), emailed: false, revoked: [], caCreated: false })
  )
  if (res.noOwner) return
  const slug = res.slug ?? tenantId
  if (!res.success) await reportOwnerAdminFailure(slug, 'owner_admin_cert', res.error ?? 'unknown error', '[provisionTenantOwnerAdmin]')
  else if (res.outcome !== 'exists' && !res.emailed)
    await reportOwnerAdminFailure(slug, 'owner_admin_cert', `certificate ${res.serial} issued but its email failed`, '[provisionTenantOwnerAdmin]')
  if (res.fleetError) await reportOwnerAdminFailure(slug, 'mtls_fleet_refresh', res.fleetError, '[mtls-fleet]')
}

/** Log and alert a post-provisioning failure, so it is not lost in the log. */
async function reportOwnerAdminFailure(slug: string, step: string, error: string, tag: string): Promise<void> {
  console.error(`${tag} ${slug}: ${error}`)
  try {
    const { alertProvisioningFailure } = await import('@controller/lib/provisioning/alerts')
    await alertProvisioningFailure(slug, step, error)
  } catch {
    /* alerting must never mask the original failure */
  }
}

async function resolveTenantCtx(tenantId: string): Promise<(TenantContext & { ownerMobile: string | null }) | null> {
  const { controlPlanePool } = await import('@/lib/tenant-registry')
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.display_name, p.slug AS plan, k.mobile,
            i.rds_endpoint, i.rds_db, i.rds_port, i.rds_user, i.iam_auth, i.db_secret_ref, i.s3_bucket, i.region
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     LEFT JOIN tenant_kyc k ON k.tenant_id = t.id
     WHERE t.id = $1
     LIMIT 1`,
    [tenantId]
  )
  const r = res.rows[0]
  if (!r?.rds_endpoint) return null
  return {
    tenantId: r.id,
    slug: r.slug,
    displayName: r.display_name ?? null,
    plan: r.plan ?? null,
    ownerMobile: r.mobile?.trim() || null,
    infra: {
      rdsEndpoint: r.rds_endpoint,
      rdsDb: r.rds_db || 'jeffi_stores',
      rdsPort: r.rds_port || 5432,
      rdsUser: r.rds_user ?? null,
      // A store's own on-node Postgres logs in with this secret's password (iam_auth false).
      dbSecretRef: r.db_secret_ref ?? null,
      iamAuth: r.iam_auth !== false,
      s3Bucket: r.s3_bucket ?? null,
      region: r.region || 'us-east-1',
    },
  }
}
