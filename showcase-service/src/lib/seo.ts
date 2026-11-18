import type { Metadata } from 'next'
import { businessView, workViews } from '@/lib/showcase/views'
import type { ShowcaseSiteRow } from '@/lib/showcase/store'

// Title, description and share cards from the business, and its LocalBusiness record for search engines.

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export function siteMetadata(site: ShowcaseSiteRow, origin: string): Metadata {
  const b = businessView(site.business)
  const lead = b.tagline || b.profession
  const title = lead ? `${b.name} – ${lead}` : b.name
  const where = b.location ? ` in ${b.location}` : ''
  const description = clip(b.about || [b.tagline, b.profession && `${b.profession}${where}`].filter(Boolean).join('. ') || `${b.name}${where}.`, 160)
  const image = b.logo || workViews(site.content)[0]?.image || null
  const abs = (u: string) => (u.startsWith('/') ? `${origin}${u}` : u)
  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: { canonical: '/' },
    robots: site.status === 'live' && !site.workspaceSuspended ? { index: true, follow: true } : { index: false, follow: false },
    icons: b.logo ? { icon: abs(b.logo), apple: abs(b.logo) } : undefined,
    openGraph: { type: 'website', url: '/', siteName: b.name, title, description, ...(image ? { images: [{ url: abs(image) }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [abs(image)] } : {}) },
  }
}

/** schema.org LocalBusiness, as JSON safe to put in a script tag. */
export function localBusinessJsonLd(site: ShowcaseSiteRow, origin: string): string {
  const b = businessView(site.business)
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: b.name,
    url: `${origin}/`,
    ...(b.about || b.tagline ? { description: clip(b.about || b.tagline, 300) } : {}),
    ...(b.logo ? { image: b.logo.startsWith('/') ? `${origin}${b.logo}` : b.logo, logo: b.logo.startsWith('/') ? `${origin}${b.logo}` : b.logo } : {}),
    ...(b.phone ? { telephone: b.phone } : {}),
    ...(b.email ? { email: b.email } : {}),
    ...(b.address || b.city
      ? { address: { '@type': 'PostalAddress', ...(b.address ? { streetAddress: b.address } : {}), ...(b.city ? { addressLocality: b.city } : {}), ...(b.state ? { addressRegion: b.state } : {}), ...(b.pincode ? { postalCode: b.pincode } : {}), addressCountry: 'IN' } }
      : {}),
    ...(b.mapUrl ? { hasMap: b.mapUrl } : {}),
    ...(b.socials.length ? { sameAs: b.socials.map(s => s.href) } : {}),
  }
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
