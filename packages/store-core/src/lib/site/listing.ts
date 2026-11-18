import type { PageDoc } from '@jeffi/site-blocks'

export const LISTING_PAGES = ['products', 'category', 'brand'] as const
export const isListingKey = (page: string) => (LISTING_PAGES as readonly string[]).includes(page)

/** The listing's "between products" sections as a document of their own (their order, the doc's blocks). */
export function listingBetweenDoc(doc: PageDoc): PageDoc {
  const core = Object.values(doc.blocks).find(b => b.type === 'listing_main')
  if (!core) return doc
  return { ...doc, order: (core.children?.between ?? []).filter(id => doc.blocks[id]) }
}

/** A listing layout from before the slot (only between-products sections) wrapped in its core block. */
export function wrapListingDoc(doc: PageDoc, newId: () => string): PageDoc {
  if (Object.values(doc.blocks).some(b => b.type === 'listing_main')) return doc
  const id = newId()
  return { ...doc, blocks: { ...doc.blocks, [id]: { id, type: 'listing_main', v: 1, props: {}, children: { between: [...doc.order] } } }, order: [id] }
}
