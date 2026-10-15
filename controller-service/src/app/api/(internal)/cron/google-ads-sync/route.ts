import { NextRequest } from 'next/server'
import { handleAdsCron } from '@/lib/google-ads/cron'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Nightly: last 30 days, entities, recommendations and change history.
export async function GET(req: NextRequest) {
  return handleAdsCron(req, 'full')
}
