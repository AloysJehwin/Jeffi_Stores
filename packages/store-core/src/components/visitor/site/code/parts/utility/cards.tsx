import type { ReactNode } from 'react'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getProductCardsByIds } from '@/lib/catalog/product-cards'
import { siteCard } from '@/lib/site/card'
import { inertCss } from '@/lib/site/code/allow'
import { siteData } from '@/lib/site/data'
import { ProductItem } from '../../common/SiteCard'
import { rowViews } from '../product/views'

// The products of an AI-designed wishlist or compare page drawn as the site card (lib/site/card.ts), or as the
// store's ProductCard when the store has none, keyed by product id so the page keeps its own controls around them.

export interface CardNodes {
  /** The site card's styles on their own: a list that hides some cards on the client (a stock filter) keeps them. */
  styles: ReactNode
  nodes: Record<string, ReactNode>
}

/** Card-ready product rows (product-cards.ts, the compare page's query) as cards by product id. */
export async function cardNodes(rows: any[], gstEnabled: boolean): Promise<CardNodes> {
  if (!rows.length) return { styles: null, nodes: {} }
  const [views, card] = await Promise.all([rowViews(rows, gstEnabled), siteCard()])
  const data = siteData()
  return {
    styles: card?.css ? <style dangerouslySetInnerHTML={{ __html: inertCss(card.css) }} /> : null,
    nodes: Object.fromEntries(views.map((v, i) => [v.id, <ProductItem key={v.id} product={v} card={card} data={data} deferred={i >= 4} priority={i === 0} />])),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Active products by id as cards (a server action's answer to the client's wishlist): public card data only. */
export async function productCardNodes(ids: unknown): Promise<CardNodes> {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 200) : []
  if (!list.length) return { styles: null, nodes: {} }
  const { gstEnabled } = await getFeatureFlags()
  return cardNodes(await getProductCardsByIds(list, gstEnabled), gstEnabled)
}
