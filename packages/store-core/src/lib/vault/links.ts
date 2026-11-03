import 'server-only'
import { resolveCurrentTenant } from '@/lib/catalog/brand'
import { vaultHostForSlug, storeHostForSlug } from '@/lib/tenancy/forms-host'
import { getHost } from '@/lib/tenancy/get-host'

/** Base URL of the vault host for the current tenant (or the platform vault). */
export async function vaultBaseUrlAsync(): Promise<string> {
  const tenant = await resolveCurrentTenant()
  return `https://${vaultHostForSlug(tenant?.slug ?? null)}`
}

/** Local dev has no platform DNS: `vault.localhost:3000` → `localhost:3000`. */
export function devStoreHost(host: string): string | null {
  if (process.env.NODE_ENV === 'production') return null
  return /^(?:[^.]+\.)?localhost(?::\d+)?$/i.test(host) ? host.replace(/^[^.]+\.(?=localhost)/i, '') : null
}

/** Base URL of the current tenant's storefront (the vault's "Back to store"). */
export async function storeBaseUrlAsync(): Promise<string> {
  const dev = devStoreHost(await getHost().catch(() => ''))
  if (dev) return `http://${dev}`
  const tenant = await resolveCurrentTenant()
  return `https://${storeHostForSlug(tenant?.slug ?? null)}`
}

/** Deep link to a purchased product in the vault. */
export async function vaultItemUrl(productId: string): Promise<string> {
  return `${await vaultBaseUrlAsync()}/item/${encodeURIComponent(productId)}`
}

/** The vault library landing page. */
export async function vaultLibraryUrl(): Promise<string> {
  return `${await vaultBaseUrlAsync()}/library`
}
