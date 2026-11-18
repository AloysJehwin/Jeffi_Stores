import { z } from 'zod'
import { defineCodeComponent } from '../registry'
import { portalHere, studioPreview } from '../../portal'
import { QuickAddPart, WishlistTogglePart } from '@/components/visitor/site/code/parts/card/CardActions'
import { cardProduct, quickAddText } from '@/components/visitor/site/code/parts/card/shared'
import { DiscountBadgeMark, PriceTagMark, QuickAddMark, RatingStarsMark, StockBadgeMark, WishlistMark, type MarkProduct } from '@/components/visitor/site/code/parts/card/marks'

// The card parts: a product's add-to-cart and wishlist buttons, and its price, discount, stock and rating. For the site
// card (lib/site/card.ts) and for render functions over products ({p => …}). Each takes the product as product={p}.
// The buttons work on the live store and draw as inert look-alikes over the studio's sample catalogue.

const product = z.any().describe('the product: product={p}')
const cls = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const mark = (v: unknown): MarkProduct | null => (v && typeof v === 'object' ? (v as MarkProduct) : null)

const QuickAddProps = z.object({
  product,
  label: z.string().trim().max(30).optional().describe('the text; by default what a tap does: "Add to cart", "Choose options", "Buy now" ("Sold out" when out of stock); "" for an icon-only button'),
  icon: z.enum(['none', 'plus', 'cart', 'bag']).default('none').describe('an icon before the text'),
})

defineCodeComponent({
  name: 'QuickAdd',
  pages: 'any',
  props: QuickAddProps,
  describe:
    "The product's add-to-cart button: one tap adds it, a product with options opens the option picker, a digital one the buy box; out of stock it is disabled and says Sold out. className styles the button; it already sits above a stretched link.",
  render(props, ctx) {
    const s = props as z.infer<typeof QuickAddProps>
    const p = cardProduct(s.product)
    if (!p) return null
    const iconOnly = s.label === ''
    const icon = iconOnly && s.icon === 'none' ? 'plus' : s.icon
    const text = iconOnly ? '' : !p.inStock ? 'Sold out' : (s.label ?? quickAddText(p))
    if (studioPreview(ctx.data)) return <QuickAddMark text={text} icon={icon} className={cls(props.className)} />
    return <QuickAddPart product={p} text={text} icon={icon} className={cls(props.className)} portal={portalHere()} />
  },
})

const WishlistProps = z.object({ product, label: z.string().trim().max(30).optional().describe('text beside the heart (none by default)') })

defineCodeComponent({
  name: 'WishlistToggle',
  pages: 'any',
  props: WishlistProps,
  describe:
    'A heart button that saves the product to the wishlist (guests are asked to sign in). It has aria-pressed="true" while saved: style that state with aria-pressed: classes. className styles the button; it already sits above a stretched link.',
  render(props, ctx) {
    const p = cardProduct(props.product)
    // Trade buyers have no wishlist.
    if (!p || portalHere() === 'business') return null
    const label = cls((props as z.infer<typeof WishlistProps>).label)
    if (studioPreview(ctx.data)) return <WishlistMark label={label} className={cls(props.className)} />
    return <WishlistTogglePart product={p} label={label} className={cls(props.className)} />
  },
})

const PriceTagProps = z.object({
  product,
  mrp: z.boolean().default(true).describe('the MRP struck through when on sale'),
  discount: z.boolean().default(false).describe('"20% off" after it when on sale'),
  from: z.boolean().default(true).describe('"From ₹…" for a product with options'),
})

defineCodeComponent({
  name: 'PriceTag',
  pages: 'any',
  props: PriceTagProps,
  describe: "The product's price, with the MRP struck through when it is on sale. className styles it (the MRP is a smaller, faded <s>).",
  render(props) {
    const s = props as z.infer<typeof PriceTagProps>
    const p = mark(s.product)
    return p ? <PriceTagMark product={p} mrp={s.mrp} discount={s.discount} from={s.from} className={cls(props.className)} /> : null
  },
})

const DiscountBadgeProps = z.object({ product, format: z.enum(['percent', 'minus', 'sale']).default('percent').describe('"20% off", "−20%" or "Sale"') })

defineCodeComponent({
  name: 'DiscountBadge',
  pages: 'any',
  props: DiscountBadgeProps,
  describe: 'A badge with the discount off MRP; nothing when the product is not on sale. className styles it.',
  render(props) {
    const s = props as z.infer<typeof DiscountBadgeProps>
    const p = mark(s.product)
    return p ? <DiscountBadgeMark product={p} format={s.format} className={cls(props.className)} /> : null
  },
})

const StockBadgeProps = z.object({
  product,
  always: z.boolean().default(false).describe('also show the in-stock text (by default only "Sold out" shows)'),
  soldOutText: z.string().trim().min(1).max(24).default('Sold out'),
  inStockText: z.string().trim().min(1).max(24).default('In stock'),
})

defineCodeComponent({
  name: 'StockBadge',
  pages: 'any',
  props: StockBadgeProps,
  describe: 'The stock state: "Sold out" when out of stock (and "In stock" with always). className styles it; pick colours by state with p.inStock ? … : ….',
  render(props) {
    const s = props as z.infer<typeof StockBadgeProps>
    const p = mark(s.product)
    return p ? <StockBadgeMark product={p} always={s.always} soldOut={s.soldOutText} inStockText={s.inStockText} className={cls(props.className)} /> : null
  },
})

const RatingStarsProps = z.object({ product, count: z.boolean().default(true).describe('the number of reviews after the stars') })

defineCodeComponent({
  name: 'RatingStars',
  pages: 'any',
  props: RatingStarsProps,
  describe: 'Five stars filled to the average rating, with the review count; nothing when the product has no reviews. The stars take the text colour of className.',
  render(props) {
    const s = props as z.infer<typeof RatingStarsProps>
    const p = mark(s.product)
    return p ? <RatingStarsMark product={p} count={s.count} className={cls(props.className)} /> : null
  },
})
