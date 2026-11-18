import { z } from 'zod'
import type { PageKey } from '@jeffi/site-blocks'
import { defineCodeComponent } from '../registry'
import { PRODUCT_VIEW_BINDING } from './product'
import { listingParts } from '@/components/visitor/site/code/parts/listing/context'
import { FiltersPart, ResultCountPart, SortMenuPart } from '@/components/visitor/site/code/parts/listing/pieces'
import { renderListingPreview, renderResults } from '@/components/visitor/site/code/parts/listing/server'

// The listing pages' parts (Part B): all products, search results, category, brand and the business catalogue. The
// page mounts its ListingPageParts, so the parts read one listing; filters and sort live in the URL.

const LISTING: PageKey[] = ['products', 'search', 'category', 'brand', 'catalog']

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)

defineCodeComponent({
  name: 'Filters',
  pages: LISTING,
  props: z.object({ layout: z.enum(['sidebar', 'drawer', 'top']).default('sidebar') }),
  describe:
    'The listing filters (price, brand, category, colour, stock, offers, specs): sidebar (a column on desktop, a sheet on phones), drawer (a Filters button opening a sheet, with sort, at every width) or top (that button with in-stock and on-sale chips). Nothing where the page has no filters.',
  render: (props, ctx) =>
    listingParts() ? (
      <FiltersPart layout={props.layout as 'sidebar' | 'drawer' | 'top' | undefined} className={str(props.className)} />
    ) : (
      renderListingPreview('Filters', ctx, props)
    ),
})

defineCodeComponent({
  name: 'SortMenu',
  pages: LISTING,
  props: z.object({}),
  describe: 'The sort dropdown (featured, newest, price, discount, name…).',
  render: (props, ctx) => (listingParts() ? <SortMenuPart className={str(props.className)} /> : renderListingPreview('SortMenu', ctx, props)),
})

defineCodeComponent({
  name: 'ResultCount',
  pages: LISTING,
  props: z.object({ noun: z.string().trim().min(1).max(24).default('products'), range: z.boolean().default(false) }),
  describe: 'How many products were found: "240 products", or "Showing 1–60 of 240 products" with range.',
  render: (props, ctx) =>
    listingParts() ? (
      <ResultCountPart noun={str(props.noun)} range={props.range === true} className={str(props.className)} />
    ) : (
      renderListingPreview('ResultCount', ctx, props)
    ),
})

defineCodeComponent({
  name: 'ProductResults',
  pages: LISTING,
  required: LISTING,
  props: z.object({
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    controls: z.boolean().default(false),
    emptyText: z.string().trim().min(1).max(160).optional(),
  }),
  binding: PRODUCT_VIEW_BINDING,
  describe:
    "The listing's products as the site's product cards, loading more as the shopper scrolls, with the store's sections between them. columns (or className) sets the grid; controls adds the group, grid/table and sort bar. Give no render function: one replaces the card and turns the endless scroll into page links.",
  render: (props, ctx) => renderResults(ctx, props),
})
