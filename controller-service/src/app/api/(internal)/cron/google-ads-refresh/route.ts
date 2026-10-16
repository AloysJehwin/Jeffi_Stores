import { NextRequest } from 'next/server'
import { handleAdsCron } from '@/lib/google-ads/cron'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Intraday: today's metrics only.
export async function GET(req: NextRequest) {
  return handleAdsCron(req, 'today')
}
