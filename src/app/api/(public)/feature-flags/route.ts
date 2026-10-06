import { NextResponse } from 'next/server'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { getReferralSettings } from '@/lib/referrals/settings'

export const dynamic = 'force-dynamic'

// Lightweight endpoint for client components to check plan-gated feature flags
// without needing NEXT_PUBLIC_ env vars. Called on login/signup page mount.
export async function GET() {
  const [flags, loyalty, referral] = await Promise.all([getFeatureFlags(), getLoyaltySettings(), getReferralSettings()])
  return NextResponse.json({
    smsEnabled: flags.smsEnabled,
    whatsappEnabled: flags.whatsappEnabled,
    loyaltyEnabled: loyalty.enabled,
    // Rewards are loyalty points, so referrals only show while loyalty is on too.
    referralEnabled: referral.enabled && loyalty.enabled,
  })
}
