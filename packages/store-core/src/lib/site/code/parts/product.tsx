import { z } from 'zod'
import type { PageKey } from '@jeffi/site-blocks'
import { defineCodeComponent } from '../registry'
import { productParts } from '@/components/visitor/site/code/parts/product/context'
import {
  AddToCartPart,
  BuyNowPart,
  DeliveryCheckPart,
  ProductGalleryPart,
  ProductPricePart,
  ProductRatingPart,
  QuantityPickerPart,
  VariantPickerPart,
  WishlistButtonPart,
} from '@/components/visitor/site/code/parts/product/pieces'
import {
  renderDescription,
  renderPreview,
  renderProductBinding,
  relatedCount,
  renderRelated,
  renderReviews,
  renderSpecs,
  renderTitle,
} from '@/components/visitor/site/code/parts/product/server'

// The product page's parts (Part B). The page mounts one ProductPageProvider (ProductPageParts), so the interactive
// parts share the selection and quantity wherever the sections put them. Off a product page (the onboarding preview)
// the interactive ones show an inert look-alike of the catalogue's first product.

const PRODUCT: PageKey[] = ['product']

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const label = z.string().trim().min(1).max(40).optional()

/** A product's fields in render functions (`{p => …}`): the `<Products>` binding. */
export const PRODUCT_VIEW_BINDING: Record<string, string> = {
  id: 'product id',
  slug: 'URL slug',
  name: 'product name',
  url: 'product page path, for <Link href>',
  image: 'main image URL, or null',
  hoverImage: 'second image URL, or null',
  price: '{ value: number, formatted: "₹1,299" }',
  mrp: '{ value, formatted } list price, or null when not discounted',
  discountPct: 'whole percent off MRP, 0 when none',
  badge: '"20% off" | "New" | "Featured" | null',
  brand: 'brand name, or null',
  category: 'category name, or null',
  inStock: 'boolean',
  rating: 'average stars (1 decimal), or null',
  reviewCount: 'number of reviews',
}

defineCodeComponent({
  name: 'Product',
  pages: PRODUCT,
  props: z.object({}),
  binding: {
    ...PRODUCT_VIEW_BINDING,
    images: 'every image URL (string[])',
    description: 'full description text',
    shortDescription: 'one-line summary, may be empty',
    attributes: 'specifications as { name, value }[]',
  },
  describe:
    'The current product as data: {p => …} renders once with its fields. Prices here are the base price; use <ProductPrice> for the live price of the chosen variant.',
  render: (props, ctx) => renderProductBinding(ctx, props.className),
})

defineCodeComponent({
  name: 'ProductGallery',
  pages: PRODUCT,
  props: z.object({ layout: z.enum(['carousel', 'grid', 'stacked']).default('carousel'), media: z.boolean().default(true) }),
  describe:
    "The product's pictures with zoom and a full-screen viewer, following the chosen variant: carousel (main image and thumbnails, swipe on phones), grid (two columns) or stacked. media adds videos, 3D and documents.",
  render: (props, ctx) =>
    productParts() ? (
      <ProductGalleryPart layout={props.layout as 'carousel' | 'grid' | 'stacked' | undefined} media={props.media !== false} className={str(props.className)} />
    ) : (
      renderPreview('ProductGallery', ctx, props)
    ),
})

defineCodeComponent({
  name: 'ProductTitle',
  pages: PRODUCT,
  props: z.object({ as: z.enum(['h1', 'h2']).default('h1') }),
  describe: 'The product name as the page heading; className replaces its default style.',
  render: (props, ctx) => renderTitle(ctx, props),
})

defineCodeComponent({
  name: 'ProductPrice',
  pages: PRODUCT,
  props: z.object({ size: z.enum(['full', 'compact']).default('full') }),
  describe:
    'The live price of the chosen variant: full (price, MRP struck through, per-unit price, total for the quantity, savings, tax note) or compact (the price line with % off).',
  render: (props, ctx) =>
    productParts() ? <ProductPricePart size={props.size === 'compact' ? 'compact' : 'full'} className={str(props.className)} /> : renderPreview('ProductPrice', ctx, props),
})

defineCodeComponent({
  name: 'ProductRating',
  pages: PRODUCT,
  props: z.object({}),
  describe: 'Stars, average and review count, linking to the reviews; nothing when the product has no reviews.',
  render: (props, ctx) => (productParts() ? <ProductRatingPart className={str(props.className)} /> : renderPreview('ProductRating', ctx, props)),
})

defineCodeComponent({
  name: 'VariantPicker',
  pages: PRODUCT,
  props: z.object({ style: z.enum(['buttons', 'swatches', 'dropdown']).default('buttons') }),
  describe:
    'The variant and sub-variant choice (size, colour, length…) as buttons, round swatches or a dropdown; price, gallery, stock and add to cart follow it. Nothing when the product has no variants.',
  render: (props, ctx) =>
    productParts() ? (
      <VariantPickerPart style={props.style as 'buttons' | 'swatches' | 'dropdown' | undefined} className={str(props.className)} />
    ) : (
      renderPreview('VariantPicker', ctx, props)
    ),
})

defineCodeComponent({
  name: 'QuantityPicker',
  pages: PRODUCT,
  props: z.object({ stock: z.boolean().default(true) }),
  describe: "Quantity stepper in the product's selling unit; stock adds in/out of stock and the delivery date.",
  render: (props, ctx) =>
    productParts() ? <QuantityPickerPart stock={props.stock !== false} className={str(props.className)} /> : renderPreview('QuantityPicker', ctx, props),
})

defineCodeComponent({
  name: 'AddToCart',
  pages: PRODUCT,
  required: PRODUCT,
  props: z.object({ label, viewCart: z.boolean().default(true), sticky: z.boolean().default(true) }),
  describe:
    'The Add to cart button (Buy Now for digital products) with coming-soon notices, buy once or subscribe, a View cart link (viewCart) and a bottom bar that appears once it scrolls away (sticky).',
  render: (props, ctx) =>
    productParts() ? (
      <AddToCartPart label={str(props.label)} viewCart={props.viewCart !== false} sticky={props.sticky !== false} className={str(props.className)} />
    ) : (
      renderPreview('AddToCart', ctx, props)
    ),
})

defineCodeComponent({
  name: 'BuyNow',
  pages: PRODUCT,
  props: z.object({ label }),
  describe: 'Buy Now: straight to checkout with the chosen variant and quantity.',
  render: (props, ctx) => (productParts() ? <BuyNowPart label={str(props.label)} className={str(props.className)} /> : renderPreview('BuyNow', ctx, props)),
})

defineCodeComponent({
  name: 'WishlistButton',
  pages: PRODUCT,
  props: z.object({ share: z.boolean().default(false) }),
  describe: 'Round heart button that saves the product to the wishlist (asks guests to sign in); share adds a share button.',
  render: (props, ctx) =>
    productParts() ? <WishlistButtonPart share={props.share === true} className={str(props.className)} /> : renderPreview('WishlistButton', ctx, props),
})

defineCodeComponent({
  name: 'DeliveryCheck',
  pages: PRODUCT,
  props: z.object({ policies: z.boolean().default(true) }),
  describe: 'Pincode delivery check; policies adds the free delivery, returns, replacement, genuine and secure payment tiles.',
  render: (props, ctx) =>
    productParts() ? <DeliveryCheckPart policies={props.policies !== false} className={str(props.className)} /> : renderPreview('DeliveryCheck', ctx, props),
})

defineCodeComponent({
  name: 'ProductDescription',
  pages: PRODUCT,
  props: z.object({ card: z.boolean().default(true) }),
  describe: 'The product description: card is the titled built-in card; card={false} is plain text styled by className.',
  render: (props, ctx) => renderDescription(ctx, props),
})

defineCodeComponent({
  name: 'ProductSpecs',
  pages: PRODUCT,
  props: z.object({ features: z.boolean().default(true), info: z.boolean().default(true) }),
  describe:
    'The specifications card; features adds the key features and use cases, info the in-the-box, usage and care, legal declarations and FAQs.',
  render: (props, ctx) => renderSpecs(ctx, props),
})

defineCodeComponent({
  name: 'ProductReviews',
  pages: PRODUCT,
  props: z.object({}),
  describe: 'Customer reviews with the rating breakdown, photos and the write-a-review form.',
  render: (props, ctx) => renderReviews(ctx, props),
})

defineCodeComponent({
  name: 'RelatedProducts',
  pages: PRODUCT,
  props: z.object({ limit: z.number().int().min(1).max(8).default(4) }),
  binding: PRODUCT_VIEW_BINDING,
  describe:
    "Products related to this one, each drawn as the site's product card; className sets the list's layout (a grid by default). A render function {p => …} replaces the card, only for a special layout.",
  count: (props, data) => relatedCount(data, props),
  render: (props, ctx) => renderRelated(ctx, props),
})
