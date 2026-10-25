'use client'

import { useEffect, useState } from 'react'
import { Link2, Package } from 'lucide-react'
import AdminImage from '@/components/admin/AdminImage'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import SlidesSection from '@/components/visitor/home/SlidesSection'
import {
  motionHeroSlides,
  rowSurface,
  slidesConfig,
  spotlightConfig,
  storyGroups,
  type HomepageSection,
  type PreviewItem,
  type SlidesData,
} from '@/lib/catalog/homepage-sections'

type PreviewKind =
  | 'products'
  | 'categories'
  | 'brands'
  | 'hero'
  | 'offers'
  | 'about'
  | 'reviews'
  | 'links'
  | 'stats'
  | 'stories'
  | 'slides'
  | 'none'

interface PreviewResponse {
  kind: PreviewKind
  items: PreviewItem[]
  note?: string
  slides?: SlidesData
}

const KIND_LABEL: Record<Exclude<PreviewKind, 'none'>, string> = {
  products: 'products',
  categories: 'categories',
  brands: 'brands',
  hero: 'slides',
  offers: 'offers',
  about: 'items',
  reviews: 'reviews',
  links: 'items',
  stats: 'numbers',
  stories: 'stories',
  slides: 'slides',
}

// The preview route's cap on `config`.
const CONFIG_MAX = 8000
const clip = (s: string | null, max: number) => s?.slice(0, max)

// Each slide keeps only what its card draws: a reference, or one image (the one its shape shows)
// and trimmed text. Trailing slides drop if a long config still runs over.
function slidesPreviewConfig(section: HomepageSection): Record<string, unknown> {
  const { items, ...settings } = slidesConfig(section)
  const portrait = settings.layout !== 'banner' && settings.aspect !== '16:9'
  const slim = items.map(i => {
    if (i.kind === 'offer') return { kind: i.kind, offerId: i.offerId }
    if (i.kind === 'category') return { kind: i.kind, categoryId: i.categoryId }
    if (i.kind === 'product') return { kind: i.kind, productId: i.productId }
    return {
      kind: i.kind,
      image: (portrait && i.imageCard) || i.image,
      title: clip(i.title, 100),
      eyebrow: clip(i.eyebrow, 40),
      sub: clip(i.sub, 120),
      ctaLabel: clip(i.ctaLabel, 40),
      motion: i.motion,
    }
  })
  const config = { ...settings, items: slim }
  while (slim.length > 1 && JSON.stringify(config).length > CONFIG_MAX) slim.pop()
  return config
}

// The route caps `config` at 8000 chars, so media-heavy sections send only what their preview
// draws (validated through the same readers the storefront uses). Other types send it whole.
function previewConfig(section: HomepageSection): Record<string, unknown> {
  switch (section.type) {
    case 'motion_hero':
      return { slides: motionHeroSlides(section).map(s => ({ bgImage: s.bgImage, headline: s.headline })) }
    case 'stories':
      return {
        groups: storyGroups(section).map(g => ({
          title: g.title,
          cover: g.cover,
          slides: [{ image: g.slides[0]?.image }],
        })),
      }
    case 'product_spotlight':
      return { productId: spotlightConfig(section).productId }
    case 'slides':
      return slidesPreviewConfig(section)
    default:
      return section.config ?? {}
  }
}

// Tiles draw what the storefront draws: category icons, brand initials, and an icon instead of
// an empty box when an item has no image.
function PreviewTile({ kind, item }: { kind: Exclude<PreviewKind, 'none'>; item: PreviewItem }) {
  if (item.value) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-primary-500/10 px-1">
        <span className="text-primary-700 dark:text-primary-300 text-sm font-black truncate">{item.value}</span>
      </div>
    )
  }
  if (kind === 'brands') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-accent-500/10">
        <span className="text-accent-600 dark:text-accent-400 text-sm font-black">
          {item.name.slice(0, 2).toUpperCase()}
        </span>
      </div>
    )
  }
  const icon =
    kind === 'categories' ? (
      <CategoryIcon categoryName={item.name} className="w-7 h-7 text-primary-600 dark:text-primary-400" />
    ) : kind === 'hero' || kind === 'stories' ? undefined : kind === 'links' ? (
      <Link2 className="w-6 h-6 text-foreground-muted" aria-hidden="true" />
    ) : (
      <Package className="w-6 h-6 text-foreground-muted" aria-hidden="true" />
    )
  return <AdminImage src={item.image_url} alt="" className="w-full h-full object-cover" fallback={icon} />
}

export default function SectionPreview({ section }: { section: HomepageSection }) {
  const [data, setData] = useState<PreviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const configKey = JSON.stringify(previewConfig(section))

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(false)

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ type: section.type, config: configKey, surface: rowSurface(section) })
        const res = await fetch(`/api/admin/homepage/preview?${params.toString()}`, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('failed')
        const json = (await res.json()) as PreviewResponse
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled && !(e instanceof DOMException && e.name === 'AbortError')) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 400)

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [section.type, configKey, section.surface])

  const hero = section.type === 'hero' || section.type === 'motion_hero'

  if (loading && !data) {
    return <p className="text-xs text-foreground-muted py-2">Loading live preview…</p>
  }
  if (error) {
    return <p className="text-xs text-foreground-muted py-2">Preview unavailable right now.</p>
  }
  if (data?.note && data.items.length === 0) {
    return <p className="text-xs text-foreground-muted py-2">{data.note}</p>
  }
  if (!data || data.kind === 'none') {
    return (
      <p className="text-xs text-foreground-muted py-2">This section has no product or media content to preview.</p>
    )
  }
  if (data.items.length === 0) {
    return (
      <p className="text-xs text-foreground-muted py-2">
        Nothing to show yet — no matching {KIND_LABEL[data.kind]} are live.
      </p>
    )
  }

  if (data.kind === 'slides' && data.slides) {
    return (
      <div className="rounded-lg border border-border-default p-2.5">
        <p className="text-[11px] uppercase tracking-wide text-foreground-muted mb-2">
          Live preview · {data.slides.slides.length} {KIND_LABEL.slides}
        </p>
        <div className="overflow-hidden rounded-lg">
          <SlidesSection data={data.slides} eyebrow={section.eyebrow} title={section.title} preview />
        </div>
      </div>
    )
  }

  const kind = data.kind
  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-foreground-muted mb-2">
        Live preview · {data.items.length} {KIND_LABEL[kind]}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.items.map(item => (
          <div key={item.id} className="shrink-0 w-20">
            <div className={`w-20 overflow-hidden rounded bg-surface ${hero ? 'aspect-video' : 'aspect-square'}`}>
              <PreviewTile kind={kind} item={item} />
            </div>
            <span className="mt-1 block text-[11px] text-foreground truncate" title={item.name}>
              {item.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
