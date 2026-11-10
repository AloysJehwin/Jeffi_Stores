'use client'

import { use } from 'react'
import { useCart } from '@/contexts/CartContext'
import { UpiReturnClient } from '@/components/payments'

export default function UpiReturnPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = use(params)
  const { clearCart } = useCart()
  return (
    <div className="min-h-[70vh] bg-surface px-4 py-10 flex items-center justify-center">
      <UpiReturnClient
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
