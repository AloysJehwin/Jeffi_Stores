import { Plus, ShoppingBag, ShoppingCart } from 'lucide-react'
import type { ProductView } from '@/lib/site/data/types'

// What the card parts share between the server look-alikes (marks.tsx) and the live buttons (CardActions.tsx).

/** The plain fields the card's buttons need (a server-to-client prop, so nothing else of the product travels). */
export interface CardProduct {
  id: string
  slug: string
  name: string
  image: string | null
  brand: string | null
  category: string | null
  price: number
  mrp: number | null
  discountPct: number
  inStock: boolean
  hasVariants: boolean
  isDigital: boolean
}

/** A product from a render function or the card's parameter, or null when the value is not one. */
export function cardProduct(v: unknown): CardProduct | null {
  const p = v as Partial<ProductView> | null
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.slug !== 'string' || typeof p.name !== 'string') return null
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    image: typeof p.image === 'string' ? p.image : null,
    brand: typeof p.brand === 'string' ? p.brand : null,
    category: typeof p.category === 'string' ? p.category : null,
    price: Number(p.price?.value) || 0,
    mrp: p.mrp && Number(p.mrp.value) > 0 ? Number(p.mrp.value) : null,
    discountPct: Number(p.discountPct) || 0,
    inStock: p.inStock !== false,
    hasVariants: !!p.hasVariants,
    isDigital: !!p.isDigital,
  }
}

/** The button's words when the design gives none: what a tap does for this product. */
export const quickAddText = (p: CardProduct) => (!p.inStock ? 'Sold out' : p.hasVariants ? 'Choose options' : p.isDigital ? 'Buy now' : 'Add to cart')

export const QUICK_ADD_CLASS =
  'ui-btn inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60'
export const WISHLIST_CLASS =
  'ui-btn inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-default bg-surface text-foreground-muted transition-colors hover:text-red-500 aria-pressed:text-red-500'

export type CardIconName = 'none' | 'plus' | 'cart' | 'bag'
const ICONS = { plus: Plus, cart: ShoppingCart, bag: ShoppingBag } as const

export function CardIcon({ name }: { name: CardIconName }) {
  if (name === 'none') return null
  const Icon = ICONS[name]
  return <Icon aria-hidden strokeWidth={2} className="h-[1.1em] w-[1.1em] shrink-0" />
}
