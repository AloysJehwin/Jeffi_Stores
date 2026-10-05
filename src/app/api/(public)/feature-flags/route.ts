import { NextResponse } from 'next/server'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getLoyaltySettings } from '@/lib/loyalty/settings'

export const dynamic = 'force-dynamic'

// Lightweight endpoint for client components to check plan-gated feature flags
// without needing NEXT_PUBLIC_ env vars. Called on login/signup page mount.
export async function GET() {
  const [flags, loyalty] = await Promise.all([getFeatureFlags(), getLoyaltySettings()])
  return NextResponse.json({
    smsEnabled: flags.smsEnabled,
    whatsappEnabled: flags.whatsappEnabled,
    loyaltyEnabled: loyalty.enabled,
  })
}
