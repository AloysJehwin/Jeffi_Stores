import 'server-only'
import { queryMany } from '@/lib/shared/db'

/** Every service account, newest first: the Service accounts tab and its API list, and their export. */
export async function listServiceAccounts() {
  return queryMany(
    `SELECT id, name, common_name, allowed_scopes, is_revoked, revoked_at,
            p12_downloaded, created_at, last_used_at
     FROM service_accounts
     ORDER BY created_at DESC`
  )
}
