'use client'

import { useEffect } from 'react'
import { CURRENCY, trackSaasEvent } from '@/lib/client/analytics'

/** Reports a confirmed store subscription to GA4 / Google Ads once per subscription on this browser. */
export default function SubscriptionPaidPing({
  subscriptionId,
  tenant,
  plan,
  interval,
  value,
}: {
  subscriptionId: string
  tenant: string
  plan: string | null
  interval: 'monthly' | 'yearly'
  value: number
}) {
  useEffect(() => {
    trackSaasEvent(
      'saas_subscription_paid',
      { transaction_id: subscriptionId, value, currency: CURRENCY, plan, billing_interval: interval, tenant },
      `sub:${subscriptionId}`
    )
  }, [subscriptionId, tenant, plan, interval, value])
  return null
}
