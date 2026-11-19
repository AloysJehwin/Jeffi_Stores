import { z } from 'zod'
import { defineCodeComponent } from '../registry'
import {
  CartEmptyPart,
  CartLinesPart,
  CartSummaryPart,
  CartUpsellPart,
  CheckoutButtonPart,
  CouponBoxPart,
  FreeShippingPart,
} from '@/components/visitor/site/code/parts/cart/parts'
import { previewLines } from '@/components/visitor/site/code/parts/cart/demo'
import { ProductItem, SiteCardStyles } from '@/components/visitor/site/code/common/SiteCard'
import { siteCard } from '../../card'

// The cart page's parts (Part C). They share the page's one cart state, mounted by the storefront cart page, so they
// work in any order; in the studio preview they show sample lines.

export const cls = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
export function settings<S extends z.ZodTypeAny>(schema: S, props: Record<string, unknown>): z.infer<S> {
  const r = schema.safeParse(props)
  return r.success ? r.data : schema.parse({})
}

/** The `<Products>` item fields, for render functions over catalogue products. */
export const PRODUCT_BINDING: Record<string, string> = {
  id: 'product id',
  slug: 'url slug',
  name: 'product name',
  url: 'link to the product page',
  image: 'image URL or null',
  hoverImage: 'second image URL or null',
  price: '{ formatted: "₹1,299", value: 1299 }',
  mrp: '{ formatted, value } when on sale, else null',
  discountPct: 'percent off MRP, 0 when not on sale',
  badge: 'badge text or null',
  brand: 'brand name or null',
  category: 'category name or null',
  inStock: 'true when in stock',
  rating: 'average rating or null',
  reviewCount: 'number of reviews',
}

const CartLinesProps = z.object({
  variant: z.enum(['list', 'cards']).default('list').describe('rows, or a grid of cards'),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(2).describe('cards per row from tablet up'),
  saved: z.boolean().default(true).describe('also list the saved-for-later items'),
})

defineCodeComponent({
  name: 'CartLines',
  pages: ['cart'],
  required: ['cart'],
  props: CartLinesProps,
  describe: "The shopper's cart lines with quantity, save for later and remove (the store's own cart); nothing when the cart is empty.",
  render: async (props, ctx) => {
    const s = settings(CartLinesProps, props)
    return <CartLinesPart variant={s.variant} columns={s.columns} saved={s.saved} className={cls(props.className)} demo={await previewLines(ctx.data)} />
  },
})

defineCodeComponent({
  name: 'CartSummary',
  pages: ['cart'],
  props: z.object({}),
  describe: 'Subtotal, GST, the applied coupon and the total, as rows; style the box around it.',
  render: async (props, ctx) => <CartSummaryPart className={cls(props.className)} demo={await previewLines(ctx.data)} />,
})

defineCodeComponent({
  name: 'CouponBox',
  pages: ['cart', 'checkout'],
  props: z.object({}),
  describe: 'On the cart: the coupon field with offers and the shopper\'s coupons. At checkout: the coupon carried from the cart.',
  render: (props, ctx) => <CouponBoxPart className={cls(props.className)} demo={ctx.page === 'cart' || ctx.page === null} />,
})

defineCodeComponent({
  name: 'FreeShippingProgress',
  pages: ['cart'],
  props: z.object({}),
  describe: "A bar showing how much more to add for free delivery (the store's own threshold); nothing when the store has none.",
  render: async (props, ctx) => <FreeShippingPart className={cls(props.className)} demo={await previewLines(ctx.data)} />,
})

const CheckoutButtonProps = z.object({ label: z.string().trim().max(40).optional().describe('button text, default "Proceed to Checkout"') })

defineCodeComponent({
  name: 'CheckoutButton',
  pages: ['cart'],
  required: ['cart'],
  props: CheckoutButtonProps,
  describe: 'The checkout button (sign in first when signed out) plus the phone bottom bar with the total. Place it once.',
  render: async (props, ctx) => {
    const s = settings(CheckoutButtonProps, props)
    return <CheckoutButtonPart label={s.label} className={cls(props.className)} demo={(await previewLines(ctx.data)).length > 0} />
  },
})

defineCodeComponent({
  name: 'CartEmpty',
  pages: ['cart'],
  props: z.object({}),
  describe: "Shown only when the cart has no lines: its children (your empty-cart design), or the store's empty cart when it has none.",
  render: (props, ctx) => <CartEmptyPart className={cls(props.className)}>{ctx.children}</CartEmptyPart>,
})

const CartUpsellProps = z.object({
  limit: z.number().int().min(1).max(8).default(4).describe('products shown'),
  layout: z.enum(['grid', 'carousel']).default('grid').describe('grid: className is the grid; carousel: each product a slide'),
  itemClassName: z.string().max(200).optional().describe('carousel slide widths, e.g. "w-[80%] md:w-[30%]"'),
})

defineCodeComponent({
  name: 'CartUpsell',
  pages: ['cart'],
  props: CartUpsellProps,
  binding: PRODUCT_BINDING,
  describe:
    "Best sellers to add, skipping what is already in the cart, each as the site's product card (with add to cart); className lays out the list. A render function replaces the card: give it QuickAdd so it can still be added.",
  count: async (props, data) => (await data.products({ sort: 'best_sellers', limit: Math.min(24, settings(CartUpsellProps, props).limit + 8) }).catch(() => [])).length,
  render: async (props, ctx) => {
    const { limit, layout, itemClassName } = settings(CartUpsellProps, props)
    const candidates = await ctx.data.products({ sort: 'best_sellers', limit: Math.min(24, limit + 8) }).catch(() => [])
    const card = ctx.renderItem ? null : await siteCard(ctx.data)
    const items = candidates.map((p, i) => ({
      id: p.id,
      node: ctx.renderItem ? ctx.renderItem(p, i) : <ProductItem product={p} card={card} data={ctx.data} deferred />,
    }))
    return (
      <>
        {card && <SiteCardStyles card={card} />}
        <CartUpsellPart items={items} limit={limit} className={cls(props.className)} carousel={layout === 'carousel' ? { itemClassName } : null} />
      </>
    )
  },
})
