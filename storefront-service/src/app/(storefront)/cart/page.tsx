import { SitePage } from '@/components/visitor/site/SitePage'
import { CartPartsProvider } from '@/components/visitor/site/code/parts/cart/context'
import { codeComponents, hasBlock } from '@/components/visitor/site/code/parts/cart/page-parts'
import { loadSitePage } from '@/lib/site/page'
import CartClient from './CartClient'

// The cart. With a Site Builder cart page, the cart is that page's `cart_main` block with the store's own blocks
// (upsell rows, trust strip, questions) around it; otherwise it is the page. An AI-designed cart page places the cart
// parts itself over one shared cart state; if it lacks the lines or the checkout button, the built-in cart is added.
export default async function CartPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const page = await loadSitePage({ audience: 'store', page: 'cart' }, await searchParams)
  if (!page) return <CartClient />
  const parts = codeComponents(page.doc)
  const builtIn = !parts || hasBlock(page.doc, 'cart_main') || !parts.has('CartLines') || !parts.has('CheckoutButton')
  const site = (
    <SitePage doc={page.doc} surface={page.surface} audience="store" selectable={page.selectable} core={builtIn ? { cart_main: <CartClient /> } : {}} page="cart" />
  )
  return parts ? <CartPartsProvider>{site}</CartPartsProvider> : site
}
