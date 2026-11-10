'use client'

import { use } from 'react'
import { PageBody } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { UpiCheckoutClient } from '@/components/payments'

export default function UpiCheckoutPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = use(params)
  return (
    <PageBody>
      <div className="flex min-h-[60vh] items-center justify-center">
        <UpiCheckoutClient intentId={intentId} fallbackHref={ap('/admin/wallet')} apiBase="/api/admin/financial/wallet/topup/upi" />
      </div>
    </PageBody>
  )
}
