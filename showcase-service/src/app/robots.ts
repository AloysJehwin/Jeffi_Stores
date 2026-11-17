import type { MetadataRoute } from 'next'
import { currentSite, siteOrigin } from '@showcase/lib/site'

export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await currentSite().catch(() => null)
  if (site?.status !== 'live' || site.workspaceSuspended) return { rules: { userAgent: '*', disallow: '/' } }
  const origin = await siteOrigin()
  return { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: `${origin}/sitemap.xml`, host: origin }
}
