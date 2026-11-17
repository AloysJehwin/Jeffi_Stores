import { SitePage } from '@/components/visitor/site/SitePage'
import { CheckoutProvider } from '@/components/visitor/site/code/parts/checkout/context'
import { CheckoutGate } from '@/components/visitor/site/code/parts/checkout/CheckoutView'
import { codeComponents, hasBlock } from '@/components/visitor/site/code/parts/cart/page-parts'
import { loadSitePage } from '@/lib/site/page'
import CheckoutClient from './CheckoutClient'

// The checkout. With a Site Builder checkout page, the checkout is that page's `checkout_main` block with the store's
// own blocks (trust strip, questions) around it; the payment flow itself is the same either way. An AI-designed
// checkout page places the checkout parts over one shared checkout state, the payment through its single PaymentStep;
// without one, the built-in checkout is added so the order can always be paid for.
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const page = await loadSitePage({ audience: 'store', page: 'checkout' }, await searchParams)
  if (!page) return <CheckoutClient />
  const parts = codeComponents(page.doc)
  const builtIn = !parts || hasBlock(page.doc, 'checkout_main') || !parts.has('PaymentStep')
  const site = (
    <SitePage doc={page.doc} surface={page.surface} audience="store" selectable={page.selectable} core={builtIn ? { checkout_main: <CheckoutClient /> } : {}} page="checkout" />
  )
  return parts ? (
    <CheckoutProvider builtInPayment={builtIn}>
      <CheckoutGate>{site}</CheckoutGate>
    </CheckoutProvider>
  ) : (
    site
  )
}
