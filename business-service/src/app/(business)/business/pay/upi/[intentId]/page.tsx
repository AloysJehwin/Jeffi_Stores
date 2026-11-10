'use client'

import { use } from 'react'
import { useCart } from '@/contexts/CartContext'
import { bp } from '@/lib/shared/business-path'
import { UpiCheckoutClient } from '@/components/payments'

const PH = { 'X-Auth-Portal': 'business' }

export default function UpiCheckoutPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = use(params)
  const { clearCart } = useCart()
  return (
    <div className="min-h-[70vh] bg-surface px-4 py-10 flex items-center justify-center">
      <UpiCheckoutClient
        intentId={intentId}
        headers={PH}
        fallbackHref={bp('/business/account/orders')}
        retryHref={bp('/business/checkout/review')}
        orderHref={orderId => bp(`/business/account/orders/${orderId}`)}
        onCompleted={v => {
          if (v.purpose === 'order_draft') clearCart()
        }}
      />
    </div>
  )
}
