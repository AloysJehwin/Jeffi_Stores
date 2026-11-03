import crypto from 'crypto'
import { AWS_REGION, NODE_DB_USER, TENANT_DB_NAME, tenantDbSecretRef } from './tenant-admin-pool'

// The on-node Postgres password, kept in Secrets Manager at jeffi/tenant-db/{slug} as
// {username,password,database}. Postgres takes POSTGRES_PASSWORD only when it initialises an empty
// data directory, so a password, once stored, is never replaced: every later render, retry or
// re-provision reads it back. Never logged.

const MARKED_FOR_DELETION = /marked for deletion|scheduled for deletion/i

async function client() {
  const sm = await import('@aws-sdk/client-secrets-manager')
  return { sm, c: new sm.SecretsManagerClient({ region: AWS_REGION }) }
}

const newPassword = () => crypto.randomBytes(24).toString('base64url')
const body = (password: string) => JSON.stringify({ username: NODE_DB_USER, password, database: TENANT_DB_NAME })

/** The store's database password: the stored one, else a new one stored first. */
export async function getOrCreateTenantDbPassword(slug: string): Promise<string> {
  const { sm, c } = await client()
  const SecretId = tenantDbSecretRef(slug)
  for (let attempt = 0; attempt < 3; attempt++) {
    let existing: Record<string, any> | null = null
    try {
      const r = await c.send(new sm.GetSecretValueCommand({ SecretId }))
      existing = JSON.parse(r.SecretString || '{}')
    } catch (e: any) {
      // A rollback or teardown scheduled it for deletion: bring it back, password and all.
      if (e?.name === 'InvalidRequestException' && MARKED_FOR_DELETION.test(e?.message || '')) {
        await c.send(new sm.RestoreSecretCommand({ SecretId }))
        continue
      }
      if (e?.name !== 'ResourceNotFoundException') throw e
    }
    if (existing?.password) {
      // Older secrets named the database `jeffi`; correct the label, keep the password.
      if (existing.database !== TENANT_DB_NAME || existing.username !== NODE_DB_USER)
        await c.send(new sm.PutSecretValueCommand({ SecretId, SecretString: body(existing.password) }))
      return existing.password
    }
    const password = newPassword()
    try {
      if (existing) await c.send(new sm.PutSecretValueCommand({ SecretId, SecretString: body(password) }))
      else await c.send(new sm.CreateSecretCommand({ Name: SecretId, SecretString: body(password) }))
      return password
    } catch (e: any) {
      // Created meanwhile by another tick: read theirs.
      if (e?.name !== 'ResourceExistsException') throw e
    }
  }
  throw new Error(`could not read or create the database secret ${SecretId}`)
}

/** Schedule the store's database secret for deletion (7-day recovery; a re-provision restores it). */
export async function deleteTenantDbSecret(slug: string): Promise<void> {
  const { sm, c } = await client()
  try {
    await c.send(new sm.DeleteSecretCommand({ SecretId: tenantDbSecretRef(slug), RecoveryWindowInDays: 7, ForceDeleteWithoutRecovery: false }))
  } catch (e: any) {
    if (e?.name === 'ResourceNotFoundException') return
    if (e?.name === 'InvalidRequestException' && MARKED_FOR_DELETION.test(e?.message || '')) return
    throw e
  }
}
