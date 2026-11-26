import crypto from 'crypto'
import { isSecretError, secrets } from '@/lib/secrets/index.mjs'
import { AWS_REGION, NODE_DB_USER, TENANT_DB_NAME, tenantDbSecretRef } from './tenant-admin-pool'

// The on-node Postgres password, kept at jeffi/tenant-db/{slug} (Secrets Manager or Key Vault) as
// {username,password,database}. Postgres takes POSTGRES_PASSWORD only when it initialises an empty
// data directory, so a password, once stored, is never replaced: every later render, retry or
// re-provision reads it back. Never logged.

const newPassword = () => crypto.randomBytes(24).toString('base64url')
const body = (password: string) => JSON.stringify({ username: NODE_DB_USER, password, database: TENANT_DB_NAME })

/** The store's database password: the stored one, else a new one stored first. */
export async function getOrCreateTenantDbPassword(slug: string): Promise<string> {
  const store = secrets(AWS_REGION)
  const name = tenantDbSecretRef(slug)
  for (let attempt = 0; attempt < 3; attempt++) {
    let existing: Record<string, any> | null = null
    try {
      existing = JSON.parse((await store.get(name)) || '{}')
    } catch (e) {
      // A rollback or teardown scheduled it for deletion: bring it back, password and all.
      if (isSecretError(e, 'Deleted')) {
        await store.restore(name)
        continue
      }
      if (!isSecretError(e, 'NotFound')) throw e
    }
    if (existing?.password) {
      // Older secrets named the database `jeffi`; correct the label, keep the password.
      if (existing.database !== TENANT_DB_NAME || existing.username !== NODE_DB_USER) await store.put(name, body(existing.password))
      return existing.password
    }
    const password = newPassword()
    try {
      if (existing) await store.put(name, body(password))
      else await store.create(name, body(password))
      return password
    } catch (e) {
      // Created meanwhile by another tick: read theirs.
      if (!isSecretError(e, 'Exists')) throw e
    }
  }
  throw new Error(`could not read or create the database secret ${name}`)
}

/** Schedule the store's database secret for deletion (7-day recovery; a re-provision restores it). */
export async function deleteTenantDbSecret(slug: string): Promise<void> {
  await secrets(AWS_REGION).remove(tenantDbSecretRef(slug), { recoveryDays: 7 })
}
