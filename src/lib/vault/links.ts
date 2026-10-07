import 'server-only'
import { resolveCurrentTenant } from '@/lib/catalog/brand'
import { vaultHostForSlug } from '@/lib/tenancy/forms-host'

/** Base URL of the vault host for the current tenant (or the platform vault). */
export async function vaultBaseUrlAsync(): Promise<string> {
  const tenant = await resolveCurrentTenant()
  return `https://${vaultHostForSlug(tenant?.slug ?? null)}`
}

/** Deep link to a purchased product in the vault. */
export async function vaultItemUrl(productId: string): Promise<string> {
  return `${await vaultBaseUrlAsync()}/item/${encodeURIComponent(productId)}`
}

/** The vault library landing page. */
export async function vaultLibraryUrl(): Promise<string> {
  return `${await vaultBaseUrlAsync()}/library`
}
