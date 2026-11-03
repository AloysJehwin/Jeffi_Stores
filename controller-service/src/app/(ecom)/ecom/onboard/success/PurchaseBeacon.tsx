'use client'

import { useEffect } from 'react'
import { trackSubscriptionPurchase, type PlanInfo } from '@controller/lib/client/ecom-analytics'

export default function PurchaseBeacon({ subscriptionId, plan }: { subscriptionId: string; plan: PlanInfo }) {
  useEffect(() => {
    trackSubscriptionPurchase(subscriptionId, plan)
  }, [subscriptionId, plan])
  return null
}
