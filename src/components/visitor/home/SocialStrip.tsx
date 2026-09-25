import Link from 'next/link'
import StoreImage from '@/components/visitor/StoreImage'
import { SECTION_COPY_DEFAULTS } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.social_strip

export interface SocialStripItem {
  imageUrl: string
  url: string
  caption: string
}

const isExternal = (url: string) => /^https?:\/\//i.test(url)
const externalProps = (url: string) => (isExternal(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {})

interface SocialStripProps {
  items: SocialStripItem[]
  eyebrow?: string | null
  title?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
}

export default function SocialStrip({ items, eyebrow, title, ctaLabel, ctaUrl }: SocialStripProps) {
  return (
    <section className="py-12 md:py-16 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-7">
          <div>
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{eyebrow ?? COPY.eyebrow}</p>
            <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
          </div>
          {ctaUrl && (
            <Link
              href={ctaUrl}
              {...externalProps(ctaUrl)}
              className="self-start sm:self-auto inline-flex items-center px-5 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold transition-colors"
            >
              {ctaLabel ?? COPY.ctaLabel}
            </Link>
          )}
        </div>
        <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3 overflow-x-auto sm:overflow-visible snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
          {items.map((item, i) => (
            <Link
              key={`${item.url}-${i}`}
              href={item.url}
              {...externalProps(item.url)}
              aria-label={item.caption || 'Open post'}
              className="group relative shrink-0 w-40 sm:w-auto aspect-square rounded-xl overflow-hidden bg-surface snap-start"
            >
              <StoreImage src={item.imageUrl} alt={item.caption} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              {item.caption && (
                <span className="absolute inset-x-0 bottom-0 p-2 text-xs text-white bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity line-clamp-2">
                  {item.caption}
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
