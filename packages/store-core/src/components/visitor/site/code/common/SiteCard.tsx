import * as React from 'react'
import { CARD_PAGE, CARD_PRODUCT } from '@/lib/site/code/ast'
import { inertCss } from '@/lib/site/code/allow'
import { money } from '@/lib/site/data/format'
import type { ProductView, SiteCardSection, SiteData } from '@/lib/site/data/types'
import { ProductTile } from './tiles'

// The site card (lib/site/card.ts) drawn for one product, and the choice every product list makes between it and the
// store's ProductCard. Server-rendered: the interpreter draws the card's AST with the product bound to its parameter.

const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const written = typeof reactCache === 'function' ? reactCache((): Set<string> => new Set()) : null

/** Whether a card's styles still have to go into this response: once per request, so a grid of cards carries one copy. */
function firstStyles(id: string): boolean {
  let seen: Set<string> | null = null
  try {
    seen = written?.() ?? null
  } catch {
    seen = null
  }
  if (!seen) return true
  if (seen.has(id)) return false
  seen.add(id)
  return true
}

/** One product drawn with the site card. `priority`: the first card on the page, whose picture loads eagerly. */
export async function SiteCardView({ card, product, data, priority = false }: { card: SiteCardSection; product: ProductView; data: SiteData; priority?: boolean }) {
  // Loaded here, not imported: the interpreter loads the part library, whose parts render this.
  const { makeEnv, renderNode } = await import('../interpret')
  const env = makeEnv({ data, page: CARD_PAGE, sectionId: card.id, priority })
  env.vars.set(CARD_PRODUCT, product)
  const css = firstStyles(card.id) ? inertCss(card.css) : ''
  // relative: the card's stretched link covers this card even when its root forgot to be positioned.
  return (
    <div data-site-card={card.id} className="relative h-full">
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      {renderNode(card.ast, env)}
    </div>
  )
}

/**
 * The card's styles on their own. The storefront's root layout puts them in <head> (`always`): the first card of a
 * request can sit in a tree the browser never shows, such as the 404 page's product list, which every route carries in
 * case it 404s, and every shown card would then go without them. Elsewhere (the cart's suggestions), once per request.
 */
export function SiteCardStyles({ card, always = false }: { card: SiteCardSection; always?: boolean }) {
  if (!firstStyles(card.id) && !always) return null
  const css = inertCss(card.css)
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null
}

/** A product as the site card when there is one, else as the store's ProductCard. */
export function ProductItem({
  product,
  card,
  data,
  aspect,
  deferred,
  priority,
}: {
  product: ProductView
  card: SiteCardSection | null
  data: SiteData
  aspect?: string
  deferred?: boolean
  priority?: boolean
}) {
  if (!product || typeof product !== 'object' || typeof product.slug !== 'string') return null
  return card ? <SiteCardView card={card} product={product} data={data} priority={priority} /> : <ProductTile product={product} aspect={aspect} deferred={deferred} />
}

/** Stands in for a product while a store has none, so the card can be seen. */
const STAND_IN: ProductView = {
  id: 'sample-card',
  slug: 'sample-card',
  name: 'Your product name',
  url: '#',
  image: null,
  hoverImage: null,
  price: money(1299),
  mrp: money(1599),
  discountPct: 19,
  badge: '19% off',
  brand: 'Brand',
  category: 'Category',
  inStock: true,
  rating: 4.5,
  reviewCount: 12,
  hasVariants: false,
  brandSlug: null,
  categorySlug: null,
  categoryId: null,
  isDigital: false,
}

/** The card page itself (the studio's or Site Builder's view of it): the card drawn for a few of the catalogue's products. */
export async function CardSamples({ card, data }: { card: SiteCardSection; data: SiteData }) {
  const list = await data.products({ sort: 'featured', limit: 4 }).catch(() => [] as ProductView[])
  const shown = list.length ? list : [STAND_IN]
  // The stand-in has nothing behind it: its buttons draw inert.
  const src = list.length ? data : { ...data, sample: true }
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3 px-4 py-8 md:grid-cols-4 md:gap-5">
      {shown.map((v, i) => (
        <SiteCardView key={v.id} card={card} product={v} data={src} priority={i === 0} />
      ))}
    </div>
  )
}
