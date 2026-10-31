import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { hasSocialAccounts, runAutopost } from '@/lib/social/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => ((await hasSocialAccounts()) ? null : 'not_connected'),
    () => runAutopost()
  )
}
