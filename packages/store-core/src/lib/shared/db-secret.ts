import { SecretsManagerClient, GetSecretValueCommand, DeleteSecretCommand, RestoreSecretCommand } from '@aws-sdk/client-secrets-manager'

// Credentials for a password-auth tenant (the store's own Postgres on its EC2 node) live in a
// Secrets Manager secret (JSON with username/password/database) referenced by tenant_infra.db_secret_ref.
// Mirrors the reference in packages/tenancy/src/pools.ts. Cached per secret ref for 5 min.
interface DbSecret {
  username?: string
  password: string
  database?: string
  expiresAt: number
}
const secretCache = new Map<string, DbSecret>()
const SECRET_TTL_MS = 5 * 60 * 1000

export async function fetchDbSecret(ref: string, region: string): Promise<DbSecret> {
  const now = Date.now()
  const hit = secretCache.get(ref)
  if (hit && hit.expiresAt > now) return hit
  const client = new SecretsManagerClient({ region })
  const res = await client.send(new GetSecretValueCommand({ SecretId: ref }))
  const parsed = JSON.parse(res.SecretString || '{}')
  if (!parsed.password) throw new Error(`Secret ${ref} has no password field`)
  const entry: DbSecret = {
    username: parsed.username,
    password: parsed.password,
    database: parsed.database,
    expiresAt: now + SECRET_TTL_MS,
  }
  secretCache.set(ref, entry)
  return entry
}

/** Delete a database secret now, with no recovery window. Gone is success; one already scheduled for deletion is restored, then deleted. */
export async function forceDeleteDbSecret(ref: string, region: string): Promise<void> {
  const client = new SecretsManagerClient({ region })
  const del = () => client.send(new DeleteSecretCommand({ SecretId: ref, ForceDeleteWithoutRecovery: true }))
  secretCache.delete(ref)
  try {
    await del()
  } catch (e: any) {
    if (e?.name === 'ResourceNotFoundException') return
    if (e?.name !== 'InvalidRequestException' || !/marked for deletion|scheduled for deletion/i.test(e?.message || '')) throw e
    await client.send(new RestoreSecretCommand({ SecretId: ref }))
    await del()
  }
}
