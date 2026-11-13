// <head> metadata and BreadcrumbList JSON-LD for listing pages (products, categories, brands).
import type { Metadata } from 'next'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { siteOrigin } from '@/app-shell/site-origin'

const clip = (text: string | null | undefined, max = 160) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export async function listingMetadata(opts: {
  title: string
  description?: string | null
  fallbackDescription: string
  path: string
  image?: string | null
  noindex?: boolean
}): Promise<Metadata> {
  const [identity, origin] = await Promise.all([getStoreIdentity(), siteOrigin()])
  const description = clip(opts.description) || clip(opts.fallbackDescription)
  const url = `${origin}${opts.path}`
  return {
    title: `${opts.title} | ${identity.name}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: opts.title,
      description,
      url,
      type: 'website',
      ...(opts.image ? { images: [{ url: opts.image, alt: opts.title }] } : {}),
    },
    ...(opts.noindex ? { robots: { index: false, follow: true } } : {}),
  }
}

/** schema.org BreadcrumbList; the last crumb (the page itself) may omit its path. */
export async function breadcrumbJsonLd(items: Array<{ name: string; path?: string }>) {
  const origin = await siteOrigin()
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      ...(crumb.path ? { item: `${origin}${crumb.path}` } : {}),
    })),
  }
}

/** Safe body for <script type="application/ld+json">. */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')
