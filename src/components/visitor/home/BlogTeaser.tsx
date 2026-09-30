import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import StoreImage from '@/components/visitor/StoreImage'
import { SECTION_COPY_DEFAULTS } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.blog_teaser

export interface BlogTeaserItem {
  title: string
  excerpt: string
  url: string
  imageUrl: string
}

const isExternal = (url: string) => /^https?:\/\//i.test(url)

interface BlogTeaserProps {
  items: BlogTeaserItem[]
  eyebrow?: string | null
  title?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
}

export default function BlogTeaser({ items, eyebrow, title, ctaLabel, ctaUrl }: BlogTeaserProps) {
  return (
    <section className="py-12 md:py-16 bg-surface">
      <div className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-7 gap-4">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
              {eyebrow ?? COPY.eyebrow}
            </p>
            <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
          </div>
          {ctaUrl && ctaLabel && (
            <Link
              href={ctaUrl}
              className="hidden sm:inline-flex text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0"
            >
              {ctaLabel}
            </Link>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item, i) => (
            <Link
              key={`${item.url}-${i}`}
              href={item.url}
              {...(isExternal(item.url) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="group flex flex-col rounded-2xl border border-border-default bg-surface-elevated overflow-hidden hover:shadow-md hover:border-accent-300 transition-all"
            >
              <div className="relative aspect-[16/9] bg-surface-secondary overflow-hidden">
                {item.imageUrl ? (
                  <StoreImage
                    src={item.imageUrl}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BookOpen className="w-10 h-10 text-foreground-muted" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-2 p-5">
                <h3 className="font-bold text-foreground group-hover:text-accent-600 transition-colors line-clamp-2">
                  {item.title}
                </h3>
                {item.excerpt && <p className="text-sm text-foreground-secondary line-clamp-3">{item.excerpt}</p>}
                <span className="mt-auto pt-2 text-sm font-semibold text-accent-500">Read more</span>
              </div>
            </Link>
          ))}
        </div>
        {ctaUrl && ctaLabel && (
          <div className="sm:hidden text-center mt-6">
            <Link href={ctaUrl} className="text-sm text-accent-500 font-semibold">
              {ctaLabel}
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}
