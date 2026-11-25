import { fetchDbSecret, forgetDbSecret, secrets } from '@/lib/secrets/index.mjs'

// Credentials for a password-auth tenant (the store's own Postgres on its EC2 node) live in a
// secret (JSON with username/password/database) referenced by tenant_infra.db_secret_ref, in
// Secrets Manager or Key Vault (SECRETS_BACKEND). Cached per secret ref for 5 min.
export { fetchDbSecret }

/** Delete a database secret now, with no recovery window. Gone is success. */
export async function forceDeleteDbSecret(ref: string, region: string): Promise<void> {
  forgetDbSecret(ref)
  await secrets(region).remove(ref, { force: true })
}
