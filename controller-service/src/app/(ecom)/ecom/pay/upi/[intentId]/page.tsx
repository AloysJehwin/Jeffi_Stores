'use client'

import { use } from 'react'
import { UpiCheckoutClient } from '@/components/payments'

export default function UpiCheckoutPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = use(params)
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <UpiCheckoutClient intentId={intentId} fallbackHref="/dashboard/wallet" apiBase="/api/ecom/wallet/topup/upi" />
    </div>
  )
}
