import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

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
