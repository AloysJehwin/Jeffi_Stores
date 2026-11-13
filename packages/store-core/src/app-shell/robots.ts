import type { MetadataRoute } from 'next'
import { siteOrigin } from './site-origin'

// Prefix matches: '/r/' not '/r', which would also block /return-policy.
const PRIVATE = [
  '/api/',
  '/account',
  '/cart',
  '/checkout',
  '/login',
  '/signup',
  '/auth',
  '/admin',
  '/staff',
  '/pay',
  '/review',
  '/subscribe',
  '/birthday',
  '/wishlist',
  '/compare',
  '/dev',
  '/forms',
  '/r/',
]

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin()
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}
