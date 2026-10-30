import { NextRequest } from 'next/server'
import { handleConversionsCron } from '@/lib/google-ads/conversions/cron'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Every 30 minutes per store: queue newly paid / delivered / cancelled / refunded attributed
// orders, then upload pending conversions and adjustments to Google Ads.
export async function GET(req: NextRequest) {
  return handleConversionsCron(req)
}
