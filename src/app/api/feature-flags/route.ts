import { NextResponse } from 'next/server'
import { getFeatureFlags } from '@/lib/site-controls'

export const dynamic = 'force-dynamic'

// Lightweight endpoint for client components to check plan-gated feature flags
// without needing NEXT_PUBLIC_ env vars. Called on login/signup page mount.
export async function GET() {
  const flags = await getFeatureFlags()
  return NextResponse.json({
    smsEnabled: flags.smsEnabled,
    whatsappEnabled: flags.whatsappEnabled,
  })
}
