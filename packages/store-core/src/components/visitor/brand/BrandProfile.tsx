import type { CSSProperties } from 'react'

// Brand page blocks for the profile columns (docs/BRAND_CATEGORY_PLAN.md §3.1). Server components;
// every block renders nothing when its fields are empty. Text is plain (no HTML injection).

export type BrandProfile = {
  name: string
  tagline?: string | null
  story?: string | null
  banner_desktop_url?: string | null
  banner_mobile_url?: string | null
  brand_color?: string | null
  founded_year?: number | string | null
  headquarters?: string | null
  country_of_origin?: string | null
  social_links?: unknown
  default_warranty_months?: number | string | null
  default_warranty_type?: string | null
  warranty_terms?: string | null
  service_phone?: string | null
  service_email?: string | null
  service_url?: string | null
  catalogue_pdf_url?: string | null
  seo_content?: string | null
}

const SOCIAL = [
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X'],
] as const

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const httpUrl = (v: unknown) => (/^https?:\/\//i.test(text(v)) ? text(v) : '')

/** Blank-line separated plain text → paragraphs. */
export function Paragraphs({ text: raw, className }: { text: string | null | undefined; className?: string }) {
  const paras = text(raw).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  if (paras.length === 0) return null
  return (
    <div className={className}>
      {paras.map((p, i) => (
        <p key={i} className="whitespace-pre-line text-foreground-secondary leading-relaxed [&+p]:mt-3">
          {p}
        </p>
      ))}
    </div>
  )
}

/** `{instagram, youtube, ...}` (object or JSON string) → [label, url] pairs, http(s) only. */
export function brandSocialLinks(raw: unknown): Array<[string, string]> {
  let obj: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object') obj = raw as Record<string, unknown>
  else if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { obj = null }
  }
  if (!obj) return []
  return SOCIAL.flatMap(([k, label]) => (httpUrl(obj![k]) ? [[label, httpUrl(obj![k])] as [string, string]] : []))
}

/** A valid #rrggbb / #rgb accent, else null (never an arbitrary string into a style attribute). */
export function brandAccent(color: unknown): string | null {
  const c = text(color)
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : null
}

export function countryName(code: string | null | undefined): string | null {
  const c = text(code).toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c
  } catch {
    return c
  }
}

export function BrandBanner({ brand }: { brand: BrandProfile }) {
  const desktop = httpUrl(brand.banner_desktop_url) || text(brand.banner_desktop_url)
  const mobile = httpUrl(brand.banner_mobile_url) || text(brand.banner_mobile_url) || desktop
  if (!desktop && !mobile) return null
  return (
    <div className="container mx-auto px-4 pt-4 sm:pt-6">
      <picture>
        {desktop && <source media="(min-width: 768px)" srcSet={desktop} />}
        <img src={mobile || desktop} alt={brand.name} className="w-full max-h-72 object-cover rounded-xl border border-border-default" />
      </picture>
    </div>
  )
}

/** Thin bar in the brand colour, only when one is set. */
export function BrandAccentBar({ color }: { color: unknown }) {
  const accent = brandAccent(color)
  if (!accent) return null
  return <div aria-hidden className="h-1 w-full" style={{ backgroundColor: accent } as CSSProperties} />
}

export function BrandFacts({ brand }: { brand: BrandProfile }) {
  const facts: Array<[string, string]> = []
  const founded = String(brand.founded_year ?? '').trim()
  if (/^\d{4}$/.test(founded)) facts.push(['Founded', founded])
  if (text(brand.headquarters)) facts.push(['Headquarters', text(brand.headquarters)])
  const origin = countryName(brand.country_of_origin)
  if (origin) facts.push(['Country of origin', origin])
  if (facts.length === 0) return null
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {facts.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="text-foreground-muted">{k}</dt>
          <dd className="text-foreground font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function BrandSocialLinks({ brand }: { brand: BrandProfile }) {
  const links = brandSocialLinks(brand.social_links)
  if (links.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2 text-sm">
      {links.map(([label, url]) => (
        <li key={label}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-full border border-border-default bg-surface-secondary px-3 py-1 text-foreground-secondary hover:text-accent-600 hover:border-accent-500"
          >
            {label}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function BrandStory({ brand }: { brand: BrandProfile }) {
  if (!text(brand.story)) return null
  return (
    <section className="mb-8">
      <h2 className="text-xl font-bold text-foreground mb-3">About {brand.name}</h2>
      <Paragraphs text={brand.story} className="max-w-3xl" />
    </section>
  )
}

const warrantyLabel = (months: unknown, type: unknown) => {
  const m = Number(months)
  const t = text(type).replace(/_/g, ' ')
  const span = Number.isFinite(m) && m > 0 ? (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`) : ''
  return [span, t].filter(Boolean).join(' ')
}

export function BrandWarrantyService({ brand }: { brand: BrandProfile }) {
  const warranty = warrantyLabel(brand.default_warranty_months, brand.default_warranty_type)
  const terms = text(brand.warranty_terms)
  const phone = text(brand.service_phone)
  const email = text(brand.service_email)
  const url = httpUrl(brand.service_url)
  const pdf = httpUrl(brand.catalogue_pdf_url)
  if (!warranty && !terms && !phone && !email && !url && !pdf) return null
  return (
    <section className="mb-8 rounded-lg border border-border-default bg-surface-elevated p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-3">Warranty &amp; service</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        {warranty && (
          <div>
            <dt className="text-xs text-foreground-muted">Standard warranty</dt>
            <dd className="text-foreground-secondary capitalize">{warranty}</dd>
          </div>
        )}
        {phone && (
          <div>
            <dt className="text-xs text-foreground-muted">Service phone</dt>
            <dd><a href={`tel:${phone.replace(/\s+/g, '')}`} className="text-accent-500 hover:text-accent-600">{phone}</a></dd>
          </div>
        )}
        {email && (
          <div>
            <dt className="text-xs text-foreground-muted">Service email</dt>
            <dd><a href={`mailto:${email}`} className="text-accent-500 hover:text-accent-600">{email}</a></dd>
          </div>
        )}
        {url && (
          <div>
            <dt className="text-xs text-foreground-muted">Support</dt>
            <dd><a href={url} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:text-accent-600 break-all">{url}</a></dd>
          </div>
        )}
        {pdf && (
          <div>
            <dt className="text-xs text-foreground-muted">Catalogue</dt>
            <dd><a href={pdf} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:text-accent-600">Download PDF</a></dd>
          </div>
        )}
      </dl>
      {terms && <Paragraphs text={terms} className="mt-3 text-sm" />}
    </section>
  )
}

/** Copy under the product grid (plain text paragraphs). */
export function SeoContent({ text: raw }: { text: string | null | undefined }) {
  if (!text(raw)) return null
  return (
    <section className="mt-10 border-t border-border-default pt-8">
      <Paragraphs text={raw} className="max-w-3xl text-sm" />
    </section>
  )
}
