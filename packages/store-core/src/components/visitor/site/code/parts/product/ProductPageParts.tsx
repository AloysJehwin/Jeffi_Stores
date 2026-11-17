import type { ReactNode } from 'react'
import { ProductPageProvider, type PdpProduct } from '@/components/visitor/pdp/ProductPageProvider'
import type { ReviewSummary } from '@/lib/shared/review-summary-types'
import { setProductParts } from './context'

/**
 * Mounted by the product page around its content (built-in or Site Builder): the client provider the interactive
 * parts share (selection, quantity, wishlist…) and the server data the rendered parts read.
 */
export default function ProductPageParts({
  product,
  initialSkuParam,
  freeShippingThreshold,
  reviewSummary = null,
  related = [],
  gstEnabled,
  children,
}: {
  product: PdpProduct & Record<string, any>
  initialSkuParam?: string
  freeShippingThreshold?: number
  reviewSummary?: ReviewSummary | null
  related?: any[]
  gstEnabled: boolean
  children: ReactNode
}) {
  setProductParts({ product, related, gstEnabled, reviewSummary })
  return (
    <ProductPageProvider
      product={product}
      initialSkuParam={initialSkuParam}
      freeShippingThreshold={freeShippingThreshold}
      reviewSummary={reviewSummary}
    >
      {children}
    </ProductPageProvider>
  )
}
