import type { MetadataRoute } from 'next'
import { schemes } from '@jeffi/design-tokens'
import { getStoreIdentity, getStorefrontContent } from '@/lib/catalog/site-controls'

/** The storefront's web app manifest: "Add to Home Screen" opens the store like an app. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const identity = await getStoreIdentity()
  const content = await getStorefrontContent()
  const name = identity.name?.trim() || 'Store'
  const logo = identity.logoUrl?.trim()

  return {
    name,
    short_name: name.length > 12 ? name.split(/\s+/)[0].slice(0, 12) : name,
    description: content.metaDescription?.trim() || content.metaTagline?.trim() || `Shop online at ${name}.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: schemes.light.surface,
    theme_color: schemes.light.surfaceElevated,
    // Same choice as the tab icon in app/layout.tsx: the tenant's logo, else the platform icons.
    icons: logo
      ? [{ src: logo, sizes: 'any', purpose: 'any' }]
      : [
          { src: '/icon.png', sizes: '192x192', type: 'image/png' },
          { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
        ],
  }
}
