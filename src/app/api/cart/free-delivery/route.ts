import { NextResponse } from 'next/server'
import { getDeliverySettings } from '@/lib/delivery-settings'

export const dynamic = 'force-dynamic'

/**
 * Public free-delivery rule for the cart progress bar: the same delivery_free_threshold checkout
 * applies. 0 means no threshold to work towards (none set, or delivery charges are off).
 */
export async function GET() {
  const settings = await getDeliverySettings()
  return NextResponse.json(
    {
      freeThreshold: settings.enabled ? settings.freeThreshold : 0,
      weightLimitKg: settings.freeWeightCeilingKg > 0 ? settings.freeWeightCeilingKg : 3,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
