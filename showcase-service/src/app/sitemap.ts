import type { MetadataRoute } from 'next'
import { currentSite, siteOrigin } from '@showcase/lib/site'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await currentSite().catch(() => null)
  if (site?.status !== 'live' || site.workspaceSuspended) return []
  return [{ url: `${await siteOrigin()}/`, lastModified: site.updatedAt, changeFrequency: 'monthly', priority: 1 }]
}
