'use client'

import { use } from 'react'
import { UpiReturnClient } from '@/components/payments'

export default function UpiReturnPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = use(params)
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <UpiReturnClient intentId={intentId} fallbackHref="/dashboard/wallet" apiBase="/api/ecom/wallet/topup/upi" />
    </div>
  )
}
