import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import CatalogEnrichmentClient from './CatalogEnrichmentClient'
import AccessDenied from '@/components/admin/AccessDenied'
import { adminCookieName } from '@/lib/admin-cookie'

export default async function CatalogEnrichmentPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  let role = ''
  let scopes: string[] = []
  try {
    if (token) {
      const payload = await verifyToken(token.value)
      role = payload?.role || ''
      scopes = payload?.scopes || []
    }
  } catch {}

  if (!hasScope(role, scopes, 'catalog_enrichment:read')) {
    return <AccessDenied scopeKey="catalog_enrichment" scopeLabel="Catalog Enrichment" />
  }

  return <CatalogEnrichmentClient />
}
