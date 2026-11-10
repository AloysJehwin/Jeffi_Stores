'use client'

import { use } from 'react'
import { useCart } from '@/contexts/CartContext'
import { UpiCheckoutClient } from '@/components/payments'

export default function UpiCheckoutPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = use(params)
  const { clearCart } = useCart()
  return (
    <div className="min-h-[70vh] bg-surface px-4 py-10 flex items-center justify-center">
      <UpiCheckoutClient
        intentId={intentId}
        fallbackHref="/account/orders"
        retryHref="/checkout/review"
        orderHref={(orderId, purpose) => (purpose === 'order_draft' ? `/account/orders/confirmation?orderId=${orderId}` : `/account/orders/${orderId}`)}
        onCompleted={v => {
          if (v.purpose === 'order_draft') clearCart()
        }}
      />
    </div>
  )
}
