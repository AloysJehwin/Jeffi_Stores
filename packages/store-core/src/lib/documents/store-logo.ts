import 'server-only'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

// Tenant logo for the PDF/document renderers, as an image Buffer PDFKit can draw. Resolves the
// current store's logoUrl (site_settings business_logo_url via getStoreIdentity); returns null when
// the tenant has set no logo (logoUrl === '') or the fetch fails, so callers render the store name
// as text instead of falling back to the platform's bundled logo.
export async function tenantLogoBuffer(): Promise<Buffer | null> {
  let url = ''
  try {
    url = (await getStoreIdentity()).logoUrl
  } catch {
    return null
  }
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}
