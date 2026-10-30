'use client'

import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import {
  businessSectionPublic,
  safeHref,
  sectionAspect,
  sectionCopyDefaults,
  sectionLayout,
} from '@/lib/catalog/homepage-sections'
import { useBusinessHome } from './BusinessHomeProvider'
import { SectionHeading, SignInPrompt, SkeletonBlocks, ViewAllLink } from './parts'
import type { BusinessSection } from './business-home'

const GRID = 'grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5'

/** Reorder and Business offers: a row of the business's own products at business prices. */
export default function BusinessProducts({ section }: { section: BusinessSection }) {
  const { status, data, href } = useBusinessHome()
  const pub = businessSectionPublic(section)
  if (!pub) return null
  const reorder = section.type === 'business_reorder'
  const copy = sectionCopyDefaults(section.type)
  const eyebrow = section.eyebrow ?? copy.eyebrow
  const title = section.title ?? copy.title

  if (status === 'visitor') {
    if (pub.visitor !== 'signin') return null
    return (
      <SignInPrompt
        eyebrow={eyebrow}
        title={title}
        message={
          reorder
            ? 'Sign in to your business account to reorder the products you buy most.'
            : 'Sign in to your business account to see your business prices.'
        }
      />
    )
  }
  if (status === 'error') return null

  const cards = (reorder ? data?.reorder : data?.offers?.[section.id]) ?? []
  if (status === 'ready' && cards.length === 0) return null

  const ctaUrl = safeHref(section.cta_url)
  const viewAll = ctaUrl
    ? { href: ctaUrl.startsWith('/business') ? href(ctaUrl) : ctaUrl, label: section.cta_label ?? 'View all' }
    : reorder
      ? null
      : { href: href('/business/products'), label: 'View all' }
  const aspect = sectionAspect(section)

  const items = cards.map(p => <ProductCard key={p.id} {...p} portal="business" imageAspect={aspect} />)

  return (
    <section className="py-12 md:py-20 bg-surface">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          action={viewAll && <ViewAllLink href={viewAll.href} label={viewAll.label} />}
        />
        {status === 'loading' ? (
          <div className={GRID}>
            <SkeletonBlocks count={4} className="aspect-[3/4]" />
          </div>
        ) : sectionLayout(section) === 'carousel' ? (
          <SectionCarousel ariaLabel={title ?? ''}>{items}</SectionCarousel>
        ) : (
          <div className={GRID}>{items}</div>
        )}
      </div>
    </section>
  )
}
